import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

type PageLike = import('@contractqa/core').Page;

export class Auth0Adapter implements AuthAdapter {
  readonly provider = 'auth0' as const;
  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^@@auth0spajs@@/],
      sessionStorage: [/^@@auth0spajs@@/],
      cookies: [/^auth0$/, /^auth0\.is\.authenticated$/, /^_legacy_auth0/],
    };
  }
  async loginAs(): Promise<void> { throw new Error('override per project'); }
  async isAuthenticated(page: PageLike): Promise<boolean> {
    return !(await this.expectFullyLoggedOut(page)).fullyLoggedOut;
  }
  async currentUser(): Promise<null> { return null; }
  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const localKeys = await page.evaluate(() =>
      Object.keys((globalThis as { localStorage?: Storage }).localStorage ?? {}),
    );
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons: string[] = [];
    for (const k of localKeys) {
      if (pats.localStorage.some((r) => r.test(k))) reasons.push(`localStorage key ${k} still present`);
    }
    for (const c of cookies) {
      if (pats.cookies.some((r) => r.test(c.name))) reasons.push(`cookie ${c.name} still present`);
    }
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
