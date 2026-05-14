import { describe, it, expect } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase.js';

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

describe('SupabaseAuthAdapter', () => {
  const a = new SupabaseAuthAdapter({ url: 'https://x.supabase.co', anonKey: 'k' });

  it('sessionKeyPatterns matches sb-* localStorage keys', () => {
    const pats = a.sessionKeyPatterns();
    expect(pats.localStorage[0]!.test('sb-xyz-auth-token')).toBe(true);
    expect(pats.localStorage[0]!.test('posthog-id')).toBe(false);
  });

  it('expectFullyLoggedOut returns true when no sb-* keys and no supabase cookies', async () => {
    const r = await a.expectFullyLoggedOut(pageWithStorage({}, []));
    expect(r.fullyLoggedOut).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('expectFullyLoggedOut returns false when sb-* key present', async () => {
    const r = await a.expectFullyLoggedOut(pageWithStorage({ 'sb-xyz-auth-token': 'redacted' }));
    expect(r.fullyLoggedOut).toBe(false);
    expect(r.reasons.join(',')).toMatch(/sb-/);
  });

  it('expectFullyLoggedOut returns false when supabase cookie present', async () => {
    const r = await a.expectFullyLoggedOut(pageWithStorage({}, [{ name: 'sb-access-token' }]));
    expect(r.fullyLoggedOut).toBe(false);
  });
});
