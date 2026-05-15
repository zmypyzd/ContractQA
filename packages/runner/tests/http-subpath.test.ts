import { describe, it, expect } from 'vitest';

describe('@contractqa/runner/http subpath', () => {
  it('re-exports runHttpContract (function)', async () => {
    const mod = await import('../src/http.js');
    expect(typeof mod.runHttpContract).toBe('function');
  });

  it('run-contract.ts (the underlying module) has no static @playwright import', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(resolve(here, '../src/run-contract.ts'), 'utf8');
    // Match real import statements only (anchored to a line start, requires a quoted module specifier).
    // Comments that happen to mention @playwright are fine.
    expect(src).not.toMatch(/^\s*import\s.*from\s*['"]@playwright/m);
  });
});
