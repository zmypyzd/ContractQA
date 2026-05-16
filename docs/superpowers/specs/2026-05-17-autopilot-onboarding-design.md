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

**Stability classification**: `@contractqa/orchestrator/llm` is marked
**`@experimental`** at v1.1.0. Its TypeScript types carry the
`@experimental` JSDoc tag (same convention as `runHttpContract` at v1.0,
per existing `STABILITY.md`). Rationale: putting an LLM-provider
abstraction inside an existing internal package means the abstraction's
release cadence is tied to orchestrator. Marking it `@experimental` for
v1.x lets us iterate (e.g., add streaming, tool-calling, structured-output
support) without claiming semver protection. Promotion to `@stable` or
extraction to a separate `@contractqa/llm-client` package is an explicit
future-major decision.

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
export interface StashedItem {
  path: string;
  state: 'modified' | 'staged' | 'untracked' | 'untracked-gitignored';
  isSensitive: boolean;  // matches *.env*, *.pem, *secret*, *credential*, *key*
}
export interface StashGuard {
  protect(): Promise<{
    stashed: boolean;
    stashRef?: string;
    items?: readonly StashedItem[];
    sensitiveCount?: number;
  }>;
  release(): Promise<void>;
}
export function createStashGuard(cwd: string): StashGuard;
```

`protect()` runs `git status --porcelain` plus `git ls-files
--others --ignored --exclude-standard` to enumerate **all** files the
stash will absorb — including gitignored ones (`-u` semantics).
For each file, it classifies as `modified` / `staged` / `untracked` /
`untracked-gitignored` and flags sensitivity via filename pattern match
(`*.env*`, `*.pem`, `*secret*`, `*credential*`, `*key*`).

If `protect()` is called with any sensitive item, **the autopilot
command pauses and requires explicit user confirmation before running
`git stash push -u`** — bypasses §4 decision 9's "no Y/N during the
happy path" only for this data-safety case. The prompt enumerates
the sensitive files; user can answer `y` (proceed), `n` (abort
autopilot), or `commit` (stage and commit them first, then re-run).
`--yes` flag is **not** honoured here — sensitive-file confirmation
is the one prompt that always blocks.

`release()` does NOT `git stash pop`. It prints (a) the full list of
stashed items, (b) explicit warning for sensitive files
("`.env.local` etc. are in stash ref `stash@{0}`; running `git stash
drop` will permanently delete them"), and (c) the suggested recovery
command (`git stash apply --index`, not `pop`).

**Submodules**: `git stash push -u` silently skips dirty submodule
working trees. `protect()` detects submodules via
`git submodule status` and, if any are dirty, **also blocks with a
required confirmation** ("autopilot cannot protect changes in dirty
submodule X; abort or proceed at your own risk?").

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

Phase A is fully serial. **Phase C runs concurrently with Phase B once
Phase A finishes** — Phase A's failures are eagerly fed to the auto-fix
loop while Phase B's per-module discovery is still streaming. Phase B is
internally streaming per module: each module's contracts are written and
run before the next module's LLM call begins, but **B's failures join
the same Phase C queue without waiting for B to finish**.

Rationale: smoke patterns take 2-5 s; Phase B discovery takes 10-90 s.
Blocking Phase C until B finishes wastes 60-90 s of the 30-min budget
on the worst-case project. Concurrency is intentional and scoped — only
Phase C reads from a queue that A and B both feed.

**Concurrency contract**:
- Phase A failures → enqueued for Phase C as soon as A finishes.
- Phase B failures (per module) → enqueued for Phase C as soon as that
  module's contracts have run.
- Phase C is a single-consumer worker loop: it pulls from the queue,
  runs the orchestrator fix, applies/discards based on regression check
  outcome, and pulls the next. Never concurrent with itself (orchestrator
  worktrees are sequential).
- Phase B's per-module loop and Phase C's worker loop run on separate
  promises against the same `AbortController`.

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
      │ collect failuresA│ ───┐
      └────────┬─────────┘    │
               ↓               │ (concurrent)
               ┌────Phase B────┐  ┌────Phase C: Auto-fix worker────┐
               │ discoverByMod │  │ (consumes from shared queue)   │
               │ for each mod: │  │ priority: failuresA first      │
               │   write YAMLs │  │ pulls next: smoke A → mod1 → … │
               │   prompt      │  │ for f in queue:                │
               │   compile+run │  │   if budget gone: break        │
               │   enqueue ───►│──┤   orchestrator.fix(f)          │
               │   failuresB   │  │   verifyScope:'touched-files'  │
               └───────┬───────┘  │   if regression: undo          │
                       ↓          │   queue successful diff        │
                       (Phase B   │                                │
                        finishes) │                                │
                                  └────────────┬───────────────────┘
                                               ↓
                                               (Phase C drains queue or
                                                budget expires)
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
                                                      │ + .json  │
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

**Failure priority into Phase C**: the queue uses (priority, FIFO) where
Phase A failures get priority 0 and Phase B failures get priority 1.
Since Phase A finishes before Phase B starts, in practice all A failures
enter the queue before any B failure does, but the explicit priority
ensures correctness if a slow A failure arrives after a fast B one.
Rationale: smoke failures indicate more fundamental issues; fixing them
first may make B failures disappear.

**Diff application strategy**: unified at the end. All successful fix
diffs are applied in one pass after Phase C completes, never incrementally
during fix iteration. Rationale: avoids mid-flight conflicts between
overlapping fixes and gives the user a single "after autopilot" diff to
review.

## 8. Authentication strategy (MVP scope)

Decision §4.6 selected the full layered fallback `A → B → C` as the target
state. MVP ships layer A + a **Supabase-specific subset of layer B** +
a graceful skip. Rationale (per opus review): the majority of modern
indie projects use OAuth-only providers (Clerk / Supabase OAuth /
NextAuth Google), which means `.env` sniff alone covers <50 % of the
target audience. Without at least Supabase service_role temp users
in MVP, the launch demo is broken for most projects.

1. **A (`.env` sniff)**: read `.env.local`, `.env.test`, `.env.example`,
   `.env.development.local`, `.env`. Initial v1 credential-key
   catalogue (expanded per opus review):

   | Pair | Source convention |
   |---|---|
   | `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD` | Supabase-recommended seed |
   | `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | generic |
   | `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | Playwright community |
   | `PLAYWRIGHT_AUTH_EMAIL` / `PLAYWRIGHT_AUTH_PASSWORD` | Playwright docs |
   | `CYPRESS_TEST_USER_EMAIL` / `CYPRESS_TEST_USER_PASSWORD` | Cypress community |
   | `NEXT_PUBLIC_TEST_EMAIL` / `NEXT_PUBLIC_TEST_PASSWORD` | Next.js convention |
   | `CI_TEST_EMAIL` / `CI_TEST_PASSWORD` | CI convention |
   | `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` | dev-seed convention |
   | `TEST_USER_JSON` (single blob) | reads `{email, password}` JSON; warn if shape unexpected |

   Detection is case-sensitive on the key; values must be non-empty.

2. **B-subset (Supabase service_role temp user)**: if (a) the project's
   `inspectAuthWiring()` reports `provider: 'supabase'`, AND
   (b) `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) is in
   `.env*`, AND (c) layer A found no creds → autopilot calls Supabase's
   admin API to:
   1. Create a temp user `autopilot-${uuid}@contractqa.local` with a
      random password.
   2. Use those creds for the run.
   3. Delete the user in the `finally` block, even on crash.

   Implementation: ~150 lines in `cli/src/autopilot/auth/supabase-temp-user.ts`.
   Other providers (Clerk testing tokens, NextAuth seed, Auth0 Management
   API) **remain deferred to v1.2+**.

