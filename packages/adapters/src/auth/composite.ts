import type {
  AuthAdapter,
  AuthResponsibility,
  AuthStateAssertion,
  Page,
  SessionKeyPatterns,
} from '@contractqa/core';

const ALL_RESPONSIBILITIES: readonly AuthResponsibility[] = [
  'session',
  'user-store',
  'oauth-callback',
];

function pick(adapters: AuthAdapter[], r: AuthResponsibility): AuthAdapter {
  const owner = adapters.find((a) =>
    (a.responsibilities ?? ALL_RESPONSIBILITIES).includes(r),
  );
  if (!owner) throw new Error(`no adapter declares responsibility "${r}"`);
  return owner;
}

/**
 * Combine multiple AuthAdapters into one. Useful when a host stacks
 * NextAuth (session) + Supabase (user-store), or any composition where one
 * adapter owns the cookie/session and another owns DB lookups.
 *
 * Delegation rules:
 *   - loginAs / isAuthenticated / currentUser / expectFullyLoggedOut →
 *     the adapter owning 'session'.
 *   - sessionKeyPatterns → union of every adapter's patterns.
 *
 * Adapters without a `responsibilities` field are treated as owning every
 * responsibility (backward compatible with Phase 1 adapters).
 */
export function composeAuth(adapters: AuthAdapter[]): AuthAdapter {
  if (adapters.length === 0) {
    throw new Error('composeAuth requires at least one adapter');
  }
  return {
    provider: 'custom',
    responsibilities: ALL_RESPONSIBILITIES,
    loginAs: (role: string, page: Page): Promise<void> =>
      pick(adapters, 'session').loginAs(role, page),
    isAuthenticated: (page: Page): Promise<boolean> =>
      pick(adapters, 'session').isAuthenticated(page),
    currentUser: (page: Page): Promise<{ id: string; role: string } | null> =>
      pick(adapters, 'session').currentUser(page),
    expectFullyLoggedOut: (page: Page): Promise<AuthStateAssertion> =>
      pick(adapters, 'session').expectFullyLoggedOut(page),
    sessionKeyPatterns: (): SessionKeyPatterns => {
      const merged: SessionKeyPatterns = {
        localStorage: [],
        sessionStorage: [],
        cookies: [],
      };
      for (const a of adapters) {
        const p = a.sessionKeyPatterns();
        merged.localStorage.push(...p.localStorage);
        merged.sessionStorage.push(...p.sessionStorage);
        merged.cookies.push(...p.cookies);
      }
      return merged;
    },
  };
}
