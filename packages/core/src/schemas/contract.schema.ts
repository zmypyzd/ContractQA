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
  // `css` is a last-resort escape hatch (maps to Playwright `page.locator(css)`) for
  // elements the role/name/placeholder/test_id/label vocab cannot address — notably
  // `<input type="date">` / `type="time"` which expose NO ARIA role and often have no
  // associated label. Prefer a semantic handle when one exists; reach for `css` only
  // when the source shows the element is genuinely role-less and name-less.
  css: z.string().optional(),
  name_regex: SafeRegex.optional(),
  test_id: z.string().optional(),
  text: z.string().optional(),
  // `icon` targets an icon-only control with no accessible name (e.g. a
  // lucide `Plus`/`Minus` quantity stepper, or any `<button><svg class="…">`).
  // Resolved to "the <role> element containing an svg whose class includes
  // <icon>" — icon libraries (lucide, heroicons, …) put the icon name in the
  // svg class, so `icon: "plus"` matches `svg.lucide-plus`. Combine with
  // `first`/`within` to disambiguate when several share the same icon.
  icon: z.string().optional(),
  // `placeholder` targets inputs that have NO accessible name — extremely common
  // (a bare `<input placeholder="Search…">` has empty role/name, so role+name_regex
  // can't match it). Maps to Playwright getByPlaceholder. Discovered via live-app
  // exploration (Entry 35/36): most real inputs are placeholder-only.
  placeholder: z.string().optional(),
  // `first: true` resolves to the first match when the accessible name
  // appears multiple times on the page (e.g. a "Login" link in both
  // navbar and footer). Without this, Playwright's strict-mode locator
  // throws on multi-match. Added during dogfood #2 — see
  // dogfood/website-vercel-supabase/FINDINGS.md.
  first: z.boolean().optional(),
  // `nth` resolves to the 0-based index match — generalises `first` (= nth 0) to
  // later matches. The grounding handle for name-LESS inputs with no placeholder,
  // test_id, or htmlFor-associated label (e.g. shadcn `<Label>`+`<Input>` siblings
  // that aren't wired together): role+name_regex can't match (empty accessible name)
  // and getByLabel can't either (no association), so the author targets by role +
  // the field's source-declared order (budget = spinbutton nth 0, guests = nth 1).
  // Scope with `within` when other same-role elements share the page.
  nth: z.number().int().nonnegative().optional(),
  // `within` scopes the locator to an ancestor with the given ARIA role
  // (e.g. `within: navigation` for the navbar). Combined with name_regex
  // it semantically disambiguates duplicate accessible names — preferred
  // over `first: true` when the author knows where the element lives.
  within: z.string().optional(),
});

const DateConstraintItem = z
  .object({
    target: Target,
    rule: z.enum(['future', 'past', 'today_or_future', 'today_or_past']).optional(),
    after: Target.optional(),
    before: Target.optional(),
  })
  .strict();

const Action = z.discriminatedUnion('type', [
  // `locale` sets the Accept-Language header before navigation, so i18n
  // contracts can pin DOM text to a known language (e.g. `locale: 'en'`
  // makes "Login" stable rather than "登录").
  z.object({ type: z.literal('goto'), path: z.string(), locale: z.string().optional() }).strict(),
  z.object({ type: z.literal('click'), target: Target }).strict(),
  z.object({ type: z.literal('fill'), target: Target, value: z.string() }).strict(),
  z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal('http'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1),
    body: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }).strict(),
]);

