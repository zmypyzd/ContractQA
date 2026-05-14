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
});
