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
});

const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string() }),
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
      not_contains_any: z.array(z.string()).optional(),
      contains_all: z.array(z.string()).optional(),
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