const BackendState = z.object({
  named_query: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  assert: z.union([
    z.object({ rowCount: z.number().int().nonnegative() }).strict(),
    z.object({ rows: z.array(z.record(z.string(), z.unknown())) }).strict(),
  ]),
}).strict();

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
      // Stream 5 rich-assertion family — all four locate elements via the
      // shared Target shape (role/name_regex/test_id/text/within/first).
      // Snapshot must populate DomShape.elements; without that the
      // classifier emits a "snapshot missing elements" failure (analogous
      // to the dom-without-snapshotBrowser-captureDom case).
      attribute_equals: z
        .array(
          z
            .object({
              target: Target,
              attribute: z.string().min(1),
              // booleans cover present/absent attrs (e.g. disabled). Strings
              // cover value/data-*/aria-* etc.
              equals: z.union([z.string(), z.boolean()]),
            })
            .strict(),
        )
        .optional(),
      input_value: z
        .array(
          z
            .object({
              target: Target,
              equals: z.string().optional(),
              matches: SafeRegex.optional(),
            })
            .strict()
            .refine(
              (v) => v.equals !== undefined || v.matches !== undefined,
              { message: 'input_value requires equals or matches' },
            ),
        )
        .optional(),
      class_contains: z
        .array(
          z
            .object({
              target: Target,
              class: z.string().min(1),
            })
            .strict(),
        )
        .optional(),
      element_text_equals: z
        .array(
          z
            .object({
              target: Target,
              equals: z.string(),
            })
            .strict(),
        )
        .optional(),
      // CROSS-SIGNAL CONSISTENCY (Entry 33): relate two RUNTIME-OBSERVED signals
      // (never a code constant). A Signal extracts a number from the live DOM:
      //   { count: <Target> }     → how many elements match the Target
      //   { number_in: <Target> } → the first number in the matched element's text
      //   { sum_of: <Target> }    → sum of the first number across all matches
      // The relation must hold between left and right (e.g. a displayed count ==
      // the rendered row count; a shown total == Σ line items). The bug is the GAP.
      // If either signal cannot be grounded (no match / no number) the relation is
      // skipped (conservative — no false positive).
      consistency: z
        .array(
          z
            .object({
              left: z
                .object({ count: Target.optional(), number_in: Target.optional(), sum_of: Target.optional() })
                .strict(),
              relation: z.enum(['eq', 'lte', 'gte', 'lt', 'gt']),
              right: z
                .object({ count: Target.optional(), number_in: Target.optional(), sum_of: Target.optional() })
                .strict(),
            })
            .strict(),
        )
        .optional(),
      // Date constraints — assert a displayed/entered date honours a temporal rule.
      // `rule` compares to NOW (future-only event/wedding date must not be in the
      // past); `after`/`before` compare to another displayed date (end >= start).
      // The runner reads the date from the target's value/text; unparseable → skipped.
      // Accept either an array or a single object (LLMs naturally emit one
      // constraint as a bare object) — normalised to an array.
      date_constraint: z
        .union([
          z.array(DateConstraintItem),
          DateConstraintItem.transform((x) => [x]),
        ])
        .optional(),
    })
    .optional(),
  auth_state: z.object({ fully_logged_out: z.boolean() }).partial().optional(),
  backend_state: BackendState.optional(),
  watch_keys: z
    .object({
      localStorage: z.array(SafeRegex).optional(),
      cookies: z.array(SafeRegex).optional(),
    })
    .optional(),
  // `http` asserts on the response captured by an `http` action. Required when
  // a contract's only navigation is an `http` action — otherwise the runner
  // emits a strictness error (G18) because `dom` checks against the wrong
  // page. See qa/eval/poker/run-log/fix-plan.md Stream 1.
  http: z
    .object({
      status: z.union([z.number().int(), z.array(z.number().int())]).optional(),
      body: z
        .object({
          contains: z.array(z.string()).optional(),
          not_contains: z.array(z.string()).optional(),
          contains_keys: z.array(z.string()).optional(),
          not_contains_keys: z.array(z.string()).optional(),
        })
        .strict()
        .optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const ContractSchema = z.object({
  // id is any safe identifier: starts with a letter, then letters/digits/dashes,
  // up to 100 chars. Accepts both the historical INV-XX ticket style (e.g.
  // INV-A2) and autopilot's descriptive kebab-case (e.g.
  // agent-picker-cancel-closes-popover). Naming convention beyond this is
  // a docs/lint concern, not a schema concern — see
  // docs/contractqa-run-end-to-end-gap.md "Layer 6".
  id: z.string().min(1).max(100).regex(/^[a-zA-Z][a-zA-Z0-9-]*$/),
  title: z.string().min(1),
  area: z.string(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  owner: z.string().optional(),
  risk_tags: z.array(z.string()).default([]),
  preconditions: z
    .object({
      auth_state: z.string().optional(),
      role: z.string().optional(),
      // `feature_flags` declares which SUT flags must be set to specific
      // values for the contract's assertions to be meaningful. The runner
      // does not auto-toggle flags — this field is descriptive metadata
      // for the test author (analogous to `role`). Pre-test setup must
      // ensure the SUT reflects these values, otherwise the contract may
      // silent-pass. Added 2026-05-27 for Group E (legacy_modules gating).
      feature_flags: z.record(z.string(), z.boolean()).optional(),
    })
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
