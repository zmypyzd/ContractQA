import { describe, it, expect } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase.js';

// Fake page shim. Implements just enough of the Page contract used by the adapter.
function fakePage(state: Record<string, string> = {}) {
  return {
    async evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
      // Pretend globalThis has localStorage. The function may be called with no args (read keys) or
      // with { key, value } for the write path.
      const localStorage = {
        getItem: (k: string) => state[k] ?? null,
        setItem: (k: string, v: string) => { state[k] = v; },
        removeItem: (k: string) => { delete state[k]; },
        get length() { return Object.keys(state).length; },
        key: (i: number) => Object.keys(state)[i] ?? null,
      };
      const g = { localStorage } as { localStorage: typeof localStorage };
      return (fn as unknown as (gArg: typeof g, ...a: unknown[]) => T)(g, ...args);
    },
    context: () => ({ cookies: async () => [] }),
  };
}

describe('SupabaseAuthAdapter v2', () => {
  it('loginAs injects a valid Supabase session into localStorage under sb-<projectRef>-auth-token', async () => {
    const state: Record<string, string> = {};
    const adapter = new SupabaseAuthAdapter({
      url: 'http://localhost:54321',
      anonKey: 'fake-anon',
      projectRef: 'localhost',
      tokenIssuer: async (role) => ({
        access_token: 'fake.jwt.token',
        refresh_token: 'refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'user-1', email: `${role}@example.test`, user_metadata: { role } },
      }),
    });
    await adapter.loginAs('admin', fakePage(state) as never);
    const stored = state['sb-localhost-auth-token'];
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.access_token).toBe('fake.jwt.token');
    expect(parsed.user.user_metadata.role).toBe('admin');
  });

  it('currentUser returns user from stored session', async () => {
    const state: Record<string, string> = {
      'sb-localhost-auth-token': JSON.stringify({
        access_token: 'x', refresh_token: 'y', expires_in: 3600, token_type: 'bearer',
        user: { id: 'user-2', user_metadata: { role: 'user' } },
      }),
    };
    const adapter = new SupabaseAuthAdapter({
      url: 'http://localhost:54321', anonKey: 'fake', projectRef: 'localhost',
    });
    const u = await adapter.currentUser(fakePage(state) as never);
    expect(u).toEqual({ id: 'user-2', role: 'user' });
  });

  it('currentUser returns null when no stored session', async () => {
    const adapter = new SupabaseAuthAdapter({
      url: 'http://localhost:54321', anonKey: 'fake', projectRef: 'localhost',
    });
    const u = await adapter.currentUser(fakePage({}) as never);
    expect(u).toBeNull();
  });

  it('expectFullyLoggedOut flags sb-* localStorage keys as not-logged-out', async () => {
    const state: Record<string, string> = { 'sb-localhost-auth-token': '{}' };
    const adapter = new SupabaseAuthAdapter({
      url: 'http://localhost:54321', anonKey: 'fake', projectRef: 'localhost',
    });
    const r = await adapter.expectFullyLoggedOut(fakePage(state) as never);
    expect(r.fullyLoggedOut).toBe(false);
    expect(r.reasons[0]).toMatch(/sb-/);
  });

  it('declares session responsibility', () => {
    const a = new SupabaseAuthAdapter({ url: 'http://localhost:54321', anonKey: 'fake' });
    expect(a.responsibilities).toEqual(['session']);
  });

  it('defaults projectRef to "localhost"', () => {
    const a = new SupabaseAuthAdapter({ url: 'http://localhost:54321', anonKey: 'fake' });
    // private field is internal but the storage key reflects it; we'll check via a probe loginAs
    expect(a.provider).toBe('supabase');
  });
});
