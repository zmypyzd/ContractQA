import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

type PageLike = import('@contractqa/core').Page;

export class ClerkAuthAdapter implements AuthAdapter {
  readonly provider = 'clerk' as const;
  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^__clerk/],
      sessionStorage: [/^__clerk/],
      cookies: [/^__session$/, /^__client_uat$/, /^__clerk/],
    };
  }
  async loginAs(): Promise<void> { throw new Error('override per project'); }
  async isAuthenticated(page: PageLike): Promise<boolean> {
    return !(await this.expectFullyLoggedOut(page)).fullyLoggedOut;
  }
  async currentUser(): Promise<null> { return null; }
  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons = cookies
      .filter((c) => pats.cookies.some((r) => r.test(c.name)))
      .map((c) => `cookie ${c.name} still present`);
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
