# ContractQA Autopilot — Vibecoder Onboarding Design

**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Date:** 2026-05-17
**Target release:** v1.x (additive; no v1.0 package APIs change)
**Approver:** zmy
**Pair file:** Implementation plan will live at `docs/superpowers/plans/2026-05-17-autopilot-phase-1.md`

---

## 1. Summary

ContractQA today requires users to write product contracts in YAML. This is a
hard onboarding cliff for non-QA-experienced developers ("vibecoders" / indie
hackers / solo product builders). This design adds a new CLI command
`contractqa autopilot` that:

1. Runs 6-8 universal smoke patterns instantly (Phase A).
2. Reads the user's source code with an LLM to **deeply mine** product features,
   generates per-module contracts, persists them to `qa/contracts/`,
   asks Y/N or multiple-choice questions for low-confidence proposals
   (Phase B, streaming per-module).
3. Hands failing contracts to the existing `@contractqa/orchestrator`
   auto-fix loop and applies the resulting diffs to the user's working
   directory (Phase C).
4. Gracefully aborts on a 30-minute time budget, on user Ctrl-C, and on
   per-module errors, always preserving partial results.

The autopilot does not touch any v1.0 public package API. It is purely
additive: a new CLI command + a new LLM-client subsystem inside
`@contractqa/orchestrator` (subpath export, internal). A second, minor refactor
re-routes orchestrator's own LLM calls through the same abstraction.

## 2. Goals

- **Zero-YAML onboarding** for users who do not know contractqa's contract DSL.
- **Magic but auditable**: AI writes YAML to `qa/contracts/`; user can read,
  edit, commit, re-run.
- **LLM-provider neutral**: works with MiniMax / OpenAI / OpenRouter / Anthropic
  SDK / Claude Code subscription, with deterministic fallback chain.
- **Single command, multiple stops**: `contractqa autopilot` is the only
  command vibecoders need to learn; flags exist for power users.
- **Bounded cost**: hard 30-minute time budget by default; never silently
  exceeds.
- **Safe diff application**: never mutates the user's git history; never
  destroys uncommitted work (git stash protection).

## 3. Non-goals

- Replacing the existing YAML-authoring workflow. Power users keep `init` and
  hand-written contracts.
- Producing 100 % feature coverage. LLM cannot perfectly enumerate every
  invariant; uncertain ones become Y/N questions, low-confidence ones are
  skipped with explicit report.
- Supporting non-Node frontends (Python/Go web frameworks) in v1.
- Replacing `contractqa run` / `doctor` / `scan` / `invariants-gen` — autopilot
  composes them, does not subsume them.
- Auto-creating GitHub PRs (`--pr` mode is deferred to v2).
- Operating contractqa-hosted proxy with free-trial inference credits
  (operational complexity out of scope; see option E in §11).

## 4. Locked design decisions

These nine forks were resolved during brainstorming and are not subject to
re-negotiation in the implementation plan:

| # | Decision | Choice |
|---|---|---|
| 1 | Target user | Vibecoder / indie / no-QA-experience |
| 2 | Invocation mode | Local white-box (`cd my-app && contractqa autopilot`) |
| 3 | Test source | Hybrid — smoke patterns instant + LLM contracts streamed in background |
| 4 | Contract persistence | Durable — write to `qa/contracts/`, re-run reuses |
| 4.5 | Discovery method | LLM mines code + docs; high-confidence written silently; uncertain proposals trigger Y/N or multiple-choice user prompts |
| 5 | Confirmation UX | Streaming per functional module (per module: high-confidence silent + uncertain batched together) |
| 6 | Authentication | Layered fallback — sniff `.env`, then framework-native temp user, then interactive prompt. **MVP**: only the `.env` sniff layer + a skip-with-warning fallback. |
| 7 | Failure handling | Auto-fix loop (invokes existing `@contractqa/orchestrator`) |
| 8 | Diff application | Apply to working directory with `git stash` protection of user's uncommitted changes; do not auto-commit |
| 9 | Safety rail | 30-minute time budget (single rail); on trigger, gracefully abort and emit partial report |

