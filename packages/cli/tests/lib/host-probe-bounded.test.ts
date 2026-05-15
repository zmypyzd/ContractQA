import { describe, it, expect } from 'vitest';
import { extractAbiHint } from '../../src/lib/host-probe.js';

describe('host-probe — bounded extraction', () => {
  it('extractAbiHint terminates promptly on adversarial stderr (no catastrophic backtrack)', () => {
    const start = Date.now();
    const big = 'NODE_MODULE_VERSION 115.' + 'x'.repeat(100_000); // no `requires` token follows
    const r = extractAbiHint(big);
    const elapsed = Date.now() - start;
    expect(r).toBeNull();
    expect(elapsed).toBeLessThan(250); // bounded regex; 250ms is generous for cold V8 JIT
  });

  it('extractAbiHint still finds the hint when within 512-char window', () => {
    const stderr = 'NODE_MODULE_VERSION 115.\n  noise\n  more noise\nrequires NODE_MODULE_VERSION 127';
    expect(extractAbiHint(stderr)).toEqual({ built: '115', runtime: '127' });
  });
});
