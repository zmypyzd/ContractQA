# Night-Shift Auto-PR for `contractqa autopilot watch`

**Date:** 2026-05-18
**Status:** Draft (pending review)
**Author:** ContractQA team
**Tracks design from:** brainstorming session 2026-05-18

---

## 1. Goal

Let a developer leave `contractqa autopilot watch` running overnight and wake up
to a stack of independently-reviewable GitHub PRs — one per fixed contract —
each verified against regression contracts and visible in the Dashboard with
its PR URL and fix outcome.

Today (v0.6.x), `autopilot watch` reruns on file change and auto-fixes failing
contracts **in place**: it accumulates a patch in the working tree and stops.
There is no commit, no branch, no PR. The shadow-fix pipeline in
`packages/orchestrator/src/shadow-pipeline.ts` already implements worktree
isolation, regression checks, and an `openFixPR` callback hook — but no CLI
wires it up.

This spec is the wiring.

## 2. Non-goals

- **Not a continuous bug-discovery loop.** Watch still triggers on file-change
  (plus optional periodic re-run can be added later as a separate spec). If
  no source changes, no new bugs get hunted.
- **Not a token/quota manager.** Hitting Claude Code's weekly limit still
  fails. Quota-aware switching is out of scope.
- **Not a refactor of autopilot's in-place mode.** That stays the default;
  `--auto-pr` is opt-in.
- **Not a new top-level command.** No `contractqa nightshift`. We add one
  flag to existing `autopilot watch`.
- **Not GitHub Actions / CI integration.** This runs from a developer's local
  watch loop. CI integration is a different surface.

## 3. User-facing surface

### 3.1 CLI

```bash
contractqa autopilot watch \
  --auto-pr \
  --yes \
  --time-budget 28800000 \
  --regression-scope touched-files
```

New flag, additive only:

| Flag | Default | Meaning |
|---|---|---|
| `--auto-pr` | `false` | When set, Phase C routes each fix through `shadow-pipeline` → worktree → commit → push → `gh pr create`. Without it, Phase C is the current in-place behavior. |

Other flags (`--yes`, `--time-budget`, `--regression-scope`) already exist and
behave as documented. `--auto-pr` is orthogonal to them.

### 3.2 Preflight (fail fast)

When `--auto-pr` is set, **before the initial run starts**:

1. `gh --version` must succeed → else exit non-zero with:
   `--auto-pr requires the GitHub CLI. Install: https://cli.github.com/`
2. `gh auth status` must succeed → else exit non-zero with:
   `--auto-pr requires gh authentication. Run: gh auth login`
3. Capture the base branch via `git rev-parse --abbrev-ref HEAD`.
   Refuse to run on detached HEAD with a clear message.
4. Verify a remote is configured (`git remote get-url origin`) → else refuse.

Preflight failures abort the watch session immediately, before any LLM calls
or file watching. This prevents the overnight scenario where the watch loop
silently can't open PRs and the user wakes up to nothing.

### 3.2.1 Secrets / redaction policy

PR body sections must NEVER include:
- `raw_stdout` from Claude (may contain env-derived URLs with embedded tokens)
- Full contents of `issue.json` (may contain HTTP auth headers from contract `auth:` blocks)
- Test fixture passwords or temp-user credentials

PR body MAY include (after redaction):
- `root_cause` string (Claude's free-text; redacted by regex strip of common
  token shapes: `sk-[A-Za-z0-9]{20,}`, `Bearer [A-Za-z0-9._-]+`, `password=...`)
- `files_changed` (paths only, never content)
- `tests_run` (test names only)
- Link to Dashboard issue detail page (which displays the full unredacted
  metadata behind auth)

The redaction helper lives in `packages/cli/src/autopilot/pr-body.ts` and is
unit-tested with adversarial input.

### 3.3 Branch / commit / PR convention

- **Base branch:** captured once at watch start, reused for every PR in the
  session. If the user changes branches mid-session, the PRs still target
  the original base (predictability over cleverness).
- **Fix branch name:** `contractqa-fix/<issueId>` — same convention already
  used by `createFixWorktree` in `packages/orchestrator/src/worktree.ts`.