Three smaller decisions were also resolved:

- **LLM client location** = Option Y (inside `@contractqa/orchestrator`, exposed
  via `./llm` subpath; not a new package).
- **v1 smoke pattern count** = 6-8.
- **`--yes` flag semantics** = accept LLM's `defaultAnswer` for any uncertain
  proposal (do not skip the contract).
- **Orchestrator does not share autopilot's time budget** — independent.

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  contractqa autopilot                                           │
│  cli/src/commands/autopilot.ts (~150 lines, orchestrator)       │
└─────────────────────────────────────────────────────────────────┘
                                ↓
        ┌───────────────────────┼─────────────────────────────┐
        ↓                       ↓                             ↓
┌─────────────────┐  ┌───────────────────┐         ┌──────────────────┐
│ Phase A: Smoke  │  │ Phase B: Discovery│         │ Phase C: Fix     │
│ (2-5 s)         │  │ (10-90 s)         │         │ (≤30 min cap)    │
│                 │  │                   │         │                  │
│ smoke-patterns/ │  │ llm-discovery/    │         │ existing         │
│ + scan          │  │ + scan            │         │ orchestrator     │
│ + doctor        │  │ + interactive-    │         │ + stash-guard    │
│ + run           │  │   prompt          │         │ + budget-watchdog│
└─────────────────┘  └───────────────────┘         └──────────────────┘
        ↓                       ↓                             ↓
        └───────────────────────┴─────────────────────────────┘
                                ↓
                  qa/contracts/*.yml  (persistent)
                  evidence/ (failure evidence)
                  Report: terminal + qa/AUTOPILOT_REPORT.md
```

**New code lives entirely in two locations:**

- `packages/cli/src/autopilot/` — five internal modules.
- `packages/orchestrator/src/llm/` — LLM client abstraction (Option Y) with
  three concrete clients, exposed via `@contractqa/orchestrator/llm` subpath.

**Existing modules are reused without modification** (except a single internal
behaviour change in orchestrator, §9.4):

- `cli/src/init/detect-framework.ts`
- `cli/src/init/inspect-auth.ts`
- `cli/src/commands/doctor.ts`
- `cli/src/commands/run.ts`
- `@contractqa/orchestrator` (LLM call site swapped for `LLMClient.generate`)
- `@contractqa/evidence`, `@contractqa/repro`

## 6. Module breakdown

### 6.1 LLM client abstraction — `packages/orchestrator/src/llm/`

```ts
export interface LLMClient {
  readonly providerName: 'openai-compatible' | 'anthropic-sdk' | 'claude-agent-sdk';
  readonly modelHint: string;
  generate(opts: {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }>;
}

export function pickClient(): LLMClient;
```

Default detection order in `pickClient()`:

1. `process.env.OPENAI_API_KEY` is set → `OpenAICompatibleClient`
   (also reads `OPENAI_BASE_URL` if set; works for MiniMax, DeepSeek,
   OpenRouter, OpenAI.com).
2. `process.env.ANTHROPIC_API_KEY` is set → `AnthropicSDKClient`.
3. `@anthropic-ai/claude-agent-sdk` is resolvable AND a Claude Code
   credential file exists at the SDK's default location (the SDK inherits
   auth from a local Claude Code installation) → `ClaudeAgentSDKClient`
   (runs in-process; no `claude` subprocess is spawned).
4. None of the above → throw `ConfigError` with a human-readable message
   describing the three configuration options.

The same abstraction is used by `@contractqa/orchestrator`'s own LLM calls
(replacing the current `spawn('claude', ['--bare', '-p', ...])` sites).

Subpath export added to `packages/orchestrator/package.json`:

```json
"exports": {
  ".": "./dist/index.js",
  "./llm": "./dist/llm/index.js"
}
```

### 6.2 `cli/src/autopilot/smoke-patterns.ts`

```ts
export interface SmokePattern {
  id: string;
  title: string;
  appliesTo: (ctx: TargetContext) => boolean;
  generate: (ctx: TargetContext) => ContractSpec;
}
export const SMOKE_PATTERNS: readonly SmokePattern[];
```

v1 catalogue (6-8 patterns, exact list to be finalised in implementation
plan):

1. `/` returns non-5xx.
2. `/nonexistent-${random}` returns 4xx.
3. Any `<form method="POST">` posts to HTTPS in production builds.
4. No `<input type="password">` value appears in a GET URL.
5. If localStorage is touched in source AND an auth provider is detected,
   logout clears provider-specific keys (`sb-*` for Supabase, `clerk-*` for
   Clerk, `auth-*` generic).
6. If `app/api/` (or equivalent) exists, an anonymous request to a sample
   route returns 401 or a redirect.
7. (optional) Detected CSRF middleware emits the token into SSR-rendered
   forms.
8. (optional) If Supabase RLS is detected, an anonymous SELECT on a sample
   protected table returns 0 rows or 403.

### 6.3 `cli/src/autopilot/llm-discovery.ts`

```ts
export interface ContractProposal {
  yaml: string;
  confidence: 'high' | 'medium' | 'low';
  module: string;
  uncertainQuestions?: Array<{
    text: string;
    type: 'yes-no' | 'multiple-choice';
    choices?: string[];
    defaultAnswer: string;
    appliesTo: 'whole-contract' | { jsonPath: string };
  }>;
  evidence: { sourceFiles: string[]; rationale: string };
}

export async function discoverByModule(
  ctx: TargetContext,
  llm: LLMClient,
  onModule: (module: string, proposals: ContractProposal[]) => Promise<void>,
  signal: AbortSignal,
): Promise<void>;
```

Streaming contract: `onModule` is awaited per module; the next module's LLM
call does not start until the prior `onModule` resolves. This is the
mechanism that lets the editor apply / prompt / run for each module before
moving on.

### 6.4 `cli/src/autopilot/interactive-prompt.ts`

```ts
export async function confirmUncertainProposals(
  module: string,
  proposals: ContractProposal[],
  io: { in: Readable; out: Writable },
  opts: { yes?: boolean },
): Promise<{
  accepted: ContractProposal[];
  rejected: ContractProposal[];
  skipped: ContractProposal[];
}>;
```

If `opts.yes` is true, the function returns immediately with each proposal's
`defaultAnswer` applied and all moved to `accepted`. Otherwise, it walks the
user through each `uncertainQuestions` entry, expecting Y/N or letter choice
input. SIGINT during prompting moves the remaining proposals to `skipped`
and resolves the promise.

### 6.5 `cli/src/autopilot/stash-guard.ts`

```ts
export interface StashGuard {
  protect(): Promise<{ stashed: boolean; stashRef?: string }>;
  release(): Promise<void>;
}
export function createStashGuard(cwd: string): StashGuard;
```

`protect()` runs `git status --porcelain`; if non-empty, runs
`git stash push -u -m "contractqa-autopilot-${timestamp}"` and stores the
ref. `release()` does NOT `git stash pop` — it prints a reminder to the
user and leaves the stash intact (so partial autopilot failure cannot lose
work).

### 6.6 `cli/src/autopilot/budget-watchdog.ts`

```ts
export function startTimeBudget(
  ms: number,
  abortController: AbortController,
): { cancel: () => void; status: () => { elapsedMs: number; remainingMs: number } };
```

A single `setTimeout` calling `abortController.abort()`. All async operations
in autopilot subscribe to the same signal.

### 6.7 `cli/src/commands/autopilot.ts` (orchestrator)

```ts
export interface AutopilotOptions {
  cwd: string;
  timeBudgetMs?: number;        // default 30 * 60 * 1000
  fix?: boolean;                // default true; --no-fix → report-only
  yes?: boolean;                // skip Y/N prompts using LLM defaultAnswers
  regenerate?: boolean;         // force re-run of LLM discovery
  llmClient?: LLMClient;        // test injection; default pickClient()
}

export interface AutopilotReport {
  phaseA: { passed: number; failed: number; failures: SmokeFailure[] };
  phaseB: { generated: number; userConfirmed: number; userRejected: number };
  phaseC?: { attempted: number; fixed: number; givenUp: number; diffs: string[] };
  budgetTriggered: 'time-budget' | 'user-interrupt' | null;
  durationMs: number;
  llmCostHint?: string;
}

export async function runAutopilot(opts: AutopilotOptions): Promise<AutopilotReport>;
```

CLI binding wires `--time-budget`, `--no-fix`, `--yes`, `--regenerate` flags to
the equivalent option fields.

## 7. Data flow

Phase A → B → C are **strictly serial**. Phase B is internally streaming
per module: each module's contracts are written and run before the next
module's LLM call begins.

```
0s ──────── 2s ───── 5s ─────── 30s ──────── 90s ─────── ≤30min ────── End

┌─Bootstrap─┐
│ flags     │
│ AbortCtrl │ ◄── 30 min timer
│ stash user│
│ detect FW │
│ pickClient│
└─────┬─────┘
      ↓
      ┌──Phase A: Smoke──┐
      │ 6-8 templates    │
      │ write _smoke/    │
      │ compile + run    │
      │ collect failuresA│
      └────────┬─────────┘
               ↓
               ┌────Phase B: Discovery (per module)────┐
               │ for each module from discoverByModule:│
               │   write high-conf YAMLs to            │
               │     qa/contracts/<module>/            │
               │   confirmUncertainProposals(...)      │
               │   compile + run module's contracts    │
               │   accumulate failuresB                │
               └────────┬──────────────────────────────┘
                        ↓
                        ┌────Phase C: Auto-fix────┐
                        │ failuresA first, then B │
                        │ for f in failures:      │
                        │   if budget gone: break │
                        │   orchestrator.fix(f)   │
                        │   if regression: undo   │
                        │   queue successful diff │
                        └────────┬────────────────┘
                                 ↓
                                 ┌─Apply Diffs─┐
                                 │ unified     │
                                 │ apply all   │
                                 │ at once     │
                                 │ no commit   │
                                 └──────┬──────┘
                                        ↓
                                        ┌──Report──┐
                                        │ terminal │
                                        │ + .md    │
                                        │ + stash  │
                                        │   hint   │
                                        └──────────┘
```

**Directory layout** under the user's project:

```
qa/contracts/
├── _smoke/                    ← Phase A
│   ├── SMOKE-404.yml
│   └── SMOKE-https-form.yml
├── _quarantine/               ← LLM outputs that failed validation
│   └── auth-2026-05-17T11-42.txt
└── <module>/                  ← Phase B
    ├── auth/
    │   ├── login-redirect.yml
    │   └── logout-clears-session.yml
    └── orders/
        └── owner-only-delete.yml
```

The `_` prefix on `_smoke/` and `_quarantine/` ensures they sort first
visually and clearly mark them as autopilot-generated.

**Failure priority into Phase C**: failures from Phase A precede failures
from Phase B, regardless of chronological order. Rationale: smoke failures
indicate more fundamental issues; fixing them first may make B failures
disappear.

**Diff application strategy**: unified at the end. All successful fix
diffs are applied in one pass after Phase C completes, never incrementally
during fix iteration. Rationale: avoids mid-flight conflicts between
overlapping fixes and gives the user a single "after autopilot" diff to
review.

## 8. Authentication strategy (MVP scope)

Decision §4.6 selected the full layered fallback `A → B → C` as the target
state. MVP ships only the first layer + a graceful skip:

1. **A (`.env` sniff)**: read `.env.local`, `.env.test`, `.env.example`
   for known credential keys. Initial v1 catalogue:
   - `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD`
   - `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`
   - `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`
   - `PLAYWRIGHT_AUTH_EMAIL` / `PLAYWRIGHT_AUTH_PASSWORD`

2. **Fallback (skip with warning)**: if no creds are found, autopilot still
   runs but skips invariants that require `auth_state: logged_in` in their
   preconditions, surfacing in the report:

   ```
   ⚠️  跳过了 N 条需要登录的 invariant。
       配置 SUPABASE_TEST_EMAIL + SUPABASE_TEST_PASSWORD（或类似变量）后重跑。
   ```

3. **Deferred to v1.x**: layer B (framework-native temp user creation via
   Supabase service_role / Clerk testing tokens / NextAuth dev seed /
   Auth0 Management API) and layer C (interactive prompt + encrypted local
   cred storage). Each is a self-contained additive feature; neither breaks
   MVP behaviour.

## 9. Error handling

Three principles govern every error path:

1. **Fail loud, recover gracefully** — every error produces a human-readable
   message with symptom / probable cause / next command. Never bare stack
   traces.
2. **Partial results always have value** — on time budget exhaustion or
   Ctrl-C, already-applied diffs stay applied; in-flight work is discarded;
   report shows what completed.
3. **Re-running picks up where it left off** — existing `qa/contracts/`
   files are treated as checkpoints; autopilot is idempotent. `--regenerate`
   forces full re-discovery.

### 9.1 Bootstrap errors

| Error | Response |
|---|---|
| Not a git repo | Fatal; suggest `git init`; do not auto-init |
| No `package.json` | Fatal; describe detected directory contents |
| Framework not detectable | Warning; skip framework-specific smoke patterns; continue |
| All 3 LLM clients unavailable | Fatal; emit three configuration paths |
| `qa/` not writable | Fatal; suggest permission check |
| `git stash` fails | Fatal; explain (usually detached HEAD or merging) |

### 9.2 Phase A errors

| Error | Response |
|---|---|
| Boot probe fails | Skip boot-required patterns; run schema-only patterns; report cites `doctor --fix=<list>` for remediation |
| Chromium missing | Offer to run `npx playwright install chromium` once; on decline, skip browser patterns |
| Smoke pattern compile error (internal bug) | Log to report's `internal-errors` section; do not crash |
| Playwright timeout | Treat as Phase A failure; goes to Phase C queue |

### 9.3 Phase B errors

| Error | Response |
|---|---|
| LLM 429 | Exponential backoff 1 / 2 / 4 / 8 s, max 4 retries; on all-fail, skip module |
| LLM timeout per call | Same retry path |
| Malformed YAML output | One retry with explicit "previous output unparseable" feedback prompt; on second fail, write raw output to `qa/contracts/_quarantine/<module>-<timestamp>.txt` |
| Zod schema validation failure | Same quarantine path |
| User Ctrl-C during prompt | Remaining uncertain → `skipped`; previously confirmed → kept; proceed to Phase C |
| LLM cost exceeds estimate | Non-fatal; surface usage in final report |

### 9.4 Phase C errors

| Error | Response |
|---|---|
| Worktree creation fails | Skip this fix; record; continue |
| Orchestrator hits its own `maxAttempts` | Mark `gaveUp`; continue |
| **Regression** — fix breaks a previously passing contract | Orchestrator re-runs the entire `qa/contracts/` set after each successful fix (autopilot-generated and any pre-existing hand-written ones); detected regression → revert fix → mark `gaveUp`. **This is a new orchestrator behaviour** (additive `verifyScope: 'one' \| 'all'` parameter, ~30 lines change), opt-in via flag passed from autopilot. |
| 30-minute budget hits | AbortController → in-flight orchestrator iteration aborts; already-successful diffs preserved; not-yet-applied diffs discarded |

### 9.5 Apply-diff errors

| Error | Response |
|---|---|
| Diff fails to apply cleanly | Skip; report includes path for manual copy |
| Permission denied | Same |
| Git in merging / rebasing state | Caught in Bootstrap; never reached here |

### 9.6 Cleanup errors

| Error | Response |
|---|---|
| `git stash` conflict on apply | Do NOT auto-pop; report tells user stash ref + suggests `git stash apply` |
| Worktree cleanup fails | Warn; print manual `git worktree remove --force` command |

### 9.7 User-facing error message format

Every user-visible error has three sections: **symptom**, **probable
cause**, **next command**.

```
✗ autopilot stopped: cannot find qa/contracts/auth.yml

  Possible causes:
    - autopilot was interrupted last run and didn't finish writing the file
    - someone manually deleted it

  Next:
    $ contractqa autopilot --regenerate
```

(Messages are English in v1 to match the rest of the CLI surface. A
future minor release may introduce locale-aware messages.)

### 9.8 Top-level panic guard

Any uncaught exception is caught by a top-level handler that:

1. Calls `stashGuard.release()` synchronously.
2. Aborts the global AbortController.
3. Writes the stack trace to `qa/.autopilot-crash-<timestamp>.log`.
4. Prints a one-line user message and a GitHub issue link.
5. Exits with code 2 (distinct from code 1 = "tests failed").

## 10. Testing strategy

### 10.1 Test pyramid

| Layer | Count | Tooling |
|---|---|---|
| Unit | ~30 | vitest, pure functions / mocked deps |
| Integration | ~5 | vitest, mock `LLMClient`, real filesystem, real `git init` in tempdir |
| E2E offline | 1 | cassette / VCR replay against `dogfood/wolfmind` |
| E2E live (opt-in) | 1 | real LLM, gated on `RUN_LIVE_LLM_TESTS=1` env var |

### 10.2 Cassette / VCR strategy

LLM responses are recorded once and committed as JSON fixtures in
`tests/fixtures/llm-cassettes/`. The default test run replays from cassette;
re-recording is opt-in via `UPDATE_CASSETTES=1`. Implementation: a
`RecordingLLMClient` decorator wrapping the real client.

### 10.3 CI vs local

| Test class | CI | Trigger |
|---|---|---|
| Unit | ✅ | every PR |
| Integration (mocked LLM) | ✅ | every PR |
| E2E offline (cassette) | ✅ | every PR |
| E2E live (real LLM) | ❌ | local + `RUN_LIVE_LLM_TESTS=1` |
| Cassette refresh | ❌ | local + `UPDATE_CASSETTES=1`; diff lands in PR |

### 10.4 Quality regression test

`e2e/autopilot-on-wolfmind.test.ts` runs autopilot against
`dogfood/wolfmind/` (which has hand-written contracts) and asserts a
**60 % overlap** between generated and hand-curated contracts. This catches
prompt regressions and LLM-quality drift.

### 10.5 Failure scenario coverage matrix

Each error case in §9.1–9.6 has at least one targeted test.

### 10.6 Out-of-scope tests

- Multi-dogfood quality benchmark (deferred to a separate post-v1 project).
- Cross-LLM-provider output consistency (the Y/N prompt design already
  absorbs LLM variance).
- Long-running memory leak tests (30-min cap makes this irrelevant).

### 10.7 Estimated test code volume

~2030 lines of test code across the new modules and cassette fixtures.
Test-to-product ratio ≈ 1.5×.

## 11. Implementation scope summary

### 11.1 New code

| Location | Lines | Purpose |
|---|---|---|
| `packages/cli/src/autopilot/smoke-patterns.ts` | ~200 | 6-8 universal patterns |
| `packages/cli/src/autopilot/llm-discovery.ts` | ~300 | per-module streaming discovery |
| `packages/cli/src/autopilot/interactive-prompt.ts` | ~150 | Y/N + multi-choice UX |
| `packages/cli/src/autopilot/stash-guard.ts` | ~80 | git stash protection |
| `packages/cli/src/autopilot/budget-watchdog.ts` | ~60 | 30-min AbortController timer |
| `packages/cli/src/commands/autopilot.ts` | ~150 | top-level orchestrator |
| `packages/orchestrator/src/llm/index.ts` | ~50 | `LLMClient` interface + `pickClient` |
| `packages/orchestrator/src/llm/openai-compatible-client.ts` | ~80 | MiniMax / OpenAI / OpenRouter |
| `packages/orchestrator/src/llm/anthropic-sdk-client.ts` | ~80 | direct Anthropic API |
| `packages/orchestrator/src/llm/claude-agent-sdk-client.ts` | ~80 | in-process via Claude Agent SDK |
| `packages/orchestrator/package.json` exports map update | ~5 | `./llm` subpath |
| Orchestrator LLM call site replacements | ~50 modifications | internal refactor |
| **Production code subtotal** | **~1285 new + ~50 modified** | |
| Tests (see §10.7) | **~2030** | |
| **Total** | **~3315** | |

### 11.2 No breaking changes

Public v1.0.0 surface (`contractqa` CLI commands + `@contractqa/adapters/public`
+ `@contractqa/runner/http`) is untouched. Only orchestrator's internal LLM
call mechanism changes, and orchestrator is classified as an internal
package in `STABILITY.md`.

### 11.3 New runtime dependencies

- `@anthropic-ai/claude-agent-sdk` (optional peer; only loaded by
  `ClaudeAgentSDKClient` when selected)
- `openai` (for `OpenAICompatibleClient`; OpenAI-format SDK)
- `@anthropic-ai/sdk` (direct Anthropic; for `AnthropicSDKClient`)

All three are loaded lazily — only the picked client's SDK is required at
runtime, so consumers using `OPENAI_API_KEY` never load the Anthropic SDK.

### 11.4 Deferred to v2

- `--pr` flag for auto-creating GitHub PRs from autopilot diffs.
- Full three-rail budget (time + steps + cost) — single time rail suffices
  in v1.
- Framework-native temp user authentication (layer B of §8).
- Interactive credential prompt with encrypted local storage (layer C of §8).
- Quality benchmark across multiple dogfood projects.

### 11.5 New CHANGELOG entry plan

Target version: **v1.1.0** (additive minor release).

```
## v1.1.0 — <date>

### Added
- `contractqa autopilot` command: zero-YAML onboarding for new users.
  Reads source code, generates contracts via LLM, asks Y/N questions for
  uncertain inferences, persists to `qa/contracts/`, runs the suite, and
  hands failures to the existing auto-fix loop. See [AUTOPILOT.md] for
  details.
- New `@contractqa/orchestrator/llm` subpath exporting `LLMClient`
  interface and provider clients (OpenAI-compatible, Anthropic SDK,
  Claude Agent SDK).

### Changed (non-breaking)
- `@contractqa/orchestrator` internal LLM calls now route through
  `LLMClient` abstraction. The public orchestrator API is unchanged.

### STABILITY
- `@contractqa/orchestrator/llm` is classified as **internal** —
  its API may change in any minor release. The `contractqa autopilot`
  CLI command is **@stable**.
```

## 12. Open questions for implementation plan

The following details were deliberately left to the implementation plan
rather than relitigated in design:

1. Final wording for the user-facing error message templates (Section 9.7).
2. Exact prompt engineering for `llm-discovery.ts` (system prompt + per-module
   instructions + confidence-scoring rubric).
3. Final list of `.env` credential key names to sniff (§8).
4. The 6-8 v1 smoke pattern catalogue — exact wording, edge cases.
5. Whether to use `prompts` or a custom readline-based prompter in
   `interactive-prompt.ts`.
6. JSON schema for the `qa/AUTOPILOT_REPORT.md` machine-readable companion
   (`qa/AUTOPILOT_REPORT.json`).

These will be resolved in the writing-plans phase via the same brainstorming
discipline (per-item discussion, locked decisions).

---

**End of design.** Implementation plan to follow at
`docs/superpowers/plans/2026-05-17-autopilot-phase-1.md`.
