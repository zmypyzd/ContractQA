import { z } from 'zod';
import { assertSafeRegex } from './safe-regex.js';

const SafeRegex = z.string().superRefine((v, ctx) => {
  try {
    assertSafeRegex(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
  }
});

const Target = z.object({
  role: z.string().optional(),
  name_regex: SafeRegex.optional(),
  test_id: z.string().optional(),
  text: z.string().optional(),
  // `first: true` resolves to the first match when the accessible name
  // appears multiple times on the page (e.g. a "Login" link in both
  // navbar and footer). Without this, Playwright's strict-mode locator
  // throws on multi-match. Added during dogfood #2 — see
  // dogfood/website-vercel-supabase/FINDINGS.md.
  first: z.boolean().optional(),
  // `within` scopes the locator to an ancestor with the given ARIA role
  // (e.g. `within: navigation` for the navbar). Combined with name_regex
  // it semantically disambiguates duplicate accessible names — preferred
  // over `first: true` when the author knows where the element lives.
  within: z.string().optional(),
});

const Action = z.discriminatedUnion('type', [
  // `locale` sets the Accept-Language header before navigation, so i18n
  // contracts can pin DOM text to a known language (e.g. `locale: 'en'`
  // makes "Login" stable rather than "登录").
  z.object({ type: z.literal('goto'), path: z.string(), locale: z.string().optional() }),
  z.object({ type: z.literal('click'), target: Target }),
  z.object({ type: z.literal('fill'), target: Target, value: z.string() }),
  z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }),
]);

const ExpectedBlock = z.object({
  url: z.object({ matches: SafeRegex }).partial().optional(),
  localStorage: z
    .object({
      no_key_matches: SafeRegex.optional(),
      has_key_matches: SafeRegex.optional(),
    })
    .optional(),
  sessionStorage: z
    .object({ no_key_matches: SafeRegex.optional() })
    .optional(),
  cookies: z.object({ no_name_matches: SafeRegex.optional() }).optional(),
  dom: z
    .object({
      // Phase 2: contains_text/not_contains_text + role_count. The older
      // not_contains_any/contains_all aliases are retained for backward
      // compatibility but are not exercised by the dom-classifier yet.
      not_contains_any: z.array(z.string()).optional(),
      contains_all: z.array(z.string()).optional(),
      contains_text: z.array(z.string()).optional(),
      not_contains_text: z.array(z.string()).optional(),
      role_count: z
        .array(
          z.object({
            role: z.string(),
            name_regex: SafeRegex.optional(),
            eq: z.number().int().nonnegative().optional(),
            gte: z.number().int().nonnegative().optional(),
            lte: z.number().int().nonnegative().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  auth_state: z.object({ fully_logged_out: z.boolean() }).partial().optional(),
  watch_keys: z
    .object({
      localStorage: z.array(SafeRegex).optional(),
      cookies: z.array(SafeRegex).optional(),
    })
    .optional(),
});

export const ContractSchema = z.object({
  id: z.string().regex(/^INV-[A-Z0-9-]+$/),
  title: z.string().min(1),
  area: z.string(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  owner: z.string().optional(),
  risk_tags: z.array(z.string()).default([]),
  preconditions: z
    .object({ auth_state: z.string().optional(), role: z.string().optional() })
    .default({}),
  actions: z.array(Action).min(1),
  expected: ExpectedBlock,
  verification: z
    .object({
      wait_ms: z.number().int().nonnegative().default(2000),
      retries: z.number().int().min(0).max(5).default(1),
      evidence_required: z
        .array(z.enum(['state_diff', 'trace', 'screenshot', 'console', 'network']))
        .default(['state_diff']),
    })
    .default({}),
});

export type ContractDoc = z.infer<typeof ContractSchema>;
