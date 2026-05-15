import { describe, it, expect } from 'vitest';
import { checkPlaywright } from '../src/commands/run.js';

describe('checkPlaywright', () => {
  it('returns ok=true when resolver succeeds', () => {
    const result = checkPlaywright({
      resolve: (id: string) => `/fake/path/${id}/index.js`,
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with install hint when resolver throws', () => {
    const result = checkPlaywright({
      resolve: () => { throw new Error('Cannot find module'); },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('@playwright/test is not installed');
    expect(result.error).toContain('npm install @playwright/test');
    expect(result.error).toContain('playwright install');
  });
});
