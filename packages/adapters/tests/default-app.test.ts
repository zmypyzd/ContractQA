import { describe, it, expect, vi } from 'vitest';
import { DefaultAppAdapter } from '../src/app/default.js';

describe('DefaultAppAdapter', () => {
  it('exposes baseUrl and healthCheckUrl', () => {
    const a = new DefaultAppAdapter({
      baseUrl: 'http://localhost:3000',
      healthCheckUrl: 'http://localhost:3000/api/health',
    });
    expect(a.baseUrl).toBe('http://localhost:3000');
    expect(a.healthCheckUrl).toBe('http://localhost:3000/api/health');
  });

  it('resetState calls user-provided reset hook', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    const a = new DefaultAppAdapter({
      baseUrl: 'http://x',
      healthCheckUrl: 'http://x/h',
      onReset: reset,
    });
    await a.resetState();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('seed without onSeed is a no-op', async () => {
    const a = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    await expect(a.seed('minimal')).resolves.toBeUndefined();
  });
});