3. **Fallback (skip with warning)**: if neither A nor B applies,
   autopilot still runs but skips invariants that require
   `auth_state: logged_in` in their preconditions, surfacing in the report:

   ```
   ⚠️  Skipped N login-required invariants — no credentials available.
       To enable, set one of: SUPABASE_TEST_EMAIL + SUPABASE_TEST_PASSWORD
       (or any pair from the layer-A catalogue), or set
       SUPABASE_SERVICE_ROLE_KEY for automatic temp-user creation.
   ```

4. **Deferred to v1.2+**: layer B for Clerk / NextAuth / Auth0; layer C
   (interactive prompt + encrypted local cred storage). Each is a
   self-contained additive feature; neither breaks MVP behaviour.

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
| **Regression** — fix breaks a previously passing contract | Orchestrator re-runs **only the contracts whose YAML touches any file in the fix's patch diff** (default `verifyScope: 'touched-files'`); detected regression → revert fix → mark `gaveUp`. **This is a new orchestrator behaviour** (additive `verifyScope: 'one' \| 'touched-files' \| 'all'` parameter, ~60 lines change including the diff-to-contract-mapping helper), opt-in via flag passed from autopilot. **Why not `'all'`**: 10 fixes × 30 contracts × 3 s Playwright cold-start ≈ 15 min of pure regression check, which blows the §9 budget on realistic projects. `'touched-files'` runs only the contracts that mention files in the patch (typically 1-3 contracts per fix), keeping the per-fix cost ~3-9 s. `'all'` remains available for users who explicitly opt in via `--regression-scope=all`. |
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

