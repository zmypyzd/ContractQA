import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

export interface SupabaseAuthAdapterOptions {
  url: string;
  anonKey: string;
}

type PageLike = import('@contractqa/core').Page;

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly provider = 'supabase' as const;
  constructor(private readonly opts: SupabaseAuthAdapterOptions) {}

  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^sb-/, /^supabase\.auth\./],
      sessionStorage: [/^sb-/],
      cookies: [/^sb-/, /^supabase/],
    };
  }

  async loginAs(_role: string, _page: PageLike): Promise<void> {
    throw new Error('SupabaseAuthAdapter.loginAs must be overridden per project');
  }

  async isAuthenticated(page: PageLike): Promise<boolean> {
    const r = await this.expectFullyLoggedOut(page);
    return !r.fullyLoggedOut;
  }

  async currentUser(_page: PageLike): Promise<{ id: string; role: string } | null> {
    return null;
  }

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