- **Commit:** one commit per fix worktree, made inside the worktree after
  Claude Code edits and after regression passes. Author identity is the
  user's local git config (we don't override).
- **PR title:** `fix(contractqa): <contract-id> — <root-cause-first-sentence>`
  where `<root-cause-first-sentence>` is `root_cause.split(/[.!?\n]/)[0].slice(0, 80)`.
  If `root_cause` is empty or missing, fall back to the literal string
  `auto-fix`. Truncated to 100 chars total.
- **PR body:** structured Markdown built by `packages/cli/src/autopilot/pr-body.ts`,
  redacted per §3.2.1. Sections: Root cause (redacted), Files changed (paths),
  Tests run (names), Regression check (HTTP-only — see §5.1 limitation),
  Skipped browser contracts count, Dashboard link.
  Signed with a trailer `Co-Authored-By: ContractQA Auto-Fix <bot@contractqa.local>`.

### 3.4 Dashboard

The watch loop already POSTs `/api/runs` and PATCHes `/api/runs/:id` per
iteration. With `--auto-pr`, the PATCH carries per-issue fix metadata so the
Dashboard can render PR links beside each issue. See §6 for the full schema
change.

## 3.5 Prerequisites

- `git ≥ 2.32` (for `git commit --trailer`)
- `gh ≥ 2.0` (for `gh pr create --json url`)
- Autopilot's existing prerequisites (Node, pnpm, etc.)

Preflight verifies `git --version` and `gh --version` parse to satisfy these
minimums; otherwise the watch session aborts with a clear hint.

## 3.6 Startup log

When `--auto-pr` is set, the watch loop prints at startup:

```
[watch] auto-pr ON · base branch: <baseBranch> · regression scope: <scope>
[watch] note: new fixes are only discovered when source files change.
        If you don't edit code overnight, no new PRs will appear after the initial run.
```

This makes the "no source changes = no new PRs" semantic obvious upfront rather than hiding it in §2.

## 4. Architecture

```
autopilot watch (autopilot-watch.ts)
  ├─ preflight (--auto-pr)              ← NEW
  ├─ capture baseBranch once            ← NEW
  └─ each iteration:
       runAutopilot(opts.fixStrategy='shadow')
         ├─ Phase A (smoke)
         ├─ Phase B (discovery)
         └─ Phase C (fix queue)         ← MODIFIED
              └─ for each failure:
                   ShadowFixCoordinator.fix(failure)        ← NEW
                     └─ runShadowFix({                      [existing in orchestrator]
                          createWorktree,
                          runClaude:    runClaudeFix wrapper,
                          openFixPR:    gh-pr.ts            ← NEW
                          writePromptFile,
                          contractsDir,
                          failingContractPath,
                          runContract:  runner.runContract  [existing]
                          verifyScope:  opts.regressionScope,
                        })
                     → { outcome, prUrl?, regressionContract? }
       → AutopilotReport now carries per-failure fix outcome + PR URL
  └─ dashboardCompleteRun(report)  ← MODIFIED to include fix metadata
```

### 4.1 New files

| Path | Responsibility |
|---|---|
| `packages/cli/src/autopilot/gh-pr.ts` | `checkGhAvailable()`, `openFixPR()` — wraps `git add/commit/push` + `gh pr create`. Exposes an injectable `exec?` and `ghBin?` for tests (mirrors `worktree.ts` and `claude-code.ts` injection pattern). |
| `packages/cli/src/autopilot/shadow-fix-coordinator.ts` | Bridges autopilot's Phase C queue to `runShadowFix`. Owns: `worktreeRoot`, `baseBranch` (captured at session start), `contractsDir`, `llmClient`, `regressionScope`, `ghBin`, `writePromptFile` (the existing `writeAutopilotFixPrompt` from `autopilot.ts`, NOT the orchestrator's `writeFixPromptFile` — autopilot bundles are thinner than shadow-pipeline's), `runContract` (the path-only HTTP wrapper described in §5.1), and an in-session map `Map<issueId, { bundlePath, issueJsonPath, failingContractPath }>` populated as Phase C dequeues failures. One instance per watch session, constructed in `autopilot-watch.ts` and passed into `runAutopilot` via `AutopilotOptions.shadowCoordinator`. |
| `apps/dashboard/drizzle/migrations/0003_fix_pr.sql` | Adds `fix_pr_url`, `fix_outcome`, `fix_branch` columns to `issues` table |

