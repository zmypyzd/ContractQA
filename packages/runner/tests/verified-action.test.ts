import { describe, it, expect, vi } from 'vitest';
import { verifiedAction } from '../src/verified-action.js';

describe('verifiedAction', () => {
  it('takes before snapshot, runs action, takes after snapshot, evaluates effects', async () => {
    const before = vi.fn().mockResolvedValue({ url: '/a', localStorageKeys: ['x'], cookies: [] });
    const after = vi.fn().mockResolvedValue({ url: '/b', localStorageKeys: [], cookies: [] });
    const action = vi.fn().mockResolvedValue(undefined);

    const r = await verifiedAction({
      name: 'auth.logout',
      before,
      action,
      after,
      expectedEffects: [
        { name: 'redirectedToLogin', check: (b, a) => a.url !== b.url },
        { name: 'sbCleared', check: (_, a) => !a.localStorageKeys.includes('sb-x') },
      ],
    });

    expect(before).toHaveBeenCalled();
    expect(action).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(r.results).toEqual([
      { name: 'redirectedToLogin', passed: true },
      { name: 'sbCleared', passed: true },
    ]);
  });

  it('flags effect violations', async () => {
    const r = await verifiedAction({
      name: 'auth.logout',
      before: async () => ({ url: '/a', localStorageKeys: ['sb-x'], cookies: [] }),
      action: async () => undefined,
      after: async () => ({ url: '/a', localStorageKeys: ['sb-x'], cookies: [] }),
      expectedEffects: [{ name: 'urlChanged', check: (b, a) => b.url !== a.url }],
    });
    expect(r.results[0]!.passed).toBe(false);
  });
});
