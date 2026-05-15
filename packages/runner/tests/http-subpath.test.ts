import { describe, it, expect } from 'vitest';

describe('@contractqa/runner/http subpath', () => {
  it('re-exports runHttpContract (function)', async () => {
    const mod = await import('../src/http.js');
    expect(typeof mod.runHttpContract).toBe('function');
  });

  it('module text contains no static @playwright import', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(resolve(here, '../src/http.ts'), 'utf8');
    expect(src).not.toMatch(/@playwright/);
  });
});