### 4.2 Modified files

| Path | Change |
|---|---|
| `packages/cli/src/commands/autopilot.ts` | Add `fixStrategy?: 'inPlace' \| 'shadow'` and `shadowCoordinator?` to `AutopilotOptions`. Phase C inspects `fixStrategy`. Report extended with `fixOutcomes: Array<{issueId, outcome, prUrl?, regressionContract?}>`. |
| `packages/cli/src/commands/autopilot-watch.ts` | Add `autoPr`, `regressionScope` to `WatchOptions`. Run preflight. Build `ShadowFixCoordinator` once per session. Pass through to `runAutopilot`. Forward fix metadata to dashboard PATCH body. |
| `packages/cli/src/bin/contractqa.ts` (or wherever flags parse) | Parse `--auto-pr` flag |
| `apps/dashboard/drizzle/schema.ts` | Add new columns to `issues` table |
| `apps/dashboard/app/api/runs/[id]/route.ts` | Accept `fixOutcomes` in PATCH body; extend the local `registerIssuesFromPaths` helper (route.ts:84) to receive a `fixMeta?: Map<string, FixOutcome>` and write three new columns on insert. |
| `apps/dashboard/app/runs/[id]/page.tsx` and issue detail page | Render PR link badge per issue |

### 4.3 No changes (intentional)

- `packages/orchestrator/src/shadow-pipeline.ts` — already supports everything we need.
- `packages/orchestrator/src/worktree.ts` — already supports our branch convention.
- `packages/orchestrator/src/claude-code.ts` — already supports `LLMClient` injection.
- `packages/orchestrator/src/fix-loop.ts` — already supports `maxAttempts: 3`.

### 4.4 IssueId mapping

Autopilot produces failures keyed by `failure.id` (e.g. `smoke:auth-redirect`,
`module:auth/login-flow`). These IDs may contain `:` and `/` — `:` is illegal
in git branch names. The coordinator MUST sanitize:

```
branchSafeId = issueId.replace(/[^a-zA-Z0-9._/-]/g, '-')
```

The sanitized form is used for the git branch (`contractqa-fix/<safe>`) and
the worktree directory name. The original `issueId` is preserved in the map
and the dashboard payload so PR titles / Dashboard joins stay readable.

### 4.5 BundlePath for shadow-pipeline

Autopilot's existing `writeIssueEvidence` (autopilot.ts) writes only
`issue.json` per failure — not the full shadow-pipeline bundle (which
expects `repro.spec.ts`, `diffs/state-diff.json`, `trace.zip`). For
`--auto-pr`, the coordinator passes the per-issue evidence directory as
`bundlePath` AND uses a custom `writePromptFile` (the existing
`writeAutopilotFixPrompt` from autopilot.ts:463) that only references
`issue.json`. The orchestrator's `writeFixPromptFile` is NOT used here.

### 5.1 Regression check scope — v1 limitation

The orchestrator's `runShadowFix` expects a `runContract(path)` callback
returning `{ status: 'pass' | 'fail' }`. The autopilot's existing
`runContractPath` helper (`packages/cli/src/commands/autopilot.ts:162`)
runs HTTP contracts inline but returns `'deferred'` for browser
(Playwright) contracts because autopilot doesn't spin up a browser at
fix-time.

**v1 decision (recorded 2026-05-18):** the coordinator wraps
`runContractPath` so that:

- HTTP contract → `pass | fail` as runContractPath returns
- Playwright/browser contract → treated as **skipped**, NOT a regression
  signal. Counted in the per-PR report as `skipped_browser_contracts: N`.

This means regression checks only catch HTTP-contract regressions in v1.
Browser-contract regressions slip through to PR review. The Dashboard's
Fix card surfaces this as a yellow warning chip:
`⚠ N browser contracts skipped during regression check`.

