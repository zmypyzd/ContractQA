import { describe, it, expect } from 'vitest';
import { NextAuthAdapter } from '../src/auth/next-auth.js';

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
    context: () => ({ cookies: async () => cookies }),
  };
}

describe('NextAuthAdapter', () => {
  const a = new NextAuthAdapter();
  it('detects next-auth.session-token', () => {
    expect(a.sessionKeyPatterns().cookies.some((r) => r.test('next-auth.session-token'))).toBe(true);
  });
  it('detects __Secure-next-auth variant', () => {
    expect(
      a.sessionKeyPatterns().cookies.some((r) => r.test('__Secure-next-auth.session-token')),
    ).toBe(true);
  });
  it('false when session-token cookie present', async () => {
    const r = await a.expectFullyLoggedOut(page([{ name: 'next-auth.session-token' }]));
    expect(r.fullyLoggedOut).toBe(false);
  });
});