**Cassette metadata** (each cassette has a sibling `.meta.json`):

```json
{
  "provider": "openai-compatible",
  "providerBaseUrl": "https://api.minimax.chat/v1",
  "model": "<concrete-model-name>",
  "capturedAt": "2026-05-17T00:00:00Z",
  "capturedAgainst": { "spec": "abc123", "promptHash": "..." }
}
```

**Drift guards**:

1. CI emits a warning (non-blocking) when any cassette's `capturedAt` is
   > 90 days old.
2. CI hard-fails when the `promptHash` in metadata doesn't match the
   current prompt source — forces re-record on prompt-engineering changes.
3. The PR template includes a checkbox: "If `UPDATE_CASSETTES=1` was used,
   I reviewed the diff." Cassette refreshes that touch >100 lines flag
   for explicit review.

These guards address the "cassettes silently rot" failure mode raised in
the opus review.

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

~2400 lines of test code across the new modules and cassette fixtures.
Test-to-product ratio ≈ 1.1×.

## 11. Implementation scope summary

### 11.1 New code

Estimates revised upward per opus review (prior estimate undercounted by
~1.3-1.5×):

| Location | Lines | Purpose |
|---|---|---|
| `packages/cli/src/autopilot/smoke-patterns.ts` | ~250 | 6-8 universal patterns + framework-detection glue |
| `packages/cli/src/autopilot/llm-discovery.ts` | ~550 | per-module streaming + prompt assembly + Zod validation + retry/backoff + module enumeration + cost tracking |
| `packages/cli/src/autopilot/interactive-prompt.ts` | ~250 | Y/N + multi-choice + SIGINT handling + per-module batching + `--yes` defaulting |
| `packages/cli/src/autopilot/stash-guard.ts` | ~180 | git stash + sensitive-file enumeration + submodule detection + sensitive confirmation flow |
| `packages/cli/src/autopilot/budget-watchdog.ts` | ~60 | 30-min AbortController timer |
| `packages/cli/src/autopilot/auth/supabase-temp-user.ts` | ~150 | Supabase service_role temp user lifecycle (§8.2) |
| `packages/cli/src/commands/autopilot.ts` | ~200 | top-level orchestrator (Phase A→B/C concurrency) |
| `packages/orchestrator/src/llm/index.ts` | ~70 | `LLMClient` interface + `pickClient` + lazy SDK resolution |
| `packages/orchestrator/src/llm/openai-compatible-client.ts` | ~140 | MiniMax + OpenAI + OpenRouter + DeepSeek quirks |
| `packages/orchestrator/src/llm/anthropic-sdk-client.ts` | ~100 | direct Anthropic API |
| `packages/orchestrator/src/llm/claude-agent-sdk-client.ts` | ~100 | in-process via Claude Agent SDK |
| `packages/orchestrator/src/llm/recording-client.ts` | ~80 | cassette decorator (see §10.2) |
| `packages/orchestrator/package.json` exports + peerDeps | ~10 | `./llm` subpath + peer SDK declarations |
| Orchestrator `verifyScope` support + LLM call site replacements | ~110 modifications | internal refactor (§9.4 + §6.1) |
| **Production code subtotal** | **~2130 new + ~110 modified** | |
| Tests (see §10.7) | **~2400** | |
| **Total** | **~4640** | |

### 11.2 No breaking changes

Public v1.0.0 surface (`contractqa` CLI commands + `@contractqa/adapters/public`
+ `@contractqa/runner/http`) is untouched. Only orchestrator's internal LLM
call mechanism changes, and orchestrator is classified as an internal
package in `STABILITY.md`.

### 11.3 New runtime dependencies

All three LLM SDKs are declared as `peerDependencies` with
`peerDependenciesMeta.optional: true` on `@contractqa/orchestrator`'s
`package.json`. **No SDK is installed by default.** Consumers who use
`@contractqa/orchestrator` standalone (e.g., for the public auto-fix API
outside autopilot) install zero LLM SDKs unless they opt in.

- `@anthropic-ai/claude-agent-sdk` (optional peer; only loaded by
  `ClaudeAgentSDKClient` when selected)
- `openai` (for `OpenAICompatibleClient`; OpenAI-format SDK)
- `@anthropic-ai/sdk` (direct Anthropic; for `AnthropicSDKClient`)