A future spec can add a path-only `runContract` wrapper that boots
Playwright on demand. Out of scope here.

### 5.2 Idempotency on re-iterations

`watch` reruns on file changes. Same `issueId` may surface across
iterations. Before calling `createWorktree`, the coordinator probes:

1. **Open PR exists for this branch?**
   `gh pr list --head contractqa-fix/<safe> --state open --json url`
   → if found, skip the fix this iteration, log
   `[shadow-fix] skipping <issueId>: PR already open: <url>`,
   record outcome `'SUCCESS'` with the existing prUrl (so dashboard stays consistent).

2. **Local branch exists?** (`git show-ref --verify --quiet refs/heads/<branch>`)
   → delete it with `git branch -D` before `git worktree add -b` runs.
   Safe: the worktree-managed branch was already removed in the prior
   session's `wt.remove()` (`worktree.ts:33`), so this only triggers for
   crash-leftover state.

3. **Remote branch exists?** (`git ls-remote --exit-code origin <branch>`)
   → use `git push --force-with-lease -u origin <branch>` to update it
   safely. `--force-with-lease` (not `--force`) preserves protection if
   someone else pushed to that ref.

Coordinator MUST do these three probes before each `createWorktree` call.

### 5.3 Files-changed filter

Claude's `files_changed` array CAN include `.contractqa-fix-prompt.md`
(the prompt file lives inside the worktree per `shadow-pipeline.ts:111-114`).
The coordinator's `openFixPR` MUST filter:

```ts
const safeFiles = filesChanged.filter(
  (f) => !f.endsWith('.contractqa-fix-prompt.md')
       && !f.startsWith('qa/.autopilot-fix-tmp/')
);
if (safeFiles.length === 0) {
  return { error: 'empty-files-changed-after-filter' };
  // → coordinator marks outcome 'EXHAUSTED'
}
```

## 5. Data flow per fix

```
Phase B discovers failing contract → queued in Phase C
  ↓
ShadowFixCoordinator picks one (FIFO; priority 0 = smoke, 1 = module)
  ↓
runShadowFix({
  issueId, bundlePath, baseBranch, repoRoot, worktreeRoot,
  maxAttempts: 3,
  createWorktree,          // git worktree add -b contractqa-fix/<id> <dest> <baseBranch>
  writePromptFile,         // existing
  runClaude: ({promptPath, cwd, allowedTools}) =>
              runClaudeFix({ promptPath, cwd, allowedTools, llmClient }),
  openFixPR,               // our gh-pr.ts callback
  contractsDir,
  failingContractPath,
  runContract: (path) => runner.runContract({ contractPath: path, ... }),
  verifyScope: 'touched-files',
})
  ↓
shadow-pipeline:
  1. createWorktree → /tmp/contractqa-worktrees/<issueId>
  2. writePromptFile → .contractqa-fix-prompt.md inside worktree
  3. runFixLoop (≤ 3 attempts)
     - Each attempt: runClaudeFix with allowedTools=[Read,Edit,Bash,Grep,Glob]
     - Returns { validation_result, files_changed, patch_diff, ... }
  4. on SUCCESS:
     - Compute regression set via verifyScope
       - 'touched-files': contracts whose YAML mentions any file in patch_diff
       - excludes failingContractPath (already verified by Claude)
     - Run each (concurrency=4) via runContract
     - On any FAIL → return { outcome: 'REGRESSION', regressionContract }
  5. on regression pass:
     - Coordinator runs idempotency probes (§5.2) BEFORE openFixPR is called.
       If an open PR for the branch already exists → short-circuit with that URL.
     - openFixPR({ branch, baseBranch, issueId, filesChanged, originalPrNumber: undefined })
       → our gh-pr.ts (runs with cwd=worktreePath):
           safeFiles = filter(filesChanged)   # §5.3 — strip .contractqa-fix-prompt.md etc
           if safeFiles is empty → return error → caller marks outcome 'EXHAUSTED'
           git add <safeFiles>
           git commit -m "fix(contractqa): <issueId> — <root-cause>" \
                      --trailer "Co-Authored-By: ContractQA Auto-Fix <bot@contractqa.local>"
           git push --force-with-lease -u origin contractqa-fix/<safe>   # §5.2 #3
           gh pr create --base <baseBranch> --head contractqa-fix/<safe> \
                        --title "..." --body "..." \
                        --json url -q .url       # robust URL extraction (Opus review #5)
           → on exit code 1, check stderr for 'already exists' → re-query via
             `gh pr list --head <branch> --state open --json url -q .[0].url`
  6. finally: wt.remove() — git worktree remove + branch -D
  ↓
returns { outcome, prUrl?, attempts, regressionContract? }
  ↓
Coordinator records per-issue fix outcome on the AutopilotReport
  ↓
runAutopilot returns report; watch wrapper PATCHes /api/runs/:id with
  { status, totals, issuesWritten, fixOutcomes }
  ↓
Dashboard registers issues + persists PR URL + outcome
```

