import type {
  AuthAdapter,
  AuthStateAssertion,
  SessionKeyPatterns,
  Page,
} from '@contractqa/core';

export interface CustomCookieAuthConfig {
  cookieName: string;
  loginUrl: string;
  logoutUrl: string;
  baseUrl: string;
  // Override for tests.
  _fetch?: typeof fetch;
}

/**
 * AuthAdapter for apps that use a single HttpOnly session cookie (e.g.
 * `apk_sid`) — common in self-hosted apps that don't use Supabase / Clerk /
 * NextAuth / Auth0.
 *
 * `loginAs(roleOrCreds, page)` accepts either a bare role string (which is
 * stored verbatim in the credentials) or `"email:password"` format. The
 * adapter POSTs to `loginUrl`, extracts the cookie from `Set-Cookie`, and
 * pushes it onto the page's context.
 */
export class CustomCookieAuthAdapter implements AuthAdapter {
  readonly provider = 'custom' as const;
  readonly responsibilities = ['session'] as const;
  private fetcher: typeof fetch;

  constructor(private readonly cfg: CustomCookieAuthConfig) {
    this.fetcher = cfg._fetch ?? fetch;
  }

  sessionKeyPatterns(): SessionKeyPatterns {
    const safe = this.cfg.cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      localStorage: [],
      sessionStorage: [],
      cookies: [new RegExp(`^${safe}$`)],
    };
  }

  async loginAs(roleOrCreds: string, page: Page): Promise<void> {
    const [email, password] = roleOrCreds.includes(':')
      ? roleOrCreds.split(':')
      : [`${roleOrCreds}@contractqa.test`, 'hunter22pw'];
    const res = await this.fetcher(`${this.cfg.baseUrl}${this.cfg.loginUrl}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`CustomCookieAuthAdapter login failed: ${res.status}`);
    }
    const setCookie = res.headers.get('set-cookie') ?? '';
    const safe = this.cfg.cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = setCookie.match(new RegExp(`${safe}=([^;]+)`));
    if (!match || !match[1]) {
      throw new Error(`CustomCookieAuthAdapter login response missing ${this.cfg.cookieName}`);
    }
    const ctx = (
      page as { context: () => { addCookies: (a: unknown[]) => Promise<void> } }
    ).context();
    const url = new URL(this.cfg.baseUrl);
    await ctx.addCookies([
      {
        name: this.cfg.cookieName,
        value: match[1],
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ]);
  }

  async isAuthenticated(page: Page): Promise<boolean> {
    const u = await this.currentUser(page);
    return u !== null;
  }

  async currentUser(page: Page): Promise<{ id: string; role: string } | null> {
    const ctx = (
      page as {
        context: () => {
          cookies: () => Promise<Array<{ name: string; value: string }>>;
        };
      }
    ).context();
    const cookies = await ctx.cookies();
    const c = cookies.find((x) => x.name === this.cfg.cookieName);
    return c ? { id: c.value, role: 'user' } : null;
  }

  async expectFullyLoggedOut(page: Page): Promise<AuthStateAssertion> {
    const ctx = (
      page as {
        context: () => {
          cookies: () => Promise<Array<{ name: string }>>;
        };
      }
    ).context();
    const cookies = await ctx.cookies();
    const present = cookies.some((c) => c.name === this.cfg.cookieName);
    return present
      ? { fullyLoggedOut: false, reasons: [`session cookie ${this.cfg.cookieName} still present`] }
      : { fullyLoggedOut: true, reasons: [] };
  }
}
