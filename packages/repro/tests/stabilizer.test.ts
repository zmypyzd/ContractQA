import { describe, it, expect, vi } from 'vitest';
import { assertReproducible } from '../src/stabilizer.js';

describe('assertReproducible', () => {
  it('passes when ≥2/3 runs fail', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ failed: true })
      .mockResolvedValueOnce({ failed: false })
      .mockResolvedValueOnce({ failed: true });
    const r = await assertReproducible(run, 3, 2);
    expect(r.stable).toBe(true);
    expect(r.failures).toBe(2);
  });
  it('fails when only 1/3 runs fail', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ failed: false })
      .mockResolvedValueOnce({ failed: true })
      .mockResolvedValueOnce({ failed: false });
    const r = await assertReproducible(run, 3, 2);
    expect(r.stable).toBe(false);
  });
});