## 6. Dashboard schema migration

### 6.1 `apps/dashboard/drizzle/migrations/0003_fix_pr.sql`

```sql
ALTER TABLE issues
  ADD COLUMN fix_pr_url    text,
  ADD COLUMN fix_outcome   text,
  ADD COLUMN fix_branch    text;

-- fix_outcome possible values (enforced in API layer, not DB constraint, to
-- keep migrations forward-compatible):
--   'SUCCESS'                    — PR opened
--   'EXHAUSTED'                  — maxAttempts hit without PASS
--   'REGRESSION'                 — fix passed but broke another contract
--   'CONTRACT_REVISION_NEEDED'   — Claude proposed contract change instead
--   'PARSE_ERROR'                — Claude returned non-JSON
```

### 6.2 `apps/dashboard/drizzle/schema.ts`

```ts
export const issues = pgTable('issues', {
  // ...existing columns
  fixPrUrl: text('fix_pr_url'),
  fixOutcome: text('fix_outcome'),
  fixBranch: text('fix_branch'),
});
```

### 6.3 API extension

`PATCH /api/runs/:id` body gains an optional field:

```ts
{
  status?: Status,
  endedAt?: string,
  totals?: object,
  issuesWritten?: string[],
  fixOutcomes?: Array<{
    issueJsonPath: string,        // matches issuesWritten entry
    outcome: 'SUCCESS' | 'EXHAUSTED' | 'REGRESSION' | 'CONTRACT_REVISION_NEEDED' | 'PARSE_ERROR',
    prUrl?: string,
    branch?: string,
  }>,
}
```

When present, after `registerIssuesFromPaths`, the route looks up each issue
by `issue_json_path` and updates the three new columns.

### 6.4 UI

- **Run overview page** (`/runs/:id`): existing totals row gains a `PRs: N` chip when any `issues.fix_pr_url IS NOT NULL`.
- **Issue detail page**: existing layout gains a "Fix" card showing:
  - Outcome badge (color-coded, follows `DESIGN.md` tokens — only the SUCCESS state uses sodium yellow `#F4D03F`)
  - PR link (opens in new tab)
  - Fix branch name (`contractqa-fix/<issueId>`) as monospace
  - If `REGRESSION`: which contract regressed

Layout follows existing Issue Detail conventions — same Geist Mono / Instrument Serif pairing, 2px radius, no new accent colors.

## 7. Error handling

