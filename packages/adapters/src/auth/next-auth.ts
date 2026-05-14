import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

type PageLike = import('@contractqa/core').Page;

export class NextAuthAdapter implements AuthAdapter {
  readonly provider = 'next-auth' as const;
  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [],
      sessionStorage: [],
      cookies: [
        /^next-auth\.session-token$/,
        /^__Secure-next-auth\.session-token$/,
        /^next-auth\.csrf-token$/,
        /^__Host-next-auth\.csrf-token$/,
      ],
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