`pickClient()` performs `require.resolve()` on each SDK before constructing
the corresponding client; missing SDKs are treated the same as missing
env vars (skip to next layer). The fatal error in §9.1 includes an
`npm install <sdk-name>` hint for the matched-env-var-but-missing-SDK case.

The `contractqa` CLI package (which depends on `@contractqa/orchestrator`)
adds `@anthropic-ai/claude-agent-sdk` and `openai` as direct
`dependencies` (not peer), so the autopilot command works zero-config for
end users. `@anthropic-ai/sdk` remains a peer in the CLI as well —
power users on Anthropic SDK opt in.

**STABILITY note**: this design preserves the spirit of v1.0's
no-breaking-change promise. `@contractqa/orchestrator`'s install footprint
does not grow for existing consumers; new optional peers are an
additive change documented in §11.5 CHANGELOG.

### 11.4 Deferred to later releases

| Item | Deferred to | Reason |
|---|---|---|
| `--pr` flag for auto-creating GitHub PRs | v1.2+ | needs remote-aware git logic and PR-template plumbing |
| Three-rail budget (time + steps + cost) | v1.2+ | single time rail measured sufficient in dogfood |
| Layer B for Clerk / NextAuth / Auth0 (Supabase B-subset is in MVP — §8.2) | v1.2+ | each provider needs its own admin API integration |
| Layer C (interactive cred prompt + encrypted local storage) | v1.2+ | requires keychain abstraction |
| Cross-dogfood quality benchmark | post-v1 project | needs hand-curated comparison set per target |
| **Telemetry / usage metrics** | **v1.2 (must)** | without it we have no signal on whether autopilot actually onboards vibecoders; explicitly tracked to be added in v1.2 with opt-in flag (`CONTRACTQA_TELEMETRY=1`); MVP launches blind, v1.2 closes the loop |

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
2. Final list of `.env` credential key names to sniff (§8.1) — current list
   is a v1 catalogue; plan may add/refine after dogfood pass.
3. The 6-8 v1 smoke pattern catalogue — exact wording, edge cases.
4. Whether to use `prompts` or a custom readline-based prompter in
   `interactive-prompt.ts`.
5. JSON schema for the `qa/AUTOPILOT_REPORT.md` machine-readable companion
   (`qa/AUTOPILOT_REPORT.json`).

These will be resolved in the writing-plans phase via the same brainstorming
discipline (per-item discussion, locked decisions).

### 12.1 Promoted to spec — `llm-discovery.ts` prompt sketch

Per opus review, the prompt design IS a spec-level decision because the
prompt output shape determines the Zod schema, validation rules, and the
quarantine rate (§9.3). The plan will refine wording, but the **structure**
is locked here:

**System prompt structure**:
1. Role: "You are an expert QA engineer reading source code to infer
   product invariants. Output strictly-typed YAML conforming to the
   contractqa schema."
2. Context block: framework + auth provider + entry routes
   (auto-detected by `inspectAuthWiring` + `detectFramework`).
3. Schema block: literal JSON-schema of `ContractSpec` + 1-2 example
   contracts from `qa/contracts/auth.yml` (the existing canonical
   example).
4. Confidence rubric (literal text in prompt):
   - `high`: invariant is directly evidenced by code (e.g., explicit
     `redirect()` after logout); no ambiguity in expected behaviour.
   - `medium`: invariant is implied by patterns (e.g., admin route
     uses `requireRole('admin')`); expected behaviour is the obvious
     interpretation but one decision point needs confirmation.
   - `low`: invariant requires guessing intent (e.g., "should logged-in
     users see the landing page or be redirected?"); skip unless user
     confirms via prompt.
5. Output format: a JSON array of `ContractProposal` objects (typed in
   §6.3). Each proposal's `yaml` field contains the contract YAML;
   `uncertainQuestions` is required when `confidence != 'high'` and
   must include a `defaultAnswer` for `--yes` mode.

**Per-module instructions** (issued one module at a time):
- "Analyze module `<auth | orders | admin | ...>` rooted at
  `<dirpath>`. Focus on user-visible behaviour, not implementation.
  Output 3-8 proposals."

**Determinism**: temperature is set provider-dependent — 0.2 for
OpenAI-compat and Anthropic SDK; SDK's default for Claude Agent SDK
(which doesn't expose temperature). This gives near-deterministic but
not frozen output, which the cassette layer (§10.2) tolerates via the
`promptHash` drift guard.

The plan is free to tune wording, add few-shot examples, and refine the
confidence rubric — but the four numbered structure elements and the
JSON array output format are locked.

---

**End of design.** Implementation plan to follow at
`docs/superpowers/plans/2026-05-17-autopilot-phase-1.md`.
