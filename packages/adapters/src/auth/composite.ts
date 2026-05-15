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

const METHOD_RESPONSIBILITY: Record<'loginAs' | 'isAuthenticated' | 'currentUser', readonly AuthResponsibility[]> = {
  loginAs: ['session'],
  isAuthenticated: ['session'],
  currentUser: ['user-store', 'session'], // first match wins
};

function pickFirst(adapters: AuthAdapter[], rs: readonly AuthResponsibility[]): AuthAdapter {
  for (const r of rs) {
    const owner = adapters.find((a) => (a.responsibilities ?? ALL_RESPONSIBILITIES).includes(r));
    if (owner) return owner;
  }
  throw new Error(`composeAuth: no adapter declares responsibility for any of: ${rs.join(', ')}`);
}

/**
 * Combine multiple AuthAdapters into one.
 *
 * Per-responsibility routing (Phase 4):
 *   - loginAs / isAuthenticated → owner of 'session'
 *   - currentUser → owner of 'user-store', falling back to 'session'
 *   - expectFullyLoggedOut → ALL adapters; result is AND of fullyLoggedOut + UNION of leaked_keys
 *   - sessionKeyPatterns → UNION across all adapters
 *
 * Adapters without a `responsibilities` field are treated as owning every
 * responsibility (Phase 1 backward compat).
 */
export function composeAuth(adapters: AuthAdapter[]): AuthAdapter {
  if (adapters.length === 0) throw new Error('composeAuth requires at least one adapter');
  return {
    provider: 'custom',
    responsibilities: ALL_RESPONSIBILITIES,
    loginAs: (role: string, page: Page): Promise<void> =>
      pickFirst(adapters, METHOD_RESPONSIBILITY.loginAs).loginAs(role, page),
    isAuthenticated: (page: Page): Promise<boolean> =>
      pickFirst(adapters, METHOD_RESPONSIBILITY.isAuthenticated).isAuthenticated(page),
    currentUser: (page: Page): Promise<{ id: string; role: string } | null> =>
      pickFirst(adapters, METHOD_RESPONSIBILITY.currentUser).currentUser(page),
    expectFullyLoggedOut: async (page: Page): Promise<AuthStateAssertion> => {
      const all = await Promise.all(adapters.map((a) => a.expectFullyLoggedOut(page)));
      const fullyLoggedOut = all.every((r) => r.fullyLoggedOut);
      const leaked: string[] = all.flatMap((r) => (r as any).leaked_keys ?? []);
      const merged: AuthStateAssertion = { fullyLoggedOut, reasons: [] };
      if (leaked.length > 0) (merged as any).leaked_keys = leaked;
      return merged;
    },
    sessionKeyPatterns: (): SessionKeyPatterns => {
      const merged: SessionKeyPatterns = { localStorage: [], sessionStorage: [], cookies: [] };
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
