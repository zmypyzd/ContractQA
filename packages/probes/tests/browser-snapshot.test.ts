import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { snapshotBrowser } from '../src/browser-snapshot.js';

function mockPage() {
  return {
    url: () => 'http://localhost:3000/lobby',
    title: async () => 'Lobby',
    viewportSize: () => ({ width: 1280, height: 720 }),
    screenshot: async () => Buffer.from('PNG'),
    content: async () => '<html><body>Hi</body></html>',
    evaluate: async <T>(fn: () => T): Promise<T> => {
      const prev = (globalThis as { localStorage?: unknown; sessionStorage?: unknown }).localStorage;
      const prevS = (globalThis as { sessionStorage?: unknown }).sessionStorage;
      const make = (data: Record<string, string>): Storage => ({
        length: Object.keys(data).length,
        key: (i: number) => Object.keys(data)[i] ?? null,
        getItem: (k: string) => data[k] ?? null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      });
      (globalThis as { localStorage?: unknown }).localStorage = make({});
      (globalThis as { sessionStorage?: unknown }).sessionStorage = make({});
      try {
        return fn();
      } finally {
        (globalThis as { localStorage?: unknown }).localStorage = prev;
        (globalThis as { sessionStorage?: unknown }).sessionStorage = prevS;
      }
    },
    context: () => ({
      cookies: async () => [
        {
          name: 'sb-xyz',
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
        } as const,
      ],
    }),
    on: () => undefined,
  };
}

describe('snapshotBrowser', () => {
  it('captures url, title, viewport, cookies (redacted)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-snap-'));
    const page = mockPage();
    const snap = await snapshotBrowser(page, { screenshotPath: path.join(dir, 'x.png') });
    expect(snap.url).toBe('http://localhost:3000/lobby');
    expect(snap.title).toBe('Lobby');
    expect(snap.viewport).toEqual({ width: 1280, height: 720 });
    expect(snap.cookies[0]).toMatchObject({ name: 'sb-xyz', valueRedacted: true });
  });

  it('captureDom: true populates dom.roleCounts and dom.visibleText', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-snap-'));
    // For the dom-capture test we override `evaluate` to return canned
    // shapes — the body inside snapshotBrowser is browser-side code, so
    // we can't run it in node. The dom result we return shapes the
    // snapshot output directly.
    const page = {
      ...mockPage(),
      evaluate: async <T,>(fn: () => T): Promise<T> => {
        // Distinguish dom-capture callbacks from storage callbacks by
        // poking at the function source. The dom callback returns an
        // object with roleCounts; storage callbacks return key-value maps.
        const src = String(fn);
        if (src.includes('roleCounts')) {
          return { roleCounts: { 'link:Login': 2 }, visibleText: 'Hi WolfMind', elements: [] } as unknown as T;
        }
        return {} as T;
      },
    };
    const snap = await snapshotBrowser(page, {
      screenshotPath: path.join(dir, 'x.png'),
      captureDom: true,
    });
    expect(snap.dom?.roleCounts['link:Login']).toBe(2);
    expect(snap.dom?.visibleText).toContain('WolfMind');
  });

  it('Stream 5: captureDom populates dom.elements (attributes/value/classes/text)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-snap-'));
    const cannedElements = [
      {
        role: 'button',
        name: 'All-in',
        attributes: { disabled: 'true', class: 'btn primary', 'aria-pressed': 'false' },
        classes: ['btn', 'primary'],
        text: 'All-in',
      },
      {
        role: 'textbox',
        name: 'seed',
        attributes: { name: 'seed', type: 'text' },
        value: 'abc123',
        classes: ['input'],
        text: '',
      },
    ];
    const page = {
      ...mockPage(),
      evaluate: async <T,>(fn: () => T, _arg?: number): Promise<T> => {
        const src = String(fn);
        if (src.includes('roleCounts')) {
          return {
            roleCounts: { 'button:All-in': 1, 'textbox:seed': 1 },
            visibleText: 'All-in',
            elements: cannedElements,
          } as unknown as T;
        }
        return {} as T;
      },
    };
    const snap = await snapshotBrowser(page, {
      screenshotPath: path.join(dir, 'x.png'),
      captureDom: true,
    });
    expect(snap.dom?.elements).toBeDefined();
    expect(snap.dom?.elements?.length).toBe(2);
    expect(snap.dom?.elements?.[0]).toMatchObject({
      role: 'button',
      name: 'All-in',
      classes: ['btn', 'primary'],
    });
    expect(snap.dom?.elements?.[0].attributes.disabled).toBe('true');
    expect(snap.dom?.elements?.[1].value).toBe('abc123');
  });

  it('captureDom default false: snap.dom is undefined', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-snap-'));
    const snap = await snapshotBrowser(mockPage(), { screenshotPath: path.join(dir, 'x.png') });
    expect(snap.dom).toBeUndefined();
  });

  it('returns empty storage maps when evaluate rejects with SecurityError', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-snap-'));
    const page = {
      ...mockPage(),
      evaluate: async () => {
        // Real Playwright surfaces these as plain Errors with the message
        // text Chromium emits — simulate that.
        throw new Error("Failed to read the 'localStorage' property from 'Window'");
      },
    };
    const snap = await snapshotBrowser(page, { screenshotPath: path.join(dir, 'x.png') });
    expect(snap.localStorage).toEqual({});
    expect(snap.sessionStorage).toEqual({});
  });
});
