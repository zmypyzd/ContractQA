# `contractqa run` end-to-end status — 2026-05-22

Captures what was learned trying to run autopilot's deep-discovery output
(261 contracts on the qa-eval-fixtures Poker target) through `contractqa
run`. Six architectural layers were discovered; layer 5 is fixed
(`6981a71`); layers 1–4 are exploratory work that has been **reverted**
because they're stranded behind the layer 6 design decision; layer 6 is
the entry point for the next session.

## TL;DR

`contractqa run` against autopilot output **has never worked
end-to-end**. The autopilot's deep-discovery emits contracts whose `id`
format (kebab-case, e.g. `agent-picker-cancel-closes-popover`) is
incompatible with `ContractSchema`'s id regex
(`^INV-[A-Z0-9-]+$`). Fixing that requires a design decision (relax the
schema vs constrain the LLM); everything else in the run-path is now
mechanical.

## The six layers

| # | Issue | Status | Notes |
|---|---|---|---|
| 1 | `@playwright/test` not installed in the monorepo (CLI checkPlaywright fails immediately) | **Working tree**, uncommitted | `pnpm add -D -w @playwright/test@1.60.0` was run. Lives in `package.json` + `pnpm-lock.yaml` (uncommitted, intermingled with a parallel session's `yaml@2.9.0` add — left to user to commit in the right grouping). `pnpm exec playwright install chromium` was also run; binary is in `~/Library/Caches/ms-playwright/`. |
| 2 | Playwright's CJS config loader can't import the ESM-only `@contractqa/core` (no `require` export key) — `ERR_PACKAGE_PATH_NOT_EXPORTED` | **Reverted**. Was: rename `playwright.config.ts` → `.mts` + update CLI's hardcoded `--config` flag. Reverted because stranded behind layer 6. | The rename forces Playwright's ESM loader and unblocked the chain. Reapply when layer 6 lands. |
| 3 | `testDir: '.'` defaults walks the whole monorepo and discovers vitest test files — crashes on `import 'vitest'` outside the vitest runner | **Reverted**. Was: add `testIgnore: ['node_modules/**', '.claude/**', 'packages/**', 'apps/**', 'e2e/**', 'dogfood/**']`. | Hardcoded blacklist is brittle; a positive-list approach (`testMatch` pointing at the one contract-runner stub file) is cleaner — but interacts with layer 4 and 6. |
| 4 | Playwright associates `test()` calls with the file that called them. `registerContracts()` (in `packages/runner/dist/playwright-entry.js`) calls `test()` from inside its own module file — the tests get attached to the runner's source file, not the consumer's test file, so they're discarded. | **Reverted**. Was: create `qa-runner.test.mts` at repo root that inlines the contract → `test()` loop in the test file's own lexical scope. | The semantic is non-obvious and worth a code comment in `playwright-entry.ts` regardless of which approach lands. The exported `registerContracts` helper is essentially unusable as currently shaped. |
| 5 | `loadContractsFromDir` doesn't recurse — but autopilot writes contracts into nested `qa/contracts/<module>/` dirs | **Fixed** (`6981a71`) | The eval scorer (`scripts/eval/score.mjs`) was already doing its own recursive walk. The runner now matches. No interaction with layers 1–4 or 6 — standalone improvement. |
| 6 | `ContractSchema` requires `id` to match `^INV-[A-Z0-9-]+$`. Autopilot generates ids like `agent-picker-cancel-closes-popover` (lowercase, no `INV-` prefix). All 261 of v2's generated contracts fail `ContractSchema.parse` on the first file the loader reaches. | **Open — design decision** | See below. |

## Layer 6 — the design decision

Two viable paths; both have downstream consequences. Don't pick by gut —
walk through which one matches the project's identifier strategy.

### α — Relax the schema

`packages/core/src/schemas/contract.schema.ts:101`:

```ts
id: z.string().regex(/^INV-[A-Z0-9-]+$/)
```

Loosen to e.g. `/^[a-zA-Z][a-zA-Z0-9-]*$/`.

- **For**: matches autopilot's actual output. No re-run needed.
  Future autopilot runs keep working as-is. Frees ids to be
  semantically descriptive rather than opaque.
- **Against**: existing `INV-A2 / INV-L1 / INV-B1` style smoke tests
  and seed contracts assumed the prefix carries meaning (auth, lobby,
  billing area inference happens by name pattern in
  `packages/cli/src/commands/run.ts:6-12`'s `PATH_AREA_MAP` — actually
  matches on path patterns, not ids, so probably fine, but verify).
  Existing tests and docs reference INV-XX format.

### β — Constrain the autopilot

In `packages/cli/src/autopilot/interaction-discovery.ts` and any LLM
prompts that drive contract generation: require `id` to start with
`INV-` and be uppercase. Either retroactively rewrite the existing 261
contracts (script) or re-run autopilot from scratch (~18 min + LLM
tokens on the Poker fixture).

- **For**: preserves a meaningful identifier convention that survives
  schema evolution; keeps human-written contracts and LLM-generated ones
  visually distinguishable from area names.
- **Against**: LLM compliance with format constraints is imperfect —
  prompt tightening helps but doesn't guarantee. The rename of 261
  on-disk files is a fragile migration. Future contract sets need the
  same prompt discipline.

### Recommendation framing

α is the smaller, more local change but normalizes the schema downward
to what the LLM actually produces. β is the higher-rigor option but
costs LLM time and adds a permanent compliance burden on prompts.

This is a project-policy decision, not a mechanical one. Bring it to
whoever owns ContractQA's id convention.

## How to resume

1. Pick α or β (or hybrid — relax regex AND tighten prompt).
2. Reapply layers 2/3/4. Suggested cleanups before re-landing:
   - Layer 2: rename + CLI string change is fine as-is.
   - Layer 3: instead of hardcoded blacklist, set
     `testMatch: '<stub-file-name>'` to scope discovery positively.
   - Layer 4: add a doc comment in
     `packages/runner/src/playwright-entry.ts` explaining that
     `registerContracts` cannot be called from a non-test file context;
     consumers must inline the loop in their own `.test.mts`. Or
     refactor `registerContracts` to return contract definitions for
     the caller to register inline (better separation).
3. End-to-end probe: `cd qa-agent && CONTRACTQA_BASE_URL=... contractqa
   run --contracts /abs/path/to/scratch/qa/contracts --artifacts ...`.
   Expect Playwright to list 261 tests, then start running them.
4. Commit `@playwright/test` add (layer 1 from working tree) once
   coordinated with the parallel session's `yaml@2.9.0` add.

## Realistic expectations once it works

Per the in-session evaluation: 15–30% PASS, 30–50% FAIL from
LLM-hallucinated selectors / preconditions, 20–40% INCONCLUSIVE from
unsatisfied `auth_state: logged_in` (fixture has no seeded user). Even
when running mechanically works, **FAIL ≠ real bug** — most failures
will be contract-quality issues, not product bugs. Step-2 review (see
`qa/eval/checklist.md`) is the gate that converts raw run output into
real-bug signal.

## Session pointers

- This session's commits: `f89f5a5`, `0aefe86`, `e2e5e13`, `6981a71`.
- Prior session's deep-discovery LLM-output fix: `6fe4839` — fully
  verified by v2 run; see `qa-autopilot-2026-05-22-v1/` and v2's
  `AUTOPILOT_REPORT.json` for evidence.
- Memory: `[[qa-eval-fixture-poker]]` (fixture layout),
  `[[fixture-prompt-recipes]]` (trigger phrases).
