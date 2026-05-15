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

function fakeAdapterWithCalls(name: string, responsibilities: AuthAdapter['responsibilities']) {
  const calls: string[] = [];
  const adapter = {
    provider: 'custom' as const,
    responsibilities,
    loginAs: vi.fn(async () => { calls.push(`${name}.loginAs`); }),
    isAuthenticated: vi.fn(async () => { calls.push(`${name}.isAuthenticated`); return true; }),
    currentUser: vi.fn(async () => { calls.push(`${name}.currentUser`); return { id: name, role: 'user' }; }),
    expectFullyLoggedOut: vi.fn(async () => { calls.push(`${name}.expectFullyLoggedOut`); return { fullyLoggedOut: true, reasons: [] }; }),
    sessionKeyPatterns: () => ({ localStorage: [], sessionStorage: [], cookies: [] }),
  } as unknown as AuthAdapter;
  return Object.assign(adapter, { calls });
}

describe('composeAuth — per-responsibility routing (Phase 4)', () => {
  it('routes currentUser to user-store adapter when present', async () => {
    const session = fakeAdapterWithCalls('s', ['session']);
    const userStore = fakeAdapterWithCalls('u', ['user-store']);
    const c = composeAuth([session, userStore]);
    const r = await c.currentUser({} as any);
    expect(r?.id).toBe('u');
    expect((session as any).calls).not.toContain('s.currentUser');
    expect((userStore as any).calls).toContain('u.currentUser');
  });

  it('routes currentUser to session adapter when no user-store exists', async () => {
    const session = fakeAdapterWithCalls('s', ['session']);
    const c = composeAuth([session]);
    const r = await c.currentUser({} as any);
    expect(r?.id).toBe('s');
  });

  it('expectFullyLoggedOut runs against every adapter and ANDs results', async () => {
    const session = fakeAdapterWithCalls('s', ['session']);
    const userStore = fakeAdapterWithCalls('u', ['user-store']);
    const c = composeAuth([session, userStore]);
    const r = await c.expectFullyLoggedOut({} as any);
    expect(r.fullyLoggedOut).toBe(true);
    expect((session as any).calls).toContain('s.expectFullyLoggedOut');
    expect((userStore as any).calls).toContain('u.expectFullyLoggedOut');
  });

  it('expectFullyLoggedOut returns false if any adapter says false', async () => {
    const session = fakeAdapterWithCalls('s', ['session']);
    const userStore = fakeAdapterWithCalls('u', ['user-store']);
    (userStore.expectFullyLoggedOut as any).mockResolvedValue({ fullyLoggedOut: false, reasons: [], leaked_keys: ['sb-token'] });
    const c = composeAuth([session, userStore]);
    const r = await c.expectFullyLoggedOut({} as any);
    expect(r.fullyLoggedOut).toBe(false);
    expect((r as any).leaked_keys).toEqual(['sb-token']);
  });
});
