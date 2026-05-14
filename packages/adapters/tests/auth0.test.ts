import { describe, it, expect } from 'vitest';
import { Auth0Adapter } from '../src/auth/auth0.js';

function pageWithStorage(local: Record<string, string>, cookies: Array<{ name: string }> = []) {
  return {
    async evaluate<T>(fn: () => T): Promise<T> {
      const prev = (globalThis as { localStorage?: unknown }).localStorage;
      (globalThis as { localStorage?: unknown }).localStorage = { ...local };
      try {
        return fn();
      } finally {
        (globalThis as { localStorage?: unknown }).localStorage = prev;
      }
    },
    context() {
      return { cookies: async () => cookies };
    },
  };
}

describe('Auth0Adapter', () => {
  const a = new Auth0Adapter();
  it('detects @@auth0spajs@@ localStorage key', () => {
    expect(a.sessionKeyPatterns().localStorage.some((r) => r.test('@@auth0spajs@@::abc'))).toBe(true);
  });
  it('detects auth0 cookie', () => {
    expect(a.sessionKeyPatterns().cookies.some((r) => r.test('auth0'))).toBe(true);
  });
  it('returns false when @@auth0spajs@@ key present', async () => {
    const r = await a.expectFullyLoggedOut(pageWithStorage({ '@@auth0spajs@@::abc': 'x' }));
    expect(r.fullyLoggedOut).toBe(false);
  });
  it('returns true when nothing matches', async () => {
    const r = await a.expectFullyLoggedOut(pageWithStorage({ theme: 'dark' }, [{ name: '_ga' }]));
    expect(r.fullyLoggedOut).toBe(true);
  });
});
