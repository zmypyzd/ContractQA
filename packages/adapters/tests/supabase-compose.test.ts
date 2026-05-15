/**
 * B4 — composeAuth(SupabaseAuthAdapter v2, user-store) integration test
 *
 * Phase 4 routing: composeAuth routes currentUser to the user-store-owning
 * adapter (was: hardcoded to session-owner in v0.3.x). This test asserts
 * the corrected behavior. expectFullyLoggedOut now runs against every
 * adapter and AND-merges fullyLoggedOut.
 */
import { describe, it, expect } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase.js';
import { composeAuth } from '../src/auth/composite.js';
import type { AuthAdapter, AuthResponsibility } from '@contractqa/core';

// Minimal page shim matching the Page contract used by the adapters.
function fakePage(state: Record<string, string> = {}) {
  return {
    async evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
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

describe('composeAuth(supabase v2, userstore)', () => {
  it('routes loginAs to the session-owning adapter (Supabase), writes the session key', async () => {
    const state: Record<string, string> = {};
    const sb = new SupabaseAuthAdapter({
      url: 'http://localhost:54321',
      anonKey: 'fake',
      projectRef: 'localhost',
      tokenIssuer: async (role) => ({
        access_token: 't',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'sb-user', user_metadata: { role } },
      }),
    });

    const userStore: AuthAdapter = {
      provider: 'custom',
      responsibilities: ['user-store'] as readonly AuthResponsibility[],
      async loginAs() { throw new Error('user-store should not handle loginAs'); },
      async isAuthenticated() { return true; },
      async currentUser() { return { id: 'from-userstore', role: 'admin' }; },
      sessionKeyPatterns() { return { localStorage: [], sessionStorage: [], cookies: [] }; },
      async expectFullyLoggedOut() { return { fullyLoggedOut: true, reasons: [] }; },
    };

    const composed = composeAuth([sb, userStore]);

    // loginAs must be delegated to Supabase (session owner) — it writes the localStorage key.
    await composed.loginAs('admin', fakePage(state) as never);
    expect(state['sb-localhost-auth-token']).toBeDefined();
    const stored = JSON.parse(state['sb-localhost-auth-token']!);
    expect(stored.user.user_metadata.role).toBe('admin');
  });

  it('routes currentUser to the user-store adapter when present', async () => {
    const state: Record<string, string> = {};
    const sb = new SupabaseAuthAdapter({
      url: 'http://localhost:54321',
      anonKey: 'fake',
      projectRef: 'localhost',
      tokenIssuer: async (role) => ({
        access_token: 't',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'sb-user', user_metadata: { role } },
      }),
    });

    const userStore: AuthAdapter = {
      provider: 'custom',
      responsibilities: ['user-store'] as readonly AuthResponsibility[],
      async loginAs() { throw new Error('user-store should not handle loginAs'); },
      async isAuthenticated() { return true; },
      async currentUser() { return { id: 'from-userstore', role: 'admin' }; },
      sessionKeyPatterns() { return { localStorage: [], sessionStorage: [], cookies: [] }; },
      async expectFullyLoggedOut() { return { fullyLoggedOut: true, reasons: [] }; },
    };

    const composed = composeAuth([sb, userStore]);

    // Write a session so currentUser has something to decode.
    await composed.loginAs('admin', fakePage(state) as never);

    // currentUser is now routed to the user-store adapter (Phase 4 fix).
    const user = await composed.currentUser(fakePage(state) as never);
    expect(user).toEqual({ id: 'from-userstore', role: 'admin' });
    expect(user?.id).not.toBe('sb-user');
  });

  it('unions sessionKeyPatterns from both adapters', async () => {
    const sb = new SupabaseAuthAdapter({
      url: 'http://localhost:54321',
      anonKey: 'fake',
      projectRef: 'localhost',
    });

    const userStore: AuthAdapter = {
      provider: 'custom',
      responsibilities: ['user-store'] as readonly AuthResponsibility[],
      async loginAs() {},
      async isAuthenticated() { return true; },
      async currentUser() { return null; },
      sessionKeyPatterns() {
        return { localStorage: [/^user-store-/], sessionStorage: [], cookies: [] };
      },
      async expectFullyLoggedOut() { return { fullyLoggedOut: true, reasons: [] }; },
    };

    const composed = composeAuth([sb, userStore]);
    const patterns = composed.sessionKeyPatterns();

    // Supabase contributes /^sb-/ and /^supabase\.auth\./; user-store contributes /^user-store-/.
    expect(patterns.localStorage.length).toBeGreaterThanOrEqual(3);
    const asStrings = patterns.localStorage.map(String);
    expect(asStrings.some((p) => p.includes('sb-'))).toBe(true);
    expect(asStrings.some((p) => p.includes('user-store-'))).toBe(true);
  });
});