| Scenario | Behavior |
|---|---|
| `gh` not installed | Preflight aborts watch session before any work |
| `gh auth status` fails | Preflight aborts with `gh auth login` hint |
| Detached HEAD at start | Preflight aborts (no base branch to PR against) |
| No `origin` remote | Preflight aborts |
| User changes branch mid-session | Ignored — session uses captured `baseBranch` |
| `git push` fails (network, perms) | Log error, mark issue's `fixOutcome` as `EXHAUSTED` with stderr in `raw_stdout`. Worktree is still removed via shadow-pipeline's `finally` (we do NOT modify shadow-pipeline). The commit is therefore lost; next iteration will re-attempt from scratch. Watch loop continues. |
| `gh pr create` fails (non-"already exists") | Same as push fails. Commit + push already happened; user can re-push from a fresh worktree next iteration OR open PR manually from the remote branch. |
| `gh pr create` fails with "already exists" | Coordinator's idempotency probe (§5.2 #1) should have caught this BEFORE the call. If we get here anyway (race), re-query via `gh pr list --head <branch> --state open --json url` and record that URL as the SUCCESS prUrl. |
| Branch protection rejects push to fix branch | Treated as "git push fails" — surfaces in `raw_stdout`. User must remove the branch protection or rename their fix-branch prefix. |
| Base branch deleted on remote mid-session | Captured `baseBranch` value is still valid for `git worktree add`, but `gh pr create --base <baseBranch>` will fail. Treated as gh-pr-create failure. Watch loop continues; rare in practice. |
| Worktree dir collision from prior crashed session | Coordinator's preflight (per-fix) runs `git worktree remove --force <dir>` defensively before `createWorktree`. If still fails, fix-outcome is `EXHAUSTED` with the collision error. |
| Regression check fails | `outcome: 'REGRESSION'`, no commit, no PR, worktree cleaned up. Dashboard shows REGRESSION badge + regressed contract name. |
| Claude returns `proposed_contract_revision` | `outcome: 'CONTRACT_REVISION_NEEDED'`, no commit, no PR, raw revision logged to report + dashboard. |
| Phase C exhausts maxAttempts | `outcome: 'EXHAUSTED'`, no commit, no PR. |
| Claude returns non-JSON | `outcome: 'PARSE_ERROR'`, no commit, no PR. |
| Dashboard unreachable | Existing watch behavior — silent skip; fix still happens, PR still opens, just no Dashboard record. |
| User Ctrl-C mid-fix | In-flight `runShadowFix` aborts at next checkpoint. Worktree may be left behind; surfaces in `git worktree list`. Acceptable. |

## 8. Testing strategy

### 8.1 Unit tests (new)

- `packages/cli/src/autopilot/__tests__/gh-pr.test.ts`
  - Mocked `execFile` — verify exact argv passed to `git` and `gh`
  - PR URL parsing from `gh pr create` stdout
  - Error paths: push fail, gh fail
  - Branch sanitization (issueId might contain `/` already — verify no double `contractqa-fix/contractqa-fix/`)

- `packages/cli/src/autopilot/__tests__/shadow-fix-coordinator.test.ts`
  - Mock `runShadowFix` — verify the coordinator wires up the right callbacks
  - One queued failure → one `runShadowFix` call → result recorded on report
  - REGRESSION result → no PR, fix-outcome recorded
  - Preserves base branch across multiple fixes in same session

### 8.2 Unit tests (modified)

- `packages/cli/src/__tests__/autopilot.test.ts`
  - `fixStrategy: 'inPlace'` → existing behavior unchanged (regression guard)
  - `fixStrategy: 'shadow'` → calls coordinator, not `runClaudeFix` directly
  - Report carries `fixOutcomes` array when shadow

- `packages/cli/src/__tests__/autopilot-watch.test.ts`
  - `--auto-pr` without `gh` installed → preflight error
  - `--auto-pr` from detached HEAD → preflight error
  - `--auto-pr` happy path → dashboard PATCH receives `fixOutcomes`

### 8.3 Integration test

- `e2e/night-shift.test.ts` (new) — uses the §24 Logout Bug fixture:
  - Start fixture-app
  - Stub `gh` binary (a shell script that records argv to a file and returns
    a fake PR URL)
  - Stub LLMClient that returns a known patch
  - Run `autopilot watch --auto-pr` against the fixture
  - Assert: worktree created, branch created, fake-`gh` invoked with right
    argv, fake PR URL recorded on AutopilotReport
  - Assert: dashboard receives `fixOutcomes` payload (via in-memory mock or
    test Postgres)

### 8.4 Not tested

- Real `gh pr create` against real GitHub — would create real PRs on every
  test run. The integration test stubs `gh`. Manual smoke test against a
  scratch repo before release.

## 9. Open questions / decisions deferred

1. **Heartbeat log.** Should the watch loop emit a periodic "still alive,
   N PRs opened so far" log line every M minutes? Likely yes, but trivial
   to add later. **Decision:** out of scope for v1.
