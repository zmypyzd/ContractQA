import { describe, it, expect } from 'vitest';
import { ClerkAuthAdapter } from '../src/auth/clerk.js';

function page(cookies: Array<{ name: string }>) {
  return {
    async evaluate<T>(fn: () => T): Promise<T> {
      const prev = (globalThis as { localStorage?: unknown }).localStorage;
      (globalThis as { localStorage?: unknown }).localStorage = {};
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

describe('ClerkAuthAdapter', () => {
  const a = new ClerkAuthAdapter();
  it('detects __session cookie', () => {
    expect(a.sessionKeyPatterns().cookies.some((r) => r.test('__session'))).toBe(true);
  });
  it('expectFullyLoggedOut returns false when __session present', async () => {
    const r = await a.expectFullyLoggedOut(page([{ name: '__session' }]));
    expect(r.fullyLoggedOut).toBe(false);
  });
  it('expectFullyLoggedOut returns true when no Clerk cookies', async () => {
    const r = await a.expectFullyLoggedOut(page([{ name: '_ga' }]));
    expect(r.fullyLoggedOut).toBe(true);
  });
});
