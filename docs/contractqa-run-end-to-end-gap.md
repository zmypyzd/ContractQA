# `contractqa run` end-to-end status — updated 2026-05-22 (round 2)

Captures what was learned trying to run autopilot's deep-discovery output
(261 contracts on the qa-eval-fixtures Poker target) through `contractqa
run`. Seven architectural layers have been discovered. Layers 1–6 are
fixed and committed; Layer 7 (autopilot uses `expected.*` fields beyond
ContractSchema's surface) is the new entry point for the next session.

## TL;DR

`contractqa run` against **schema-valid** contracts now works end-to-end
— the 4 hand-templated SMOKE contracts in the Poker fixture load, boot
chromium, and produce real PASS/FAIL verdicts. **Schema-invalid**
contracts (the 257 LLM-generated ones in the same fixture) still fail at
load time because the autopilot emits `expected.*` shapes the
ContractSchema doesn't recognize. Resolving that is Layer 7.

## The seven layers

| # | Issue | Status | Notes |
|---|---|---|---|
| 1 | `@playwright/test` not installed in the monorepo (CLI checkPlaywright fails immediately) | **Working tree**, uncommitted | `pnpm add -D -w @playwright/test@1.60.0` was run. Lives in `package.json` + `pnpm-lock.yaml` (uncommitted, intermingled with a parallel session's `yaml@2.9.0` add — left to user to commit in the right grouping). `pnpm exec playwright install chromium` was also run; binary is in `~/Library/Caches/ms-playwright/`. |
| 2 | Playwright's CJS config loader can't import the ESM-only `@contractqa/core` (no `require` export key) — `ERR_PACKAGE_PATH_NOT_EXPORTED` | **Fixed** (`6ae29de`) | Renamed `playwright.config.ts` → `.mts` + updated CLI's hardcoded `--config` flag. Forces Playwright's ESM loader for the whole chain. |
| 3 | `testDir: '.'` defaults walks the whole monorepo and discovers vitest test files — crashes on `import 'vitest'` outside the vitest runner | **Fixed** (`6ae29de`) | Resolved by positive `testMatch: 'qa-runner.test.mts'` rather than a negative blacklist — the only on-disk Playwright "test file" is the contract-runner stub. |
| 4 | Playwright associates `test()` calls with the file that called them. `registerContracts()` (in `packages/runner/dist/playwright-entry.js`) calls `test()` from inside its own module file — the tests get attached to the runner's source file, not the consumer's test file, so they're discarded. | **Fixed** (`6ae29de`) | Created `qa-runner.test.mts` at repo root that loads contracts and inlines the `test()` registration loop in the test file's own lexical scope. Added a doc-comment to `registerContracts()` warning future callers about the file-context limitation; the export stays as-is for backward compatibility. |
| 5 | `loadContractsFromDir` doesn't recurse — but autopilot writes contracts into nested `qa/contracts/<module>/` dirs | **Fixed** (`6981a71`) | The eval scorer (`scripts/eval/score.mjs`) was already doing its own recursive walk. The runner now matches. |
| 6 | `ContractSchema` requires `id` to match `^INV-[A-Z0-9-]+$`. Autopilot generates ids like `agent-picker-cancel-closes-popover` (lowercase, no `INV-` prefix). | **Fixed** (`a03b6d8`) | α-broadest: relaxed to `^[a-zA-Z][a-zA-Z0-9-]*$` (max 100). Backward compatible (every INV-XX id still passes). Naming convention moved out of schema into docs/lint concern. |
| 7 | `expected.*` field shape divergence: autopilot emits `expected.url: <string>`, `expected.response_body_excludes: [...]`, `expected.visible: [{element, description}]`, `expected.autoplay_state: ...`, `expected.input_value: {...}` — all but the first are fields ContractSchema doesn't declare at all; the first is in schema but as an object (`{ matches: SafeRegex }`), not a bare string. | **Open — same class as Layer 6 was** | See below. |

## Verification of layers 1–6

End-to-end probe pointing at the 4 SMOKE-* contracts (`cli/src/autopilot/smoke-patterns.ts` outputs, schema-clean by construction):

```
$ CONTRACTQA_BASE_URL=http://127.0.0.1:5273 \
    CONTRACTQA_CONTRACTS_DIR=/path/to/fixture/scratch/qa/contracts/_smoke \
    pnpm exec playwright test --config=playwright.config.mts

  qa-runner.test.mts:34:3 › SMOKE-api-anon-unauthorized
  qa-runner.test.mts:34:3 › SMOKE-nonexistent-route-404
  qa-runner.test.mts:34:3 › SMOKE-password-not-in-url
  qa-runner.test.mts:34:3 › SMOKE-root-not-500
  4 failed
```

The 4 failures are content issues (a `localStorage` SecurityError in the
snapshot helper hits `about:blank` pages before the goto action lands;
this lives in `qa-runner.test.mts:34-38` mirrored from `packages/runner/
src/playwright-entry.ts`), not infrastructure issues. **Pipeline works.**

## Layer 7 — the design decision

Same shape as Layer 6 was, but multiplied across many `expected.*`
fields. Likely candidates:

| Autopilot field | ContractSchema currently | Real fix |
|---|---|---|
| `expected.url: "/agents"` | `expected.url: { matches: SafeRegex }` | Schema accepts string shorthand → object normalization, OR autopilot emits object form |
| `expected.response_body_excludes: [...]` | undeclared | Add to schema (HTTP-action support already exists; this is one slice of it) |
| `expected.visible: [{element, description}]` | `expected.visible: [{ selector, present }]` | Reconcile field names (`element` vs `selector`, `description` vs `not modeled`) |
| `expected.autoplay_state`, `expected.input_value`, etc. | undeclared | Decide: extend schema, or constrain autopilot output to declared fields only |

Two systemic options (same α vs β framing as Layer 6):

- **α (broaden schema)** — add `passthrough()` / `catchall()` to the
  expected object to accept arbitrary extra fields, normalize known
  shorthand (e.g. string → `{ matches }` for `url`). Loader becomes a
  forgiving normalizer; runner ignores unknown fields. Easy to implement
  but **gives up runtime enforcement** of contract correctness.
- **β (constrain autopilot)** — extend autopilot's prompt to enumerate
  the allowed `expected.*` fields and their shapes, with examples; add a
  schema validation pass during autopilot write that rejects malformed
  proposals. Higher rigor but requires LLM compliance + retroactive
  rewrite (or rerun) of the 261 already-on-disk contracts.

α-broadest precedent from Layer 6 suggests **α here too** is the
proportional response — but Layer 7 affects more surface area than Layer
6 did, so it warrants its own evaluation rather than blind α reflexive.

A **third option (γ)** worth considering: make `loadContractsFromDir`
skip-and-warn on schema failures (collect what validates, log the rest
with a count summary). Doesn't fix the underlying mismatch but lets
users still get partial output from autopilot runs. Pragmatic; orthogonal
to α/β.

## How to resume

1. Decide Layer 7 strategy (α / β / γ — or hybrid).
2. End-to-end probe: `cd qa-agent && CONTRACTQA_BASE_URL=... contractqa
   run --contracts /abs/path/to/scratch/qa/contracts --artifacts ...`.
   Expect Playwright to list ~261 tests, then start running them.
3. Real bugs found ≠ FAIL count — see "Realistic expectations" below.
4. Commit `@playwright/test` add (layer 1 from working tree) once
   coordinated with the parallel session's `yaml@2.9.0` add.

## Secondary findings (not layers, but worth fixing)

- `qa-runner.test.mts:34-38` (mirroring `playwright-entry.ts:9-13`)
  calls `page.evaluate(() => Object.keys(localStorage))` unconditionally.
  This throws `SecurityError: Failed to read the 'localStorage' property`
  whenever Playwright is on `about:blank` (i.e. before the contract's
  first `goto` lands), which currently fails all four SMOKE tests.
  Wrap with try/catch returning `[]` on SecurityError.
- `contractqa run` runs from qa-agent root because of the relative path
  in `playwright.config.mts` (`./packages/runner/dist/index.js`). The
  CLI doesn't enforce this — running from any other cwd will fail with
  "config not found". Either resolve the config path from the CLI's
  install location, or document the cwd constraint.

## Realistic expectations once Layer 7 lands

Per the in-session evaluation: 15–30% PASS, 30–50% FAIL from
LLM-hallucinated selectors / preconditions, 20–40% INCONCLUSIVE from
unsatisfied `auth_state: logged_in` (fixture has no seeded user). Even
when running mechanically works, **FAIL ≠ real bug** — most failures
will be contract-quality issues, not product bugs. Step-2 review (see
`qa/eval/checklist.md`) is the gate that converts raw run output into
real-bug signal.

## Session pointers

- This session's commits (chronological):
  - `f89f5a5`, `0aefe86`, `e2e5e13` — non-git cwd + CLI progress
  - `6981a71` — Layer 5 (loader recursion)
  - `07a0d0a` — first version of this gap doc
  - `a03b6d8` — Layer 6 (schema id relax, α-broadest)
  - `6ae29de` — Layers 2/3/4 (config rename, testMatch, stub file, doc comment)
- Prior session's deep-discovery LLM-output fix: `6fe4839` — fully
  verified by v2 run; see `qa-autopilot-2026-05-22-v1/` and v2's
  `AUTOPILOT_REPORT.json` for evidence.
- Memory: `[[qa-eval-fixture-poker]]` (fixture layout),
  `[[fixture-prompt-recipes]]` (trigger phrases).
