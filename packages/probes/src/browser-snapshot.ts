import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BrowserSnapshot, CookieSummary } from '@contractqa/core';
import { defaultRedactionRules, redactStorageMap } from './redaction.js';

interface PageLike {
  url(): string;
  title(): Promise<string>;
  viewportSize(): { width: number; height: number } | null;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  content(): Promise<string>;
  evaluate<T>(fn: (...a: unknown[]) => T): Promise<T>;
  context(): {
    cookies(): Promise<
      Array<{
        name: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite?: 'Lax' | 'Strict' | 'None';
      }>
    >;
  };
  on(event: string, handler: (...a: unknown[]) => void): void;
}

export interface SnapshotOptions {
  screenshotPath: string;
  consoleBuffer?: BrowserSnapshot['console'];
  networkBuffer?: BrowserSnapshot['network'];
  websocketBuffer?: BrowserSnapshot['websocket'];
  // Phase 2: when true, also capture a DomShape (role counts + visible text).
  // Off by default — dom captures cost ~50ms per snapshot and aren't
  // needed unless a contract declares dom: expectations.
  captureDom?: boolean;
}

export async function snapshotBrowser(
  page: PageLike,
  opts: SnapshotOptions,
): Promise<BrowserSnapshot> {
  const buf = await page.screenshot({ fullPage: false });
  await writeFile(opts.screenshotPath, buf);
  const html = await page.content();
  const domTextHash = crypto.createHash('sha256').update(html).digest('hex');

  // Origin-less pages (about:blank etc.) throw SecurityError on
  // `window.localStorage` access. Treat that as empty storage rather than
  // letting it propagate — the caller is usually pre-navigating and a
  // SecurityError would crash the test.
  let localStorage: Record<string, string>;
  try {
    localStorage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      if (ls) {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k) out[k] = ls.getItem(k) ?? '';
        }
      }
      return out;
    });
  } catch {
    localStorage = {};
  }
  let sessionStorage: Record<string, string>;
  try {
    sessionStorage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
      if (ss) {
        for (let i = 0; i < ss.length; i++) {
          const k = ss.key(i);
          if (k) out[k] = ss.getItem(k) ?? '';
        }
      }
      return out;
    });
  } catch {
    sessionStorage = {};
  }
  const rawCookies = await page.context().cookies();
  const cookies: CookieSummary[] = rawCookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    valueRedacted: true,
  }));

  let dom: BrowserSnapshot['dom'] | undefined;
  if (opts.captureDom) {
    try {
      dom = await page.evaluate(() => {
        try {
          const elements = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[role], a, button, h1, h2, h3, input, [aria-label]',
            ),
          );
          const counts: Record<string, number> = {};
          for (const el of elements) {
            const tag = el.tagName;
            const role =
              el.getAttribute('role') ??
              (tag === 'A'
                ? 'link'
                : tag === 'BUTTON'
                  ? 'button'
                  : tag.startsWith('H')
                    ? 'heading'
                    : tag === 'INPUT'
                      ? 'textbox'
                      : null);
            if (!role) continue;
            const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
            const key = `${role}:${name}`;
            counts[key] = (counts[key] ?? 0) + 1;
          }
          const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
          return { roleCounts: counts, visibleText };
        } catch {
          return { roleCounts: {}, visibleText: '' };
        }
      });
    } catch {
      dom = { roleCounts: {}, visibleText: '' };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    url: page.url(),
    title: await page.title(),
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    screenshotPath: opts.screenshotPath,
    domTextHash,
    localStorage: redactStorageMap(localStorage, defaultRedactionRules.redactLocalStorageValues),
    sessionStorage: redactStorageMap(sessionStorage, defaultRedactionRules.redactSessionStorageValues),
    cookies,
    console: opts.consoleBuffer ?? [],
    network: opts.networkBuffer ?? [],
    websocket: opts.websocketBuffer ?? [],
    dom,
  };
}
