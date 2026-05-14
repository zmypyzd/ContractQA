import { describe, it, expect, vi } from 'vitest';
import { composeAuth } from '../src/auth/composite.js';
import type { AuthAdapter } from '@contractqa/core';

function fakeAdapter(
  provider: AuthAdapter['provider'],
  responsibilities?: AuthAdapter['responsibilities'],
) {
  return {
    provider,
    responsibilities,
    loginAs: vi.fn(async () => undefined),
    isAuthenticated: vi.fn(async () => false),
    currentUser: vi.fn(async () => null),
    sessionKeyPatterns: vi.fn(() => ({ localStorage: [], sessionStorage: [], cookies: [] })),
    expectFullyLoggedOut: vi.fn(async () => ({ fullyLoggedOut: true, reasons: [] })),
  };
}

describe('composeAuth', () => {
  it('delegates loginAs to the adapter that owns "session"', async () => {
    const session = fakeAdapter('next-auth', ['session']);
    const userStore = fakeAdapter('supabase', ['user-store']);
    const c = composeAuth([session as unknown as AuthAdapter, userStore as unknown as AuthAdapter]);
    await c.loginAs('admin', {} as never);
    expect(session.loginAs).toHaveBeenCalled();
    expect(userStore.loginAs).not.toHaveBeenCalled();
  });

  it('unions sessionKeyPatterns across all composed adapters', () => {
    const session = fakeAdapter('next-auth', ['session']);
    const userStore = fakeAdapter('supabase', ['user-store']);
    session.sessionKeyPatterns.mockReturnValue({
      localStorage: [],
      sessionStorage: [],
      cookies: [/^next-auth/],
    });
    userStore.sessionKeyPatterns.mockReturnValue({
      localStorage: [/^sb-/],
      sessionStorage: [],
      cookies: [],
    });
    const c = composeAuth([
      session as unknown as AuthAdapter,
      userStore as unknown as AuthAdapter,
    ]);
    const p = c.sessionKeyPatterns();
    expect(p.cookies.length).toBe(1);
    expect(p.localStorage.length).toBe(1);
  });

  it('throws when no adapter is provided', () => {
    expect(() => composeAuth([])).toThrow(/at least one adapter/);
  });

  it('throws when no adapter declares the requested responsibility', () => {
    const a = fakeAdapter('supabase', ['user-store']);
    const c = composeAuth([a as unknown as AuthAdapter]);
    expect(() => void c.loginAs('admin', {} as never)).toThrow(/responsibility/);
  });

  it('treats responsibilities-less adapters as owning everything', async () => {
    const legacy = fakeAdapter('clerk');
    const c = composeAuth([legacy as unknown as AuthAdapter]);
    await c.loginAs('admin', {} as never);
    expect(legacy.loginAs).toHaveBeenCalled();
  });
});
