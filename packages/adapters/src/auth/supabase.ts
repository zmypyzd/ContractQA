import type {
  AuthAdapter,
  AuthStateAssertion,
  SessionKeyPatterns,
  AuthResponsibility,
} from '@contractqa/core';

export interface SupabaseAuthAdapterOptions {
  url: string;
  anonKey: string;
  /** Defaults to "localhost". Used to construct the sb-<projectRef>-auth-token key. */
  projectRef?: string;
  /** Test-injectable. When omitted, the default talks to GoTrue at <url>/auth/v1/token?grant_type=password. */
  tokenIssuer?: (role: string) => Promise<SupabaseSession>;
  /** Maps role → fixture email/password used by the default tokenIssuer. */
  roleFixtures?: Record<string, { email: string; password: string }>;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'bearer';
  user: { id: string; email?: string; user_metadata?: { role?: string } };
}

type PageLike = import('@contractqa/core').Page;

// Playwright's page.evaluate actually supports (fn, args) but the core Page shim types it as
// zero-arg for simplicity.  Cast to this internally so we can pass serialisable args.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EvaluateFn = (fn: (...args: any[]) => unknown, ...args: unknown[]) => Promise<unknown>;

const DEFAULT_ROLE_FIXTURES: Record<string, { email: string; password: string }> = {
  admin: { email: 'admin@example.test', password: 'AdminPass123!' },
  user:  { email: 'user@example.test',  password: 'UserPass123!' },
};

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly provider = 'supabase' as const;
  readonly responsibilities: readonly AuthResponsibility[] = ['session'];
  private readonly projectRef: string;
  private readonly issuer: NonNullable<SupabaseAuthAdapterOptions['tokenIssuer']>;

  constructor(private readonly opts: SupabaseAuthAdapterOptions) {
    this.projectRef = opts.projectRef ?? 'localhost';
    this.issuer = opts.tokenIssuer ?? this.defaultIssuer.bind(this);
  }

  private async defaultIssuer(role: string): Promise<SupabaseSession> {
    const fixtures = this.opts.roleFixtures ?? DEFAULT_ROLE_FIXTURES;
    const fixture = fixtures[role];
    if (!fixture) {
      throw new Error(`SupabaseAuthAdapter: no fixture for role "${role}". Provide roleFixtures or tokenIssuer.`);
    }
    const res = await fetch(`${this.opts.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.opts.anonKey,
      },
      body: JSON.stringify({ email: fixture.email, password: fixture.password }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GoTrue token request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<SupabaseSession>;
  }

  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^sb-/, /^supabase\.auth\./],
      sessionStorage: [/^sb-/],
      cookies: [/^sb-/, /^supabase/],
    };
  }

  async loginAs(role: string, page: PageLike): Promise<void> {
    const session = await this.issuer(role);
    const key = `sb-${this.projectRef}-auth-token`;
    const value = JSON.stringify(session);
    await (page.evaluate as unknown as EvaluateFn)(
      (g: unknown, args: { key: string; value: string }) => {
        (g as { localStorage: Storage }).localStorage.setItem(args.key, args.value);
      },
      { key, value },
    );
  }

  async isAuthenticated(page: PageLike): Promise<boolean> {
    const r = await this.expectFullyLoggedOut(page);
    return !r.fullyLoggedOut;
  }

  async currentUser(page: PageLike): Promise<{ id: string; role: string } | null> {
    const key = `sb-${this.projectRef}-auth-token`;
    const raw = (await (page.evaluate as unknown as EvaluateFn)(
      (g: unknown, k: string) =>
        (g as { localStorage: Storage }).localStorage.getItem(k) as string | null,
      key,
    )) as string | null;
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as SupabaseSession;
      return { id: session.user.id, role: session.user.user_metadata?.role ?? 'user' };
    } catch {
      return null;
    }
  }

  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const localKeys = await (page.evaluate as unknown as EvaluateFn)((g: unknown) => {
      // In Playwright, g is the injected arg (a test shim may pass a fake globalThis here).
      // In the old test shim, g is undefined and globalThis.localStorage was set directly.
      const ctx = (g != null ? g : globalThis) as { localStorage?: Storage };
      const ls = ctx.localStorage;
      if (!ls) return [] as string[];
      // Use the Storage iterator protocol (length + key) when the shim implements it.
      // Fall back to Object.keys for plain objects (some test shims spread { ...local }).
      if (typeof ls.key === 'function') {
        const keys: string[] = [];
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k !== null) keys.push(k);
        }
        return keys;
      }
      return Object.keys(ls);
    });
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons: string[] = [];
    for (const k of localKeys as string[]) {
      if (pats.localStorage.some((r) => r.test(k))) reasons.push(`localStorage key ${k} still present`);
    }
    for (const c of cookies) {
      if (pats.cookies.some((r) => r.test(c.name))) reasons.push(`cookie ${c.name} still present`);
    }
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
