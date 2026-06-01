import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { snapshotBrowser } from '@contractqa/probes';
import { formatObservedSurface } from './observed-surface.js';

// Builds the `surfaceProvider` for deep discovery: given the project's real
// routes, launches a headless browser, navigates each page route, snapshots the
// live DOM, and returns a route → observedSurface map (pre-formatted REAL-element
// lines). Generation feeds these in so locators are grounded in observed reality
// instead of names invented from (possibly buggy) source.
//
// Degrades gracefully: if Playwright isn't installed or a route fails to load,
// that route is simply absent from the map (generation stays ungrounded for it,
// i.e. exactly today's behaviour) — never throws into the discovery pipeline.
export function createSurfaceProvider(
  baseUrl: string,
  log?: (msg: string) => void,
): (routes: string[], signal: AbortSignal) => Promise<Record<string, string[]>> {
  return async (routes, signal) => {
    let chromium: typeof import('@playwright/test').chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch {
      log?.('surface probe: @playwright/test unavailable — generation will be ungrounded');
      return {};
    }

    // Always probe '/' so route-less interactions (modals/components) get a
    // fallback surface. Skip API routes — they have no interactive surface.
    const toProbe = [...new Set(['/', ...routes])].filter((r) => r.startsWith('/') && !r.startsWith('/api'));

    const out: Record<string, string[]> = {};
    const tmp = mkdtempSync(path.join(tmpdir(), 'cqa-surface-'));
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 900 } });
      for (const route of toProbe) {
        if (signal.aborted) break;
        const page = await context.newPage();
        try {
          await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const snap = await snapshotBrowser(page, { screenshotPath: path.join(tmp, 'p.png'), captureDom: true });
          if (snap.dom) out[route] = formatObservedSurface(snap.dom);
        } catch (err) {
          log?.(`surface probe: ${route} failed (${(err as Error).message}) — ungrounded`);
        } finally {
          await page.close().catch(() => undefined);
        }
      }
      await context.close();
    } finally {
      await browser.close().catch(() => undefined);
      rmSync(tmp, { recursive: true, force: true });
    }
    return out;
  };
}
