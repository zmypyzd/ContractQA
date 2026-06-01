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
  evaluate<T, A = unknown>(fn: (a: A) => T, arg?: A): Promise<T>;
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

type CollectedElement = {
  role: string;
  name: string;
  attributes: Record<string, string>;
  value?: string;
  classes: string[];
  text: string;
};

// Browser-side DOM collector. MUST stay self-contained — it references only
// DOM globals, never module-scope imports/helpers — because Playwright
// serializes it via `.toString()` and runs it in the page context. Exported so
// the collection logic (interactive + text passes, leaf/visibility gating) can
// be unit-tested directly under jsdom without a real browser.
//
// Two passes populate `elements`:
//   1. Interactive / roled els ([role], a, button, h1-h6, input, select,
//      textarea, [aria-label], [data-testid]) — each gets a role and
//      contributes to roleCounts. Drives attribute_equals / input_value /
//      class_contains / element_text_equals.
//   2. Text-bearing LEAF els (<p>/<span>/<li>/<td>/<time>/… that hold their
//      own visible text and wrap no element children) — tagged role 'text'
//      and appended to `elements` only (NOT roleCounts). This is what lets a
//      date printed as plain text ("<p>Jan 1, 2020</p>") ground a
//      date_constraint / number_in target via {text:"…"}. Before this pass,
//      role-less text nodes were dropped at `if (!role) continue`, so any
//      plain-text value was invisible to the oracle.
export function collectDomShape(budget: number): {
  roleCounts: Record<string, number>;
  visibleText: string;
  elements: CollectedElement[];
} {
  try {
    // Logical visibility: walk ancestors for inline display:none /
    // visibility:hidden / [hidden] / aria-hidden. Deliberately avoids layout
    // (offsetParent/getClientRects) so the function is deterministic under
    // jsdom in tests. Limitation: stylesheet-class-driven display:none is not
    // detected — acceptable, since a *displayed* value (the target case) is
    // visible by construction.
    const isHidden = (start: Element | null): boolean => {
      for (let n: Element | null = start; n; n = n.parentElement) {
        const h = n as HTMLElement;
        if (h.hidden) return true;
        const s = h.style;
        if (s && (s.display === 'none' || s.visibility === 'hidden')) return true;
        if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true;
      }
      return false;
    };

    // Focused attribute set: aria-*/data-* plus the ones the oracle asserts on
    // (disabled, hidden, type, name, role, class, placeholder, href). Skips
    // noisy/large attrs (style, srcdoc).
    const focusedAttrs = (el: Element): Record<string, string> => {
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) {
        const n = a.name.toLowerCase();
        if (n === 'style' || n === 'srcdoc') continue;
        if (
          n === 'disabled' ||
          n === 'hidden' ||
          n === 'type' ||
          n === 'name' ||
          n === 'role' ||
          n === 'class' ||
          n === 'placeholder' ||
          n === 'href' ||
          n.startsWith('aria-') ||
          n.startsWith('data-')
        ) {
          attrs[n] = a.value;
        }
      }
      return attrs;
    };

    // Accessible name via the ARIA fallback chain (the bits that matter for
    // grounding): aria-labelledby → aria-label → associated <label> → placeholder
    // → title → textContent. The previous `aria-label || textContent` left form
    // inputs NAMELESS (their name comes from a <label> or placeholder), so a
    // `name_regex` assertion on them matched nothing → false positive, even though
    // Playwright (which follows this chain) resolves them fine.
    const accessibleName = (el: Element): string => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const txt = labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (txt) return txt;
      }
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const labels = (el as HTMLInputElement).labels;
      if (labels && labels.length > 0) {
        const t = Array.from(labels)
          .map((l) => l.textContent ?? '')
          .join(' ')
          .trim();
        if (t) return t;
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();
      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();
      return (el.textContent ?? '').trim();
    };

    const seen = new Set<Element>();
    const counts: Record<string, number> = {};
    const elementSnapshots: CollectedElement[] = [];

    // Pass 1 — interactive / roled elements. Behavior unchanged from Stream 5
    // except h4-h6 now also map to role 'heading' (the selector previously
    // stopped at h3, silently dropping deeper headings).
    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role], a, button, h1, h2, h3, h4, h5, h6, input, select, textarea, [aria-label], [data-testid]',
      ),
    );
    for (const el of interactive) {
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
                : tag === 'TEXTAREA'
                  ? 'textbox'
                  : tag === 'SELECT'
                    ? 'combobox'
                    : null);
      if (!role) continue;
      const name = accessibleName(el);
      const key = `${role}:${name}`;
      counts[key] = (counts[key] ?? 0) + 1;
      if (elementSnapshots.length >= budget) continue;
      const classes = el.classList ? Array.from(el.classList) : [];
      const value =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
          ? (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
          : undefined;
      const snap: CollectedElement = {
        role,
        name,
        attributes: focusedAttrs(el),
        classes,
        text: (el.textContent ?? '').trim(),
      };
      if (value !== undefined) snap.value = value;
      seen.add(el);
      elementSnapshots.push(snap);
    }

    // Pass 2 — text-bearing leaf elements. Appends to `elements` only (no
    // roleCounts pollution). Gated to keep the snapshot bounded and clean:
    //   • leaf only (el.children.length === 0) — a container's text is captured
    //     on its specific child, so we never emit nested duplicate snapshots;
    //   • non-empty trimmed text;
    //   • not visually hidden (isHidden);
    //   • not inside a link/button (that text is already the control's text);
    //   • capped by TEXT_BUDGET on top of the interactive pass.
    const TEXT_BUDGET = 300;
    const textCap = elementSnapshots.length + TEXT_BUDGET;
    const textEls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'p, span, li, dd, dt, td, th, time, label, small, strong, em, b, caption, figcaption, blockquote',
      ),
    );
    for (const el of textEls) {
      if (elementSnapshots.length >= textCap) break;
      if (seen.has(el)) continue;
      if (el.children.length > 0) continue;
      if (el.closest('a, button')) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      if (isHidden(el)) continue;
      const classes = el.classList ? Array.from(el.classList) : [];
      const name = ((el.getAttribute('aria-label') ?? text) || '').trim();
      seen.add(el);
      elementSnapshots.push({
        role: 'text',
        name,
        attributes: focusedAttrs(el),
        classes,
        text,
      });
    }

    const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
    return { roleCounts: counts, visibleText, elements: elementSnapshots };
  } catch {
    return { roleCounts: {}, visibleText: '', elements: [] };
  }
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
      // Capture per-element attribute snapshots (interactive pass) plus
      // text-bearing leaf elements (text pass) so the oracle can evaluate
      // attribute_equals / input_value / class_contains / element_text_equals /
      // date_constraint / consistency. ELEMENT_BUDGET caps the interactive pass;
      // collectDomShape adds its own TEXT_BUDGET on top. See collectDomShape.
      const ELEMENT_BUDGET = 500;
      dom = await page.evaluate(collectDomShape, ELEMENT_BUDGET);
    } catch {
      dom = { roleCounts: {}, visibleText: '', elements: [] };
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