2. **PR labels.** Should ContractQA tag PRs with a `contractqa` label so
   they're filterable? Requires the user to pre-create the label on the
   repo. **Decision:** skip for v1; emit a hint in the report telling user
   how to add labels manually.
3. **Concurrent worktrees.** Currently Phase C is sequential (one fix at a
   time). With worktrees that's safe to parallelize. **Decision:** stay
   sequential in v1 to avoid LLM rate-limit pile-ups. Revisit if usage shows
   bottleneck.
4. **`originalPrNumber`.** Shadow-pipeline's `commentOnPR` callback runs on
   `EXHAUSTED` when `originalPrNumber` is provided. Autopilot watch has no
   originating PR. **Decision:** don't wire `commentOnPR`; surface
   exhaustion in the watch log + report only.
5. **Trailer / co-author.** Should commits carry a `Co-Authored-By` trailer
   for ContractQA? **Decision:** yes, for traceability. Format: `Co-Authored-By: ContractQA Auto-Fix <bot@contractqa.local>`.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| User wakes up to 30 PRs and is overwhelmed | Per-issue PR is by design; user can `gh pr list --label contractqa` (after manual label setup) or filter by branch prefix `contractqa-fix/`. Dashboard provides a session-grouped view. |
| AI opens PR with subtly wrong fix that passes regression | Regression check uses `verifyScope: 'touched-files'` by default. If user wants stronger coverage they can pass `--regression-scope=all`. The PR is human-reviewable — no auto-merge. |
| Claude Code weekly quota exhausted mid-session | Out of scope; visible in raw_stdout. Future: emit an autopilot-level error event when an LLM call surfaces a 429/quota error and pause the loop. |
| Stale worktrees accumulate after crashes | `runShadowFix` uses `try/finally` for `wt.remove()`. On crash, `git worktree list` shows orphans; document a `contractqa doctor --fix=worktrees` extension in a future spec. |
| `gh pr create` opens a PR even when push half-succeeded | We `await git push` before invoking `gh pr create`. If push fails, gh isn't called. |
| Repo has branch protection requiring CI before push | PRs open against base branch; CI runs on PR. ContractQA doesn't push to base branch directly. Safe. |

## 10.1 Changes from independent Opus review (2026-05-18)

The first draft of this spec was reviewed by an independent reviewer and
returned APPROVE-WITH-CHANGES. Changes applied:

1. **§5.1 added** — regression check restricted to HTTP contracts in v1;
   browser contracts marked `skipped`, not `pass`. Surfaced in Dashboard.
2. **§4.1 coordinator state expanded** — explicit list of all owned state
   including the issueId-to-bundlePath map.
3. **§4.4 added** — `issueId` sanitization for git branch names.
4. **§4.5 added** — bundlePath / writePromptFile clarification (use
   autopilot's writer, not orchestrator's).
5. **§5.2 added** — idempotency probes (open PR exists, local branch
   exists, remote branch exists) before each `createWorktree`.
6. **§5.3 added** — files-changed filter to strip `.contractqa-fix-prompt.md`.
7. **§7 error matrix updated** — removed contradiction with shadow-pipeline's
   unconditional `wt.remove()` in finally; added rows for PR-already-exists
   race, branch protection, base deleted on remote, worktree collision.
8. **§3.2.1 added** — secrets/redaction policy for PR body.
9. **§3.3 PR title** — `<root-cause-first-sentence>` is now defined explicitly.
10. **§3.5 added** — `git ≥ 2.32`, `gh ≥ 2.0` prerequisites.
11. **§3.6 added** — startup log line clarifying "no source changes = no new PRs".
12. **§5 data flow** — `gh pr create` now uses `--json url -q .url` instead
    of stdout parsing.

## 11. Out of scope (explicit non-features)

- Periodic re-run (cron-like) inside watch — separate spec.
- Quota-aware provider switching — separate spec.
- GitHub Actions / GitLab CI integration — separate spec.
- Auto-merge — explicit non-goal; humans review.
- Per-user GitHub OAuth (we trust `gh` auth) — out of scope.
- Slack / Discord notifications on PR open — out of scope; user can hook off
  Dashboard webhooks (a future feature).
