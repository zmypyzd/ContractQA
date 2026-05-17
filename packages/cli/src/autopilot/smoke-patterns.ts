// packages/cli/src/autopilot/smoke-patterns.ts
import type { TargetContext } from './bootstrap.js';

/** Subset of the contract schema needed for smoke patterns; full schema is in @contractqa/core. */
export interface ContractSpec {
  id: string;
  title: string;
  area: string;
  severity: 'P0' | 'P1' | 'P2';
  preconditions?: { auth_state?: 'logged_in' | 'anonymous'; role?: string };
  actions: Array<Record<string, unknown>>;
  expected: Record<string, unknown>;
  verification?: { wait_ms?: number; retries?: number };
}

export interface SmokePattern {
  id: string;
  title: string;
  appliesTo: (ctx: TargetContext) => boolean;
  generate: (ctx: TargetContext) => ContractSpec;
}

const LOGOUT_KEY_BY_PROVIDER: Record<string, string> = {
  supabase: '^sb-',
  clerk: '^clerk',
  nextauth: '^next-auth',
  auth0: '^auth0',
};

export const SMOKE_PATTERNS: readonly SmokePattern[] = [
  {
    id: 'SMOKE-root-not-500',
    title: 'Root route does not return 5xx',
    appliesTo: () => true,
    generate: () => ({
      id: 'SMOKE-root-not-500',
      title: 'Root route does not return 5xx',
      area: 'smoke',
      severity: 'P0',
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/' }],
      expected: { http_status: { lt: 500 } },
    }),
  },
  {
    id: 'SMOKE-nonexistent-route-404',
    title: 'Nonexistent route returns 4xx',
    appliesTo: () => true,
    generate: () => ({
      id: 'SMOKE-nonexistent-route-404',
      title: 'Nonexistent route returns 4xx',
      area: 'smoke',
      severity: 'P1',
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/__contractqa_404_probe__' }],
      expected: { http_status: { gte: 400, lt: 500 } },
    }),
  },
  {
    id: 'SMOKE-https-forms',
    title: 'POST forms target HTTPS in production builds',
    appliesTo: (ctx) => ctx.framework !== 'unknown',
    generate: () => ({
      id: 'SMOKE-https-forms',
      title: 'POST forms target HTTPS in production builds',
      area: 'smoke',
      severity: 'P1',
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/' }],
      expected: { dom: { all_forms_post_https: true } },
    }),
  },
  {
    id: 'SMOKE-password-not-in-url',
    title: 'Password fields do not appear in URL',
    appliesTo: () => true,
    generate: () => ({
      id: 'SMOKE-password-not-in-url',
      title: 'Password fields do not appear in URL',
      area: 'smoke',
      severity: 'P0',
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/' }],
      expected: { url: { not_matches: '[?&](password|pwd)=' } },
    }),
  },
  {
    id: 'SMOKE-logout-clears-keys',
    title: 'Logout clears provider-specific storage keys',
    appliesTo: (ctx) => ctx.authProvider in LOGOUT_KEY_BY_PROVIDER &&
                       ctx.testCredentials.source !== 'none',
    generate: (ctx) => ({
      id: 'SMOKE-logout-clears-keys',
      title: `Logout clears ${ctx.authProvider} storage keys`,
      area: 'smoke',
      severity: 'P0',
      preconditions: { auth_state: 'logged_in', role: 'normal_user' },
      actions: [
        { type: 'goto', path: '/' },
        { type: 'click', target: { role: 'button', name_regex: 'logout|sign out|log out' } },
      ],
      expected: {
        localStorage: { no_key_matches: LOGOUT_KEY_BY_PROVIDER[ctx.authProvider] },
        auth_state: { fully_logged_out: true },
      },
      verification: { wait_ms: 1000 },
    }),
  },
  {
    id: 'SMOKE-api-anon-unauthorized',
    title: 'Anonymous API request to first detected endpoint returns 401 or redirect',
    appliesTo: () => true,
    generate: () => ({
      id: 'SMOKE-api-anon-unauthorized',
      title: 'Anonymous API request returns 401 or redirect',
      area: 'smoke',
      severity: 'P1',
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/api/__contractqa_anon_probe__' }],
      expected: { http_status: { one_of: [401, 403, 302, 307] } },
    }),
  },
];

export function applicablePatterns(ctx: TargetContext): readonly SmokePattern[] {
  return SMOKE_PATTERNS.filter((p) => p.appliesTo(ctx));
}
