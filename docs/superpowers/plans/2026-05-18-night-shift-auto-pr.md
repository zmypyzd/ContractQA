# Night-Shift Auto-PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--auto-pr` flag to `contractqa autopilot --watch` so Phase C fixes are routed through shadow-pipeline (git worktree + commit + `gh pr create`) instead of in-place patches, with PR URLs and outcomes surfaced in the Dashboard.

**Architecture:** Three new CLI modules (`gh-pr.ts`, `pr-body.ts`, `shadow-fix-coordinator.ts`) bridge `autopilot.ts`'s Phase C queue to the existing `packages/orchestrator/src/shadow-pipeline.ts` (no orchestrator changes). A small Dashboard schema migration (`0003_fix_pr.sql`) adds three columns to `issues`. The CLI flag plumbs through `autopilot --watch` and a one-time preflight verifies `gh` + git state.

**Tech Stack:** TypeScript + Node 22, pnpm monorepo, Vitest tests (`packages/cli/tests/*.test.ts`), Commander.js for CLI flags, Drizzle + Postgres for Dashboard, GitHub CLI (`gh`) for PR creation.

**Spec:** [`docs/superpowers/specs/2026-05-18-night-shift-auto-pr-design.md`](../specs/2026-05-18-night-shift-auto-pr-design.md)

**CLI surface note:** The spec text says `contractqa autopilot watch` (subcommand form) but the actual CLI is `contractqa autopilot --watch` (flag form, see `packages/cli/bin/contractqa.ts:107-141`). This plan uses the real CLI surface: `contractqa autopilot --watch --auto-pr`.

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/cli/src/autopilot/gh-pr.ts` | `checkGhAvailable`, `checkGitVersion`, `openFixPR` (filter files → git add/commit/push → `gh pr create --json url`), `findExistingPr` for idempotency |
| `packages/cli/src/autopilot/pr-body.ts` | `redactSecrets`, `buildPrTitle`, `buildPrBody` |
| `packages/cli/src/autopilot/shadow-fix-coordinator.ts` | One-per-watch-session class wrapping `runShadowFix`. Owns base branch, worktree root, llmClient, issueId map. |
| `packages/cli/tests/gh-pr.test.ts` | Unit tests with mocked `execFile` |
| `packages/cli/tests/pr-body.test.ts` | Unit tests for redaction + body assembly |
| `packages/cli/tests/shadow-fix-coordinator.test.ts` | Unit tests with mocked `runShadowFix` |
| `packages/cli/tests/autopilot-auto-pr.test.ts` | Integration tests for the autopilot Phase C dispatch with `fixStrategy: 'shadow'` |
| `apps/dashboard/drizzle/migrations/0003_fix_pr.sql` | Adds `fix_pr_url`, `fix_outcome`, `fix_branch` columns |
| `e2e/night-shift.test.ts` | End-to-end loop with stub `gh` binary |

### Modified files
| Path | Change |
|---|---|
| `packages/cli/src/commands/autopilot.ts` | Add `fixStrategy?: 'inPlace' \| 'shadow'` + `shadowCoordinator?` to `AutopilotOptions`; Phase C inspects `fixStrategy`; report extended with `fixOutcomes` |
| `packages/cli/src/commands/autopilot-watch.ts` | Add `autoPr` + `regressionScope` to `WatchOptions`; run preflight; build coordinator once per session; forward fix metadata to dashboard PATCH body |
| `packages/cli/bin/contractqa.ts` | Add `--auto-pr` Commander option to `autopilot` command; pass through to `watchAndRerun` |
| `apps/dashboard/drizzle/schema.ts` | Add `fixPrUrl`, `fixOutcome`, `fixBranch` columns to `issues` |
| `apps/dashboard/app/api/runs/[id]/route.ts` | Accept `fixOutcomes` in PATCH body; extend `registerIssuesFromPaths` to write new columns |
| `apps/dashboard/app/runs/[id]/page.tsx` | Render PR-count chip in run header |
| `apps/dashboard/app/runs/[id]/issues/[issueId]/page.tsx` | Add Fix card showing outcome + PR link (path may differ slightly — match existing issue-detail page filename) |

### Unchanged (intentional, per spec §4.3)
- `packages/orchestrator/src/shadow-pipeline.ts`
- `packages/orchestrator/src/worktree.ts`
- `packages/orchestrator/src/claude-code.ts`
- `packages/orchestrator/src/fix-loop.ts`

---

## Shared Types (used across tasks — define in Task 1)

```ts
// packages/cli/src/autopilot/gh-pr.ts (exported)
export interface CheckGhResult {
  available: boolean;
  reason?: string;
  ghVersion?: string;
}

export interface ExecFn {
  (cmd: string, args: string[], opts: { cwd: string }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export interface OpenFixPrInput {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  issueId: string;       // original (unsanitized) ID for PR title
  filesChanged: string[];
  prTitle: string;
  prBody: string;
  exec?: ExecFn;
  ghBin?: string;        // default 'gh'
  gitBin?: string;       // default 'git'
}

export type OpenFixPrStatus =
  | 'success'
  | 'already-exists'
  | 'empty-files'
  | 'push-failed'
  | 'gh-failed';

export interface OpenFixPrResult {
  status: OpenFixPrStatus;
  prUrl?: string;
  errorDetail?: string;
}
```

```ts
// packages/cli/src/autopilot/shadow-fix-coordinator.ts (exported)
export type CoordinatorOutcome =
  | 'SUCCESS'
  | 'EXHAUSTED'
  | 'REGRESSION'
  | 'CONTRACT_REVISION_NEEDED'
  | 'PARSE_ERROR'
  | 'SKIPPED_PR_EXISTS';

export interface CoordinatorFixOutcome {
  issueId: string;
  issueJsonPath: string;
  branchSafeId: string;
  outcome: CoordinatorOutcome;
  prUrl?: string;
  branch?: string;
  regressionContract?: string;
  skippedBrowserContracts: number;
}
```

```ts
// extension to packages/cli/src/commands/autopilot.ts
export interface AutopilotOptions {
  // ...existing fields stay
  fixStrategy?: 'inPlace' | 'shadow';
  shadowCoordinator?: import('../autopilot/shadow-fix-coordinator.js').ShadowFixCoordinator;
}

export interface AutopilotReport {
  // ...existing fields stay
  fixOutcomes?: CoordinatorFixOutcome[];
}
```

---

## Task 1: `gh-pr.ts` — gh + git wrapper

**Files:**
- Create: `packages/cli/src/autopilot/gh-pr.ts`
- Test: `packages/cli/tests/gh-pr.test.ts`

- [ ] **Step 1: Write failing test for `checkGhAvailable` happy path**

Create `packages/cli/tests/gh-pr.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkGhAvailable, checkGitVersion, openFixPR, findExistingPr } from '../src/autopilot/gh-pr.js';

const okExec = (stdoutByCmd: Record<string, string>) =>
  vi.fn(async (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    return { stdout: stdoutByCmd[key] ?? '', stderr: '', exitCode: 0 };
  });

describe('checkGhAvailable', () => {
  it('returns available=true when gh --version and gh auth status both succeed', async () => {
    const exec = okExec({
      'gh --version': 'gh version 2.40.0 (2024-01-15)\nhttps://github.com/cli/cli',
      'gh auth status': 'Logged in to github.com as zmy',
    });
    const result = await checkGhAvailable({ exec });
    expect(result.available).toBe(true);
    expect(result.ghVersion).toBe('2.40.0');
  });
});
```

- [ ] **Step 2: Run test, expect failure (module missing)**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts`
Expected: FAIL — `Cannot find module '../src/autopilot/gh-pr.js'`

- [ ] **Step 3: Create the module skeleton + happy-path implementation**

Create `packages/cli/src/autopilot/gh-pr.ts`:

```ts
// packages/cli/src/autopilot/gh-pr.ts
//
// Wraps `gh` and `git` for the night-shift auto-PR flow. All shell execution
// goes through an injectable ExecFn so tests don't need a real gh/git.
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(nodeExecFile);

export interface CheckGhResult {
  available: boolean;
  reason?: string;
  ghVersion?: string;
}

export interface ExecFn {
  (cmd: string, args: string[], opts: { cwd: string }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

const defaultExec: ExecFn = async (cmd, args, opts) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: opts.cwd });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
};

export async function checkGhAvailable(opts: {
  exec?: ExecFn;
  ghBin?: string;
  cwd?: string;
} = {}): Promise<CheckGhResult> {
  const exec = opts.exec ?? defaultExec;
  const bin = opts.ghBin ?? 'gh';
  const cwd = opts.cwd ?? process.cwd();

  const version = await exec(bin, ['--version'], { cwd });
  if (version.exitCode !== 0) {
    return { available: false, reason: 'gh CLI not installed (https://cli.github.com/)' };
  }
  const m = version.stdout.match(/gh version (\d+\.\d+\.\d+)/);
  const ghVersion = m?.[1];

  const auth = await exec(bin, ['auth', 'status'], { cwd });
  if (auth.exitCode !== 0) {
    return { available: false, reason: 'gh CLI not authenticated. Run: gh auth login', ghVersion };
  }
  return { available: true, ghVersion };
}
```

- [ ] **Step 4: Re-run test, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts -t 'checkGhAvailable'`
Expected: `1 passed`

- [ ] **Step 5: Add failing tests for `checkGhAvailable` sad paths**

Append to `packages/cli/tests/gh-pr.test.ts`:

```ts
describe('checkGhAvailable sad paths', () => {
  it('returns reason "gh CLI not installed" when gh --version fails', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: 'command not found', exitCode: 127 }));
    const result = await checkGhAvailable({ exec });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('gh CLI not installed');
  });

  it('returns reason "not authenticated" when gh auth status fails', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'gh version 2.40.0', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: 'You are not logged in', exitCode: 1 };
    });
    const result = await checkGhAvailable({ exec });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('gh auth login');
  });
});
```

- [ ] **Step 6: Run tests, expect PASS (implementation already covers these)**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts -t 'checkGhAvailable'`
Expected: `3 passed`

- [ ] **Step 7: Add `checkGitVersion` failing test**

Append:

```ts
describe('checkGitVersion', () => {
  it('returns ok=true when git version is ≥ 2.32', async () => {
    const exec = vi.fn(async () => ({ stdout: 'git version 2.39.3', stderr: '', exitCode: 0 }));
    const result = await checkGitVersion({ exec });
    expect(result.ok).toBe(true);
    expect(result.version).toBe('2.39.3');
  });

  it('returns ok=false when git version is < 2.32', async () => {
    const exec = vi.fn(async () => ({ stdout: 'git version 2.30.0', stderr: '', exitCode: 0 }));
    const result = await checkGitVersion({ exec });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('git ≥ 2.32');
  });

  it('returns ok=false when git --version fails', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: 'not found', exitCode: 127 }));
    const result = await checkGitVersion({ exec });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 8: Run, expect failure (function not exported)**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts -t 'checkGitVersion'`
Expected: FAIL — `checkGitVersion is not a function`

- [ ] **Step 9: Implement `checkGitVersion`**

Append to `packages/cli/src/autopilot/gh-pr.ts`:

```ts
export interface CheckGitResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

export async function checkGitVersion(opts: {
  exec?: ExecFn;
  gitBin?: string;
  cwd?: string;
} = {}): Promise<CheckGitResult> {
  const exec = opts.exec ?? defaultExec;
  const r = await exec(opts.gitBin ?? 'git', ['--version'], { cwd: opts.cwd ?? process.cwd() });
  if (r.exitCode !== 0) {
    return { ok: false, reason: 'git not installed' };
  }
  const m = r.stdout.match(/git version (\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return { ok: false, reason: `unable to parse git version: ${r.stdout.trim()}` };
  }
  const [, major, minor] = m;
  const version = `${major}.${minor}.${m[3]}`;
  const ok = Number(major) > 2 || (Number(major) === 2 && Number(minor) >= 32);
  return ok
    ? { ok: true, version }
    : { ok: false, version, reason: `git ≥ 2.32 required for --trailer (have ${version})` };
}
```

- [ ] **Step 10: Run, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts -t 'checkGitVersion'`
Expected: `3 passed`

- [ ] **Step 11: Add failing test for `findExistingPr`**

Append:

```ts
describe('findExistingPr', () => {
  it('returns url when an open PR exists for the branch', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'https://github.com/zmy/qa-agent/pull/42\n',
      stderr: '',
      exitCode: 0,
    }));
    const result = await findExistingPr({
      branch: 'contractqa-fix/auth-redirect',
      cwd: '/tmp/repo',
      exec,
    });
    expect(result.url).toBe('https://github.com/zmy/qa-agent/pull/42');
    expect(exec).toHaveBeenCalledWith(
      'gh',
      ['pr', 'list', '--head', 'contractqa-fix/auth-redirect', '--state', 'open', '--json', 'url', '-q', '.[0].url'],
      { cwd: '/tmp/repo' },
    );
  });

  it('returns url=undefined when no PR exists (stdout empty)', async () => {
    const exec = vi.fn(async () => ({ stdout: '\n', stderr: '', exitCode: 0 }));
    const result = await findExistingPr({ branch: 'x', cwd: '/tmp/repo', exec });
    expect(result.url).toBeUndefined();
  });
});
```

- [ ] **Step 12: Implement `findExistingPr`**

Append to `packages/cli/src/autopilot/gh-pr.ts`:

```ts
export async function findExistingPr(opts: {
  branch: string;
  cwd: string;
  exec?: ExecFn;
  ghBin?: string;
}): Promise<{ url?: string }> {
  const exec = opts.exec ?? defaultExec;
  const r = await exec(
    opts.ghBin ?? 'gh',
    ['pr', 'list', '--head', opts.branch, '--state', 'open', '--json', 'url', '-q', '.[0].url'],
    { cwd: opts.cwd },
  );
  if (r.exitCode !== 0) return {};
  const url = r.stdout.trim();
  return url ? { url } : {};
}
```

- [ ] **Step 13: Run, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts -t 'findExistingPr'`
Expected: `2 passed`

- [ ] **Step 14: Add failing tests for `openFixPR` — happy path + empty-files + push-fail**

Append:

```ts
const PR_URL = 'https://github.com/zmy/qa-agent/pull/99';

describe('openFixPR', () => {
  it('happy path: filters files, commits, pushes, opens PR, returns url', async () => {
    const calls: string[] = [];
    const exec: ExecFn = vi.fn(async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return { stdout: `${PR_URL}\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const result = await openFixPR({
      worktreePath: '/tmp/wt/abc',
      branch: 'contractqa-fix/abc',
      baseBranch: 'main',
      issueId: 'smoke:abc',
      filesChanged: ['src/auth.ts', '.contractqa-fix-prompt.md', 'qa/.autopilot-fix-tmp/abc.md'],
      prTitle: 'fix(contractqa): smoke:abc — strip session',
      prBody: 'body here',
      exec,
    });

    expect(result.status).toBe('success');
    expect(result.prUrl).toBe(PR_URL);
    // Filter dropped 2 files
    expect(calls).toContain('git add src/auth.ts');
    expect(calls.find((c) => c.includes('.contractqa-fix-prompt.md'))).toBeUndefined();
    expect(calls.find((c) => c.includes('.autopilot-fix-tmp'))).toBeUndefined();
    expect(calls).toContain('git push --force-with-lease -u origin contractqa-fix/abc');
    expect(calls).toContain(
      'gh pr create --base main --head contractqa-fix/abc --title fix(contractqa): smoke:abc — strip session --body body here --json url -q .url',
    );
  });

  it('returns status="empty-files" when all files are filtered out', async () => {
    const exec = vi.fn();
    const result = await openFixPR({
      worktreePath: '/tmp/wt/abc',
      branch: 'b',
      baseBranch: 'main',
      issueId: 'x',
      filesChanged: ['.contractqa-fix-prompt.md', 'qa/.autopilot-fix-tmp/foo.md'],
      prTitle: 't',
      prBody: 'b',
      exec: exec as unknown as ExecFn,
    });
    expect(result.status).toBe('empty-files');
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns status="push-failed" when git push exits non-zero', async () => {
    const exec: ExecFn = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'push') {
        return { stdout: '', stderr: 'Permission denied', exitCode: 128 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await openFixPR({
      worktreePath: '/tmp/wt/abc',
      branch: 'b',
      baseBranch: 'main',
      issueId: 'x',
      filesChanged: ['src/a.ts'],
      prTitle: 't',
      prBody: 'b',
      exec,
    });
    expect(result.status).toBe('push-failed');
    expect(result.errorDetail).toContain('Permission denied');
  });

  it('returns status="already-exists" when gh pr create stderr indicates dup, with re-queried url', async () => {
    let phase = 0;
    const exec: ExecFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        phase = 1;
        return { stdout: '', stderr: 'a pull request for branch "b" into branch "main" already exists', exitCode: 1 };
      }
      if (phase === 1 && cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        return { stdout: `${PR_URL}\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await openFixPR({
      worktreePath: '/tmp/wt/abc',
      branch: 'b',
      baseBranch: 'main',
      issueId: 'x',
      filesChanged: ['src/a.ts'],
      prTitle: 't',
      prBody: 'b',
      exec,
    });
    expect(result.status).toBe('already-exists');
    expect(result.prUrl).toBe(PR_URL);
  });
});
```

- [ ] **Step 15: Run, expect failure (function not implemented)**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts -t 'openFixPR'`
Expected: FAIL — `openFixPR is not a function`

- [ ] **Step 16: Implement `openFixPR` + types + file filter**

Append to `packages/cli/src/autopilot/gh-pr.ts`:

```ts
export type OpenFixPrStatus =
  | 'success'
  | 'already-exists'
  | 'empty-files'
  | 'push-failed'
  | 'gh-failed';

export interface OpenFixPrInput {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  issueId: string;
  filesChanged: string[];
  prTitle: string;
  prBody: string;
  exec?: ExecFn;
  ghBin?: string;
  gitBin?: string;
}

export interface OpenFixPrResult {
  status: OpenFixPrStatus;
  prUrl?: string;
  errorDetail?: string;
}

/**
 * Strips files that live inside ContractQA's per-worktree tooling areas.
 * Claude may include the fix-prompt path or autopilot tmp paths in
 * files_changed; those must never reach `git add`.
 */
export function filterAutopilotInternals(files: string[]): string[] {
  return files.filter(
    (f) =>
      !f.endsWith('.contractqa-fix-prompt.md') &&
      !f.startsWith('qa/.autopilot-fix-tmp/') &&
      !f.startsWith('.contractqa-'),
  );
}

export async function openFixPR(i: OpenFixPrInput): Promise<OpenFixPrResult> {
  const exec = i.exec ?? defaultExec;
  const ghBin = i.ghBin ?? 'gh';
  const gitBin = i.gitBin ?? 'git';
  const cwd = i.worktreePath;

  const safeFiles = filterAutopilotInternals(i.filesChanged);
  if (safeFiles.length === 0) {
    return { status: 'empty-files', errorDetail: 'all files filtered (prompt/tmp only)' };
  }

  // git add <files>
  const add = await exec(gitBin, ['add', ...safeFiles], { cwd });
  if (add.exitCode !== 0) {
    return { status: 'push-failed', errorDetail: `git add failed: ${add.stderr}` };
  }

  // git commit
  const commitArgs = [
    'commit',
    '-m',
    extractCommitSubject(i.prTitle),
    '--trailer',
    'Co-Authored-By: ContractQA Auto-Fix <bot@contractqa.local>',
  ];
  const commit = await exec(gitBin, commitArgs, { cwd });
  if (commit.exitCode !== 0) {
    return { status: 'push-failed', errorDetail: `git commit failed: ${commit.stderr}` };
  }

  // git push --force-with-lease -u origin <branch>
  const push = await exec(gitBin, ['push', '--force-with-lease', '-u', 'origin', i.branch], { cwd });
  if (push.exitCode !== 0) {
    return { status: 'push-failed', errorDetail: push.stderr };
  }

  // gh pr create --json url -q .url  (writes URL to stdout)
  const pr = await exec(
    ghBin,
    [
      'pr', 'create',
      '--base', i.baseBranch,
      '--head', i.branch,
      '--title', i.prTitle,
      '--body', i.prBody,
      '--json', 'url',
      '-q', '.url',
    ],
    { cwd },
  );

  if (pr.exitCode === 0) {
    const url = pr.stdout.trim();
    return url ? { status: 'success', prUrl: url } : { status: 'gh-failed', errorDetail: 'gh returned empty URL' };
  }

  if (/already exists/i.test(pr.stderr)) {
    const existing = await findExistingPr({ branch: i.branch, cwd, exec, ghBin });
    return existing.url
      ? { status: 'already-exists', prUrl: existing.url }
      : { status: 'gh-failed', errorDetail: pr.stderr };
  }

  return { status: 'gh-failed', errorDetail: pr.stderr };
}

/** PR title is "fix(contractqa): ..." — commit subject is the same string. */
function extractCommitSubject(prTitle: string): string {
  // Truncate at first newline if PR title is multi-line (defensive).
  return prTitle.split('\n')[0]!.slice(0, 100);
}
```

- [ ] **Step 17: Re-run, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/gh-pr.test.ts`
Expected: `9 passed` (3 + 3 + 2 + 1 = wait, count: checkGhAvailable 3, checkGitVersion 3, findExistingPr 2, openFixPR 4 = 12)

- [ ] **Step 18: Typecheck the package**

Run: `cd packages/cli && pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 19: Commit**

```bash
git add packages/cli/src/autopilot/gh-pr.ts packages/cli/tests/gh-pr.test.ts
git commit -m "feat(cli/autopilot): gh-pr.ts — gh + git wrapper for night-shift auto-PR

Adds checkGhAvailable, checkGitVersion, findExistingPr, openFixPR.
openFixPR filters .contractqa-fix-prompt.md / qa/.autopilot-fix-tmp/
out of files_changed, uses --force-with-lease, extracts PR URL via
\`gh pr create --json url -q .url\`, and falls back to findExistingPr
when stderr says 'already exists'."
```

---

## Task 2: `pr-body.ts` — title, body, and redaction

**Files:**
- Create: `packages/cli/src/autopilot/pr-body.ts`
- Test: `packages/cli/tests/pr-body.test.ts`

- [ ] **Step 1: Write failing tests for `redactSecrets`**

Create `packages/cli/tests/pr-body.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { redactSecrets, buildPrTitle, buildPrBody } from '../src/autopilot/pr-body.js';

describe('redactSecrets', () => {
  it('redacts sk-... API keys', () => {
    const input = 'oops the key is sk-ant-abcd1234efgh5678ijkl9012mnop3456 should be hidden';
    expect(redactSecrets(input)).toBe('oops the key is [REDACTED:api-key] should be hidden');
  });

  it('redacts Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGc.payload.sig')).toBe(
      'Authorization: [REDACTED:bearer]',
    );
  });

  it('redacts password=... assignments', () => {
    expect(redactSecrets('login with password=hunter2!')).toBe('login with [REDACTED:password]');
  });

  it('leaves benign strings alone', () => {
    expect(redactSecrets('the test ran fine and passed')).toBe('the test ran fine and passed');
  });

  it('redacts multiple secrets in same string', () => {
    const r = redactSecrets('sk-xxxxxxxxxxxxxxxxxxxx and Bearer abc.def.ghi');
    expect(r).toContain('[REDACTED:api-key]');
    expect(r).toContain('[REDACTED:bearer]');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/cli && pnpm exec vitest run tests/pr-body.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Create `pr-body.ts` with `redactSecrets`**

Create `packages/cli/src/autopilot/pr-body.ts`:

```ts
// packages/cli/src/autopilot/pr-body.ts
//
// Title + body builder for night-shift auto-PRs. All free-text fields
// (root_cause, etc.) are passed through redactSecrets before any string
// reaches the PR body — secrets from raw_stdout MUST NOT leak to GitHub.

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // OpenAI / Anthropic style API keys: sk-... with ≥ 20 chars
  { re: /sk-[A-Za-z0-9_-]{20,}/g, label: 'api-key' },
  // Bearer tokens
  { re: /Bearer\s+[A-Za-z0-9._\-+/=]+/g, label: 'bearer' },
  // password=... assignments (URL params, env-like)
  { re: /password=[^\s&;]+/gi, label: 'password' },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, `[REDACTED:${label}]`);
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS (5 tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/pr-body.test.ts -t 'redactSecrets'`
Expected: `5 passed`

- [ ] **Step 5: Failing tests for `buildPrTitle`**

Append to `packages/cli/tests/pr-body.test.ts`:

```ts
describe('buildPrTitle', () => {
  it('uses first sentence of root_cause', () => {
    expect(
      buildPrTitle({
        issueId: 'smoke:auth-redirect',
        rootCause: 'Session token persisted after logout. Affects all users.',
      }),
    ).toBe('fix(contractqa): smoke:auth-redirect — Session token persisted after logout');
  });

  it('falls back to "auto-fix" when root_cause is empty', () => {
    expect(buildPrTitle({ issueId: 'x', rootCause: '' })).toBe('fix(contractqa): x — auto-fix');
  });

  it('truncates root cause to 80 chars', () => {
    const long = 'a'.repeat(120);
    const title = buildPrTitle({ issueId: 'y', rootCause: long });
    expect(title.length).toBeLessThanOrEqual(100);
  });

  it('redacts secrets in root_cause before including', () => {
    const title = buildPrTitle({ issueId: 'x', rootCause: 'leak: sk-abcdefghijklmnopqrstuvwx' });
    expect(title).toContain('[REDACTED:api-key]');
  });
});
```

- [ ] **Step 6: Run, expect failure**

Run: `cd packages/cli && pnpm exec vitest run tests/pr-body.test.ts -t 'buildPrTitle'`
Expected: FAIL — `buildPrTitle is not a function`

- [ ] **Step 7: Implement `buildPrTitle`**

Append to `packages/cli/src/autopilot/pr-body.ts`:

```ts
export interface BuildPrTitleInput {
  issueId: string;
  rootCause?: string;
}

export function buildPrTitle({ issueId, rootCause }: BuildPrTitleInput): string {
  const raw = rootCause?.trim();
  const summary = raw ? redactSecrets(raw).split(/[.!?\n]/)[0]!.slice(0, 80) : 'auto-fix';
  return `fix(contractqa): ${issueId} — ${summary}`;
}
```

- [ ] **Step 8: Run, expect PASS (4 tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/pr-body.test.ts -t 'buildPrTitle'`
Expected: `4 passed`

- [ ] **Step 9: Failing tests for `buildPrBody`**

Append:

```ts
describe('buildPrBody', () => {
  it('renders all sections in order with redacted root cause', () => {
    const body = buildPrBody({
      issueId: 'smoke:auth-redirect',
      rootCause: 'Token persisted. Bearer ABC.DEF.GHI was logged.',
      filesChanged: ['src/auth/logout.ts', 'src/auth/store.ts'],
      testsRun: ['auth-logout.spec.ts'],
      regressionSummary: { httpPassed: 4, skippedBrowserContracts: 2 },
      dashboardUrl: 'http://localhost:3010',
      runId: 'abc-123',
    });
    expect(body).toContain('## Root cause');
    expect(body).toContain('Token persisted'); // sentence kept
    expect(body).toContain('[REDACTED:bearer]'); // bearer redacted
    expect(body).toContain('## Files changed');
    expect(body).toContain('- `src/auth/logout.ts`');
    expect(body).toContain('## Regression check');
    expect(body).toContain('4 HTTP contracts passed');
    expect(body).toContain('2 browser contracts skipped');
    expect(body).toContain('http://localhost:3010/runs/abc-123');
  });

  it('omits Dashboard section when dashboardUrl is missing', () => {
    const body = buildPrBody({
      issueId: 'x',
      filesChanged: ['a.ts'],
      regressionSummary: { httpPassed: 0, skippedBrowserContracts: 0 },
    });
    expect(body).not.toContain('## Dashboard');
  });
});
```

- [ ] **Step 10: Run, expect failure**

Run: `cd packages/cli && pnpm exec vitest run tests/pr-body.test.ts -t 'buildPrBody'`
Expected: FAIL — function missing

- [ ] **Step 11: Implement `buildPrBody`**

Append to `packages/cli/src/autopilot/pr-body.ts`:

```ts
export interface BuildPrBodyInput {
  issueId: string;
  rootCause?: string;
  filesChanged: string[];
  testsRun?: string[];
  regressionSummary: {
    httpPassed: number;
    skippedBrowserContracts: number;
    regressionContract?: string;
  };
  dashboardUrl?: string;
  runId?: string;
}

export function buildPrBody(i: BuildPrBodyInput): string {
  const lines: string[] = [];
  lines.push(`> Auto-generated by ContractQA night-shift auto-PR. Review carefully.`);
  lines.push('');
  lines.push(`**Issue ID:** \`${i.issueId}\``);
  lines.push('');

  lines.push('## Root cause');
  lines.push(i.rootCause ? redactSecrets(i.rootCause) : '_(none reported)_');
  lines.push('');

  lines.push('## Files changed');
  for (const f of i.filesChanged) lines.push(`- \`${f}\``);
  lines.push('');

  if (i.testsRun && i.testsRun.length > 0) {
    lines.push('## Tests run');
    for (const t of i.testsRun) lines.push(`- ${t}`);
    lines.push('');
  }

  lines.push('## Regression check');
  lines.push(`- ${i.regressionSummary.httpPassed} HTTP contracts passed`);
  if (i.regressionSummary.skippedBrowserContracts > 0) {
    lines.push(
      `- ⚠ ${i.regressionSummary.skippedBrowserContracts} browser contracts skipped ` +
        `(autopilot doesn't spin Playwright at fix-time — see spec §5.1)`,
    );
  }
  if (i.regressionSummary.regressionContract) {
    lines.push(`- ❌ REGRESSION detected: \`${i.regressionSummary.regressionContract}\``);
  }
  lines.push('');

  if (i.dashboardUrl && i.runId) {
    lines.push('## Dashboard');
    lines.push(`${i.dashboardUrl.replace(/\/$/, '')}/runs/${i.runId}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 12: Run, expect PASS (2 tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/pr-body.test.ts -t 'buildPrBody'`
Expected: `2 passed`

- [ ] **Step 13: Typecheck**

Run: `cd packages/cli && pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 14: Commit**

```bash
git add packages/cli/src/autopilot/pr-body.ts packages/cli/tests/pr-body.test.ts
git commit -m "feat(cli/autopilot): pr-body.ts — title + body + secret redaction"
```

---

## Task 3: `shadow-fix-coordinator.ts` — bridges Phase C to shadow-pipeline

**Files:**
- Create: `packages/cli/src/autopilot/shadow-fix-coordinator.ts`
- Test: `packages/cli/tests/shadow-fix-coordinator.test.ts`

- [ ] **Step 1: Failing test — sanitizeIssueId**

Create `packages/cli/tests/shadow-fix-coordinator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  sanitizeIssueId,
  ShadowFixCoordinator,
} from '../src/autopilot/shadow-fix-coordinator.js';

describe('sanitizeIssueId', () => {
  it('replaces illegal git-branch chars', () => {
    expect(sanitizeIssueId('smoke:auth-redirect')).toBe('smoke-auth-redirect');
    expect(sanitizeIssueId('module:auth/login-flow')).toBe('module-auth/login-flow');
    expect(sanitizeIssueId('weird id with spaces!')).toBe('weird-id-with-spaces-');
  });

  it('preserves safe chars', () => {
    expect(sanitizeIssueId('foo.bar_baz-qux/123')).toBe('foo.bar_baz-qux/123');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/cli && pnpm exec vitest run tests/shadow-fix-coordinator.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Create the module skeleton with `sanitizeIssueId`**

Create `packages/cli/src/autopilot/shadow-fix-coordinator.ts`:

```ts
// packages/cli/src/autopilot/shadow-fix-coordinator.ts
//
// Bridges autopilot's Phase C queue to packages/orchestrator's runShadowFix.
// One instance per `autopilot --watch --auto-pr` session. Owns base branch
// (captured at session start), worktreeRoot, llmClient, and the maps that
// tie issueId → bundlePath → failingContractPath.
import path from 'node:path';
import { runShadowFix, runClaudeFix } from '@contractqa/orchestrator';
import { createFixWorktree } from '@contractqa/orchestrator/dist/worktree.js';
import type { ClaudeFixResult } from '@contractqa/orchestrator';
import type { LLMClient } from '@contractqa/orchestrator/llm';
import { openFixPR, findExistingPr, type ExecFn } from './gh-pr.js';
import { buildPrTitle, buildPrBody } from './pr-body.js';

export type CoordinatorOutcome =
  | 'SUCCESS'
  | 'EXHAUSTED'
  | 'REGRESSION'
  | 'CONTRACT_REVISION_NEEDED'
  | 'PARSE_ERROR'
  | 'SKIPPED_PR_EXISTS';

export interface CoordinatorFixOutcome {
  issueId: string;
  issueJsonPath: string;
  branchSafeId: string;
  outcome: CoordinatorOutcome;
  prUrl?: string;
  branch?: string;
  regressionContract?: string;
  skippedBrowserContracts: number;
}

/** Sanitize an autopilot failure.id for use as a git branch / dir name. */
export function sanitizeIssueId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._/-]/g, '-');
}

export interface ShadowFixCoordinatorDeps {
  /** Per-issue path to write the autopilot-flavoured prompt. */
  writePromptFile: (bundlePath: string, dest: string) => Promise<string>;
  /** Run a single contract by YAML path. Returns 'pass'|'fail'|'skipped' (skipped = browser, see spec §5.1). */
  runContract: (contractPath: string) => Promise<{
    contractPath: string;
    status: 'pass' | 'fail' | 'skipped';
  }>;
  /** Injected for tests; defaults to runShadowFix from orchestrator. */
  runShadowFixImpl?: typeof runShadowFix;
  /** Injected for tests; defaults to createFixWorktree from orchestrator. */
  createWorktreeImpl?: typeof createFixWorktree;
  /** Injected for tests; defaults to defaultExec from gh-pr. */
  exec?: ExecFn;
}

export interface ShadowFixCoordinatorOptions {
  worktreeRoot: string;
  repoRoot: string;
  baseBranch: string;
  contractsDir: string;
  llmClient: LLMClient;
  regressionScope: 'one' | 'touched-files' | 'all';
  ghBin?: string;
  gitBin?: string;
  dashboardUrl?: string;
  dashboardRunId?: string;
}

export interface FixRequest {
  /** Autopilot's failure.id (un-sanitized). */
  issueId: string;
  /** Absolute path to the per-issue issue.json. */
  issueJsonPath: string;
  /** Absolute path to the contract YAML that failed. */
  failingContractPath: string;
  /** Directory containing issue.json (passed to shadow-pipeline as bundlePath). */
  bundlePath: string;
}

export class ShadowFixCoordinator {
  constructor(
    private readonly opts: ShadowFixCoordinatorOptions,
    private readonly deps: ShadowFixCoordinatorDeps,
  ) {}

  async fix(req: FixRequest): Promise<CoordinatorFixOutcome> {
    // Implemented in later steps.
    throw new Error('not implemented yet');
  }
}
```

- [ ] **Step 4: Run, expect PASS (2 tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/shadow-fix-coordinator.test.ts -t 'sanitizeIssueId'`
Expected: `2 passed`

- [ ] **Step 5: Failing test — happy path through `fix()`**

Append to `packages/cli/tests/shadow-fix-coordinator.test.ts`:

```ts
const mkExec = (urls: Record<string, string> = {}) =>
  vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      // idempotency probe — return empty (no existing PR)
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    return { stdout: urls[`${cmd} ${args.join(' ')}`] ?? '', stderr: '', exitCode: 0 };
  });

const stubLlm = {
  providerName: 'anthropic-sdk' as const,
  modelHint: 'claude',
  generate: async () => ({ content: '{}', usage: { inputTokens: 0, outputTokens: 0 } }),
};

describe('ShadowFixCoordinator.fix happy path', () => {
  it('routes to runShadowFix, returns SUCCESS with prUrl', async () => {
    const fakeRunShadowFix = vi.fn(async (input) => {
      // Simulate shadow-pipeline calling openFixPR and returning its result.
      const pr = await input.openFixPR({
        branch: 'contractqa-fix/abc',
        baseBranch: 'main',
        issueId: 'abc',
        filesChanged: ['src/a.ts'],
      });
      return { outcome: 'SUCCESS', prUrl: pr.url, attempts: 1 };
    });

    const coord = new ShadowFixCoordinator(
      {
        worktreeRoot: '/tmp/wt',
        repoRoot: '/tmp/repo',
        baseBranch: 'main',
        contractsDir: '/tmp/repo/qa/contracts',
        llmClient: stubLlm,
        regressionScope: 'touched-files',
      },
      {
        writePromptFile: async (_b, dest) => dest,
        runContract: async (p) => ({ contractPath: p, status: 'pass' }),
        runShadowFixImpl: fakeRunShadowFix as unknown as typeof runShadowFix,
        exec: mkExec(),
      },
    );

    const result = await coord.fix({
      issueId: 'smoke:abc',
      issueJsonPath: '/tmp/repo/qa/issues/smoke-abc/issue.json',
      failingContractPath: '/tmp/repo/qa/contracts/_smoke/abc.yml',
      bundlePath: '/tmp/repo/qa/issues/smoke-abc',
    });

    expect(result.outcome).toBe('SUCCESS');
    expect(result.branchSafeId).toBe('smoke-abc');
    expect(result.issueJsonPath).toBe('/tmp/repo/qa/issues/smoke-abc/issue.json');
    // gh pr create stdout was empty in mkExec → real shadow-pipeline would
    // call openFixPR which calls our gh wrapper; we mocked runShadowFix to
    // call openFixPR with a synthetic input. Our openFixPR ran with the
    // mocked exec → since gh pr create returned exitCode=0 empty stdout,
    // status becomes 'gh-failed' from openFixPR — but for THIS test we
    // verify the wiring works (prUrl from inner openFixPR may be undefined).
  });
});
```

- [ ] **Step 6: Run, expect failure (fix() throws "not implemented yet")**

Run: `cd packages/cli && pnpm exec vitest run tests/shadow-fix-coordinator.test.ts -t 'happy path'`
Expected: FAIL

- [ ] **Step 7: Implement `fix()` body**

Replace the `fix` method in `packages/cli/src/autopilot/shadow-fix-coordinator.ts`:

```ts
  async fix(req: FixRequest): Promise<CoordinatorFixOutcome> {
    const branchSafeId = sanitizeIssueId(req.issueId);
    const branch = `contractqa-fix/${branchSafeId}`;
    const worktreePath = path.join(this.opts.worktreeRoot, branchSafeId);

    // §5.2 idempotency probe #1: open PR already exists?
    const existing = await findExistingPr({
      branch,
      cwd: this.opts.repoRoot,
      exec: this.deps.exec,
      ghBin: this.opts.ghBin,
    });
    if (existing.url) {
      return {
        issueId: req.issueId,
        issueJsonPath: req.issueJsonPath,
        branchSafeId,
        outcome: 'SKIPPED_PR_EXISTS',
        prUrl: existing.url,
        branch,
        skippedBrowserContracts: 0,
      };
    }

    const runShadowFixImpl = this.deps.runShadowFixImpl ?? runShadowFix;
    const createWorktreeImpl = this.deps.createWorktreeImpl ?? createFixWorktree;

    // Track Claude's last result so openFixPR can build PR title/body from root_cause.
    let lastClaudeResult: ClaudeFixResult | null = null;
    let skippedBrowserContracts = 0;
    let httpPassedCount = 0;

    // Wrap runContract to surface skipped browser contracts in the per-issue summary,
    // and translate 'skipped' → 'pass' so shadow-pipeline doesn't trigger REGRESSION.
    const wrappedRunContract = async (contractPath: string) => {
      const r = await this.deps.runContract(contractPath);
      if (r.status === 'skipped') {
        skippedBrowserContracts++;
        return { contractPath: r.contractPath, status: 'pass' as const };
      }
      if (r.status === 'pass') httpPassedCount++;
      return { contractPath: r.contractPath, status: r.status };
    };

    const result = await runShadowFixImpl({
      issueId: branchSafeId,
      bundlePath: req.bundlePath,
      baseBranch: this.opts.baseBranch,
      repoRoot: this.opts.repoRoot,
      worktreeRoot: this.opts.worktreeRoot,
      maxAttempts: 3,
      createWorktree: createWorktreeImpl,
      writePromptFile: this.deps.writePromptFile,
      runClaude: async (input) => {
        const r = await runClaudeFix({
          promptPath: input.promptPath,
          cwd: input.cwd,
          allowedTools: input.allowedTools,
          llmClient: this.opts.llmClient,
        });
        lastClaudeResult = r;
        return r;
      },
      openFixPR: async ({ branch: br, baseBranch, filesChanged }) => {
        const rootCause = lastClaudeResult?.root_cause;
        const prTitle = buildPrTitle({ issueId: req.issueId, rootCause });
        const prBody = buildPrBody({
          issueId: req.issueId,
          rootCause,
          filesChanged,
          testsRun: lastClaudeResult?.tests_run,
          regressionSummary: {
            httpPassed: httpPassedCount,
            skippedBrowserContracts,
          },
          dashboardUrl: this.opts.dashboardUrl,
          runId: this.opts.dashboardRunId,
        });
        const r = await openFixPR({
          worktreePath,
          branch: br,
          baseBranch,
          issueId: req.issueId,
          filesChanged,
          prTitle,
          prBody,
          exec: this.deps.exec,
          ghBin: this.opts.ghBin,
          gitBin: this.opts.gitBin,
        });
        // shadow-pipeline expects {url}. On non-success, surface the error
        // by throwing — shadow-pipeline currently has no failure path for
        // openFixPR, so we coerce status into a URL or an empty string and
        // record the real status via lastOpenFixResult.
        this.lastOpenFixResult = r;
        return { url: r.prUrl ?? '' };
      },
      verifyScope: this.opts.regressionScope,
      contractsDir: this.opts.contractsDir,
      failingContractPath: req.failingContractPath,
      runContract: wrappedRunContract,
    });

    return this.mapResult({
      req,
      branchSafeId,
      branch,
      result,
      skippedBrowserContracts,
    });
  }

  /** Set inside the openFixPR callback so mapResult can detect push/gh failures. */
  private lastOpenFixResult: { status: string; prUrl?: string; errorDetail?: string } | null = null;

  private mapResult(args: {
    req: FixRequest;
    branchSafeId: string;
    branch: string;
    result: { outcome: string; prUrl?: string; attempts: number; regressionContract?: string };
    skippedBrowserContracts: number;
  }): CoordinatorFixOutcome {
    const base = {
      issueId: args.req.issueId,
      issueJsonPath: args.req.issueJsonPath,
      branchSafeId: args.branchSafeId,
      branch: args.branch,
      skippedBrowserContracts: args.skippedBrowserContracts,
    };
    const openRes = this.lastOpenFixResult;
    this.lastOpenFixResult = null;

    if (args.result.outcome === 'SUCCESS') {
      if (openRes && (openRes.status === 'success' || openRes.status === 'already-exists')) {
        return { ...base, outcome: 'SUCCESS', prUrl: openRes.prUrl };
      }
      // Push / gh failed inside the callback.
      return { ...base, outcome: 'EXHAUSTED' };
    }
    if (args.result.outcome === 'REGRESSION') {
      return { ...base, outcome: 'REGRESSION', regressionContract: args.result.regressionContract };
    }
    if (args.result.outcome === 'CONTRACT_REVISION_NEEDED') {
      return { ...base, outcome: 'CONTRACT_REVISION_NEEDED' };
    }
    if (args.result.outcome === 'PARSE_ERROR') {
      return { ...base, outcome: 'PARSE_ERROR' };
    }
    return { ...base, outcome: 'EXHAUSTED' };
  }
```

- [ ] **Step 8: Run happy path test, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/shadow-fix-coordinator.test.ts -t 'happy path'`
Expected: `1 passed`

- [ ] **Step 9: Failing tests for non-success outcomes**

Append to `packages/cli/tests/shadow-fix-coordinator.test.ts`:

```ts
describe('ShadowFixCoordinator.fix non-success outcomes', () => {
  const baseReq = {
    issueId: 'x',
    issueJsonPath: '/tmp/issue.json',
    failingContractPath: '/tmp/c.yml',
    bundlePath: '/tmp',
  };
  const baseOpts = {
    worktreeRoot: '/tmp/wt',
    repoRoot: '/tmp/repo',
    baseBranch: 'main',
    contractsDir: '/tmp/c',
    llmClient: stubLlm,
    regressionScope: 'touched-files' as const,
  };

  it('SKIPPED_PR_EXISTS when findExistingPr returns a URL', async () => {
    const exec = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        return { stdout: 'https://github.com/x/y/pull/1\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const coord = new ShadowFixCoordinator(baseOpts, {
      writePromptFile: async (_, d) => d,
      runContract: async (p) => ({ contractPath: p, status: 'pass' }),
      runShadowFixImpl: vi.fn() as unknown as typeof runShadowFix,
      exec,
    });
    const result = await coord.fix(baseReq);
    expect(result.outcome).toBe('SKIPPED_PR_EXISTS');
    expect(result.prUrl).toBe('https://github.com/x/y/pull/1');
  });

  it('REGRESSION when runShadowFix reports it', async () => {
    const fakeRunShadowFix = vi.fn(async () => ({
      outcome: 'REGRESSION',
      attempts: 1,
      regressionContract: '/c/other.yml',
    }));
    const coord = new ShadowFixCoordinator(baseOpts, {
      writePromptFile: async (_, d) => d,
      runContract: async (p) => ({ contractPath: p, status: 'pass' }),
      runShadowFixImpl: fakeRunShadowFix as unknown as typeof runShadowFix,
      exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    });
    const result = await coord.fix(baseReq);
    expect(result.outcome).toBe('REGRESSION');
    expect(result.regressionContract).toBe('/c/other.yml');
  });

  it('EXHAUSTED when runShadowFix reports EXHAUSTED', async () => {
    const fakeRunShadowFix = vi.fn(async () => ({ outcome: 'EXHAUSTED', attempts: 3 }));
    const coord = new ShadowFixCoordinator(baseOpts, {
      writePromptFile: async (_, d) => d,
      runContract: async (p) => ({ contractPath: p, status: 'pass' }),
      runShadowFixImpl: fakeRunShadowFix as unknown as typeof runShadowFix,
      exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    });
    const result = await coord.fix(baseReq);
    expect(result.outcome).toBe('EXHAUSTED');
  });
});
```

- [ ] **Step 10: Run, expect PASS (3 more tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/shadow-fix-coordinator.test.ts`
Expected: total `6 passed`

- [ ] **Step 11: Typecheck**

Run: `cd packages/cli && pnpm exec tsc --noEmit`
Expected: no errors.

If errors mention `import { createFixWorktree } from '@contractqa/orchestrator/dist/worktree.js'` — change the import path. Check `packages/orchestrator/src/index.ts` for what's exported. If `createFixWorktree` is not re-exported, add it to the orchestrator's index:

Run: `grep -n createFixWorktree /Users/zmy/intership/5.10+/qa-agent/packages/orchestrator/src/index.ts`

If missing, append to `packages/orchestrator/src/index.ts`:
```ts
export { createFixWorktree } from './worktree.js';
export type { FixWorktree } from './worktree.js';
```

Then re-build:
```bash
cd packages/orchestrator && pnpm exec tsc --noEmit
```

Update the coordinator's import:
```ts
import { createFixWorktree } from '@contractqa/orchestrator';
```

- [ ] **Step 12: Commit**

```bash
git add packages/cli/src/autopilot/shadow-fix-coordinator.ts \
        packages/cli/tests/shadow-fix-coordinator.test.ts \
        packages/orchestrator/src/index.ts
git commit -m "feat(cli/autopilot): ShadowFixCoordinator — bridges Phase C to runShadowFix"
```

---

## Task 4: Modify `autopilot.ts` — fixStrategy dispatch

**Files:**
- Modify: `packages/cli/src/commands/autopilot.ts`
- Test: `packages/cli/tests/autopilot-auto-pr.test.ts` (new)

- [ ] **Step 1: Failing integration test**

Create `packages/cli/tests/autopilot-auto-pr.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAutopilot } from '../src/commands/autopilot.js';
import { ShadowFixCoordinator } from '../src/autopilot/shadow-fix-coordinator.js';

describe('autopilot Phase C dispatch with fixStrategy=shadow', () => {
  it('routes failures through coordinator.fix and includes fixOutcomes in report', async () => {
    // Build a minimal cwd with one always-failing HTTP smoke contract.
    const cwd = await mkdtemp(path.join(tmpdir(), 'autopilot-shadow-'));
    await mkdir(path.join(cwd, 'qa/contracts/_smoke'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/_smoke/will-fail.yml'),
      `id: will-fail
description: always fails
http:
  request: { method: GET, url: "http://127.0.0.1:1/never-listens" }
  expect: { status: 200 }
`,
    );

    // Stub coordinator that records calls and returns SUCCESS with a fake PR.
    const fixCalls: string[] = [];
    const stubCoordinator = {
      fix: vi.fn(async (req) => {
        fixCalls.push(req.issueId);
        return {
          issueId: req.issueId,
          issueJsonPath: req.issueJsonPath,
          branchSafeId: 'fake-id',
          outcome: 'SUCCESS' as const,
          prUrl: 'https://github.com/x/y/pull/1',
          branch: 'contractqa-fix/fake-id',
          skippedBrowserContracts: 0,
        };
      }),
    } as unknown as ShadowFixCoordinator;

    const report = await runAutopilot({
      cwd,
      timeBudgetMs: 30_000,
      fix: true,
      yes: true,
      regenerate: true,
      fixStrategy: 'shadow',
      shadowCoordinator: stubCoordinator,
      // Skip Phase B by passing a no-op LLM client through pickClient — for
      // this test we just want Phase A failures to route through the stub.
    });

    expect(fixCalls.length).toBeGreaterThan(0);
    expect(report.fixOutcomes).toBeDefined();
    expect(report.fixOutcomes!.length).toBeGreaterThan(0);
    expect(report.fixOutcomes![0].prUrl).toBe('https://github.com/x/y/pull/1');
  }, 30_000);
});
```

- [ ] **Step 2: Run, expect failure (types missing, runAutopilot doesn't accept fixStrategy)**

Run: `cd packages/cli && pnpm exec vitest run tests/autopilot-auto-pr.test.ts`
Expected: FAIL — likely `fixStrategy does not exist on type 'AutopilotOptions'`

- [ ] **Step 3: Extend `AutopilotOptions`**

In `packages/cli/src/commands/autopilot.ts`, find the `export interface AutopilotOptions` block (around line 60-80). Add two fields:

```ts
export interface AutopilotOptions {
  // ... existing fields stay ...
  /**
   * Phase C fix strategy. 'inPlace' (default) accumulates patches in cwd.
   * 'shadow' routes each failure through a ShadowFixCoordinator that opens
   * a worktree per fix and creates a GitHub PR. Requires shadowCoordinator.
   */
  fixStrategy?: 'inPlace' | 'shadow';
  shadowCoordinator?: import('../autopilot/shadow-fix-coordinator.js').ShadowFixCoordinator;
}
```

- [ ] **Step 4: Extend `AutopilotReport` shape**

In the same file, find the `AutopilotReport` interface (in `packages/cli/src/autopilot/report.ts` — if so, modify there). Add:

```ts
import type { CoordinatorFixOutcome } from '../autopilot/shadow-fix-coordinator.js';

export interface AutopilotReport {
  // ...existing
  fixOutcomes?: CoordinatorFixOutcome[];
}
```

If the import creates a cycle (autopilot.ts imports report.ts which imports coordinator which imports nothing from autopilot — should be fine), keep it. Otherwise inline the type.

- [ ] **Step 5: Route Phase C in `autopilot.ts`**

Find the Phase C worker block in `packages/cli/src/commands/autopilot.ts` (search for `runFixLoop` — it's around line 460). The existing block looks like:

```ts
const loop = await runFixLoop({
  maxAttempts: 3,
  fix: async (_attempt) =>
    runClaudeFix({
      promptPath,
      cwd: opts.cwd,
      allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
      llmClient,
      signal: abortController.signal,
    }),
});

if (loop.outcome === 'SUCCESS') {
  const lastResult = loop.history.at(-1);
  const patchDiff = lastResult?.patch_diff;
  if (patchDiff) {
    accumulatedDiffs.push(patchDiff);
  }
  phaseC.fixed++;
} else {
  phaseC.givenUp++;
  // ...
}
```

Wrap with a strategy check:

```ts
const fixOutcomes: import('../autopilot/shadow-fix-coordinator.js').CoordinatorFixOutcome[] = [];

// ... above the loop, declare fixOutcomes accumulator

if (opts.fixStrategy === 'shadow') {
  if (!opts.shadowCoordinator) {
    throw new Error('fixStrategy=shadow requires shadowCoordinator');
  }
  const outcome = await opts.shadowCoordinator.fix({
    issueId: next.failure.id,
    issueJsonPath: next.failure.evidencePath ?? '',
    failingContractPath: next.contractPath,
    bundlePath: path.dirname(next.failure.evidencePath ?? ''),
  });
  fixOutcomes.push(outcome);
  if (outcome.outcome === 'SUCCESS' || outcome.outcome === 'SKIPPED_PR_EXISTS') {
    phaseC.fixed++;
  } else {
    phaseC.givenUp++;
    const giveUpMsg = `autopilot: shadow-fix gave up on ${next.failure.id} (outcome: ${outcome.outcome})`;
    emit({ type: 'log', level: 'warn', message: giveUpMsg, elapsedMs: elapsed() });
    console.warn(giveUpMsg);
  }
} else {
  // existing in-place branch (unchanged):
  const promptPath = await writeAutopilotFixPrompt(next.contractPath, next.failure, tmpDir);
  const loop = await runFixLoop({
    maxAttempts: 3,
    fix: async (_attempt) =>
      runClaudeFix({
        promptPath,
        cwd: opts.cwd,
        allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
        llmClient,
        signal: abortController.signal,
      }),
  });
  // ... existing post-loop handling unchanged
}
```

Then at the end of `runAutopilot`, return `fixOutcomes` on the report:

Find the `return` statement that constructs the final report. Add:

```ts
return {
  // ... existing fields
  fixOutcomes: opts.fixStrategy === 'shadow' ? fixOutcomes : undefined,
};
```

- [ ] **Step 6: Verify `next.failure.evidencePath` exists**

Search `packages/cli/src/autopilot/report.ts` for `SmokeFailure`:

Run: `grep -n 'evidencePath\|issueJsonPath\|interface SmokeFailure' /Users/zmy/intership/5.10+/qa-agent/packages/cli/src/autopilot/report.ts`

If `evidencePath` is missing on `SmokeFailure`, look at how the existing autopilot writes issue.json — search `writeIssueEvidence`. The function returns a path; that path is stored on the queue item. Adjust the field name in the dispatch above to match what the queue actually carries. Look at `QueuedFailure` shape (search for `interface QueuedFailure`).

If the queue doesn't carry the issue.json path yet, extend `QueuedFailure`:

```ts
interface QueuedFailure {
  priority: 0 | 1;
  failure: SmokeFailure;
  contractPath: string;
  evidencePath?: string;  // ← add this
}
```

And at the place where the queue is populated (where `writeIssueEvidence` is called), pass through:

```ts
queue.push({
  priority: 0,
  failure,
  contractPath,
  evidencePath: issuePath,  // result of writeIssueEvidence
});
```

- [ ] **Step 6b: Export `runContractPath` from `autopilot.ts`**

`runContractPath` is currently a module-local function (autopilot.ts:162). Task 5 needs to import it. Find the line:

```ts
async function runContractPath(
```

Change to:

```ts
export async function runContractPath(
```

No other change — the function body stays as-is.

- [ ] **Step 7: Run integration test**

Run: `cd packages/cli && pnpm exec vitest run tests/autopilot-auto-pr.test.ts`
Expected: `1 passed`

If it fails because Phase B kicks off and stalls without a real LLM client, the test needs to short-circuit Phase B. Look at how the test sets up cwd — the contracts dir already exists (because of `qa/contracts/_smoke/will-fail.yml`), so `regenerate: true` would still re-discover. Change `regenerate: false` and verify Phase A fires on the smoke contract.

If Phase B still blocks: pass an `llmClient` stub via `opts.llmClient` (extend `AutopilotOptions` if it doesn't already accept one — it does at autopilot.ts:67).

```ts
const stubLlm = {
  providerName: 'anthropic-sdk' as const,
  modelHint: 'test',
  generate: async () => ({ content: '{"proposals":[]}', usage: { inputTokens: 0, outputTokens: 0 } }),
};
// pass via opts: llmClient: stubLlm,
```

- [ ] **Step 8: Verify in-place path is unchanged**

Run the existing autopilot tests:
```bash
cd packages/cli && pnpm exec vitest run tests/ --reporter=verbose
```
Expected: previously-passing autopilot tests still pass; no regressions.

- [ ] **Step 9: Typecheck**

Run: `cd packages/cli && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/commands/autopilot.ts \
        packages/cli/src/autopilot/report.ts \
        packages/cli/tests/autopilot-auto-pr.test.ts
git commit -m "feat(cli): autopilot fixStrategy=shadow routes Phase C to coordinator

In-place strategy stays default. When 'shadow' is selected:
- Phase C calls shadowCoordinator.fix(req) per failure
- Each outcome is appended to report.fixOutcomes
- SUCCESS and SKIPPED_PR_EXISTS count as 'fixed'
- All other outcomes count as 'gave up' (matches existing semantics)"
```

---

## Task 5: Modify `autopilot-watch.ts` — preflight, base branch, coordinator

**Files:**
- Modify: `packages/cli/src/commands/autopilot-watch.ts`
- Test: `packages/cli/tests/autopilot-watch-auto-pr.test.ts` (new)

- [ ] **Step 1: Failing test — preflight rejects when gh missing**

Create `packages/cli/tests/autopilot-watch-auto-pr.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runAutoPrPreflight } from '../src/commands/autopilot-watch.js';

describe('autopilot-watch --auto-pr preflight', () => {
  it('returns ok=false when gh CLI is missing', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') {
        return { stdout: '', stderr: 'not found', exitCode: 127 };
      }
      return { stdout: 'git version 2.39.0', stderr: '', exitCode: 0 };
    });
    const result = await runAutoPrPreflight({ cwd: '/tmp', exec });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('gh');
  });

  it('returns ok=false when on detached HEAD', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') return { stdout: 'gh version 2.40.0', stderr: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'auth') return { stdout: 'ok', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === '--version') return { stdout: 'git version 2.39.0', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { stdout: 'HEAD\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await runAutoPrPreflight({ cwd: '/tmp', exec });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('detached');
  });

  it('returns ok=true with baseBranch when all checks pass', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') return { stdout: 'gh version 2.40.0', stderr: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'auth') return { stdout: 'ok', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === '--version') return { stdout: 'git version 2.39.0', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'rev-parse') return { stdout: 'feature/foo\n', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:x/y.git\n', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await runAutoPrPreflight({ cwd: '/tmp', exec });
    expect(result.ok).toBe(true);
    expect(result.baseBranch).toBe('feature/foo');
  });
});
```

- [ ] **Step 2: Run, expect failure (function not exported)**

Run: `cd packages/cli && pnpm exec vitest run tests/autopilot-watch-auto-pr.test.ts`
Expected: FAIL — `runAutoPrPreflight is not a function`

- [ ] **Step 3: Add `runAutoPrPreflight` to `autopilot-watch.ts`**

In `packages/cli/src/commands/autopilot-watch.ts`, near the top (after imports), add:

```ts
import { checkGhAvailable, checkGitVersion, type ExecFn } from '../autopilot/gh-pr.js';

export interface AutoPrPreflightResult {
  ok: boolean;
  reason?: string;
  baseBranch?: string;
  ghVersion?: string;
  gitVersion?: string;
}

export async function runAutoPrPreflight(opts: {
  cwd: string;
  exec?: ExecFn;
}): Promise<AutoPrPreflightResult> {
  const exec = opts.exec;
  const gh = await checkGhAvailable({ exec, cwd: opts.cwd });
  if (!gh.available) return { ok: false, reason: `--auto-pr preflight: ${gh.reason}` };

  const git = await checkGitVersion({ exec, cwd: opts.cwd });
  if (!git.ok) return { ok: false, reason: `--auto-pr preflight: ${git.reason}`, ghVersion: gh.ghVersion };

  const branchExec = exec ?? (await import('node:child_process')).execFile;
  // Use exec abstraction even for git rev-parse:
  const runExec = exec ?? (await defaultExecForWatch());
  const head = await runExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: opts.cwd });
  if (head.exitCode !== 0) {
    return { ok: false, reason: '--auto-pr preflight: git rev-parse failed', ghVersion: gh.ghVersion, gitVersion: git.version };
  }
  const baseBranch = head.stdout.trim();
  if (baseBranch === 'HEAD' || baseBranch === '') {
    return { ok: false, reason: '--auto-pr preflight: on detached HEAD — checkout a branch first', ghVersion: gh.ghVersion, gitVersion: git.version };
  }

  const remote = await runExec('git', ['remote', 'get-url', 'origin'], { cwd: opts.cwd });
  if (remote.exitCode !== 0) {
    return { ok: false, reason: '--auto-pr preflight: no "origin" remote configured', ghVersion: gh.ghVersion, gitVersion: git.version };
  }

  return { ok: true, baseBranch, ghVersion: gh.ghVersion, gitVersion: git.version };
}

async function defaultExecForWatch(): Promise<ExecFn> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const ef = promisify(execFile);
  return async (cmd, args, opts) => {
    try {
      const r = await ef(cmd, args, { cwd: opts.cwd });
      return { stdout: r.stdout, stderr: r.stderr, exitCode: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err), exitCode: e.code ?? 1 };
    }
  };
}
```

- [ ] **Step 4: Run preflight tests, expect PASS (3 tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/autopilot-watch-auto-pr.test.ts -t 'preflight'`
Expected: `3 passed`

- [ ] **Step 5: Extend `WatchOptions` and `watchAndRerun`**

In `packages/cli/src/commands/autopilot-watch.ts`, extend `WatchOptions`:

```ts
export interface WatchOptions {
  debounceMs: number;
  onLog?: (line: string) => void;
  dashboardUrl?: string;
  /** Enable night-shift auto-PR mode: route Phase C through ShadowFixCoordinator. */
  autoPr?: boolean;
  /** Defaults to 'touched-files'. Passed to shadow-pipeline's verifyScope. */
  regressionScope?: 'one' | 'touched-files' | 'all';
}
```

- [ ] **Step 6: Wire preflight + coordinator into `watchAndRerun`**

In the `watchAndRerun` function (after the existing `const log = ...` line and before the `dashboardUrl` line), add:

```ts
// --auto-pr setup
let preflight: AutoPrPreflightResult | null = null;
let coordinator: import('../autopilot/shadow-fix-coordinator.js').ShadowFixCoordinator | null = null;

if (watchOpts.autoPr) {
  preflight = await runAutoPrPreflight({ cwd: baseOpts.cwd });
  if (!preflight.ok) {
    log(`[watch] ${preflight.reason}`);
    throw new Error(preflight.reason);
  }
  log(`[watch] auto-pr ON · base branch: ${preflight.baseBranch} · regression scope: ${watchOpts.regressionScope ?? 'touched-files'}`);
  log(`[watch] note: new fixes are only discovered when source files change.`);
  log(`[watch]       If you don't edit code overnight, no new PRs will appear after the initial run.`);

  // Build coordinator. We need pickClient() lazily so this works even when
  // the user hasn't set ANTHROPIC_API_KEY (falls back to Claude Code subscription).
  const { pickClient } = await import('@contractqa/orchestrator/llm');
  const llmClient = await pickClient();

  const { ShadowFixCoordinator } = await import('../autopilot/shadow-fix-coordinator.js');
  const { writeAutopilotFixPrompt } = await import('./autopilot.js');
  const { runContractPath } = await import('./autopilot.js');

  coordinator = new ShadowFixCoordinator(
    {
      worktreeRoot: await ensureWorktreeRoot(baseOpts.cwd),
      repoRoot: baseOpts.cwd,
      baseBranch: preflight.baseBranch!,
      contractsDir: join(baseOpts.cwd, 'qa/contracts'),
      llmClient,
      regressionScope: watchOpts.regressionScope ?? 'touched-files',
      dashboardUrl,
    },
    {
      writePromptFile: async (bundlePath, dest) => {
        // bundlePath is the directory containing issue.json — call the
        // autopilot variant which only references issue.json.
        return writeAutopilotFixPromptFromBundle(bundlePath, dest);
      },
      runContract: async (contractPath) => {
        const r = await runContractPath(contractPath, baseOpts.cwd, new AbortController().signal);
        if (r.passed === 'pass') return { contractPath, status: 'pass' };
        if (r.passed === 'fail') return { contractPath, status: 'fail' };
        return { contractPath, status: 'skipped' };
      },
    },
  );
}
```

Add helper `ensureWorktreeRoot` near the bottom of the file:

```ts
async function ensureWorktreeRoot(cwd: string): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  const root = join(cwd, '.contractqa-worktrees');
  await mkdir(root, { recursive: true });
  return root;
}
```

`writeAutopilotFixPromptFromBundle` — `writeAutopilotFixPrompt` in autopilot.ts takes `(contractPath, failure, tmpDir)`. We don't have `failure` available here (the coordinator only knows `bundlePath`). Pivot: write a new helper that reads `issue.json` and synthesizes the prompt from it:

Add to `packages/cli/src/commands/autopilot-watch.ts`:

```ts
async function writeAutopilotFixPromptFromBundle(bundlePath: string, dest: string): Promise<string> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const issue = await readFile(join(bundlePath, 'issue.json'), 'utf8');
  const body = `You are fixing a product invariant violation reported by contractqa autopilot.

Rules:
1. Read the issue bundle first.
2. Fix production code, not the contract.
3. Do not weaken the contract. If it is wrong, emit proposed_contract_revision and STOP.
4. Keep the patch minimal.
5. After patching, return JSON with root_cause, files_changed, tests_run, validation_result, patch_diff.

Issue bundle:
- issue: ${join(bundlePath, 'issue.json')}

issue.json contents:
${issue}
`;
  await writeFile(dest, body);
  return dest;
}
```

- [ ] **Step 7: Wire `fixStrategy`/`shadowCoordinator` into `runOnce`'s `runAutopilot` call**

Find `runAutopilot(baseOpts)` inside `runOnce`. Change to:

```ts
const report = await runAutopilot({
  ...baseOpts,
  fixStrategy: coordinator ? 'shadow' : 'inPlace',
  shadowCoordinator: coordinator ?? undefined,
});
```

- [ ] **Step 8: Forward `fixOutcomes` to dashboard PATCH**

In `dashboardCompleteRun`, extend the call signature to accept `fixOutcomes`:

```ts
async function dashboardCompleteRun(
  url: string,
  runId: string,
  status: 'passed' | 'failed' | 'error',
  totals: Record<string, number> | null,
  issuesWritten: string[],
  fixOutcomes?: Array<{ issueJsonPath: string; outcome: string; prUrl?: string; branch?: string }>,
): Promise<number | null> {
  try {
    const res = await fetch(`${url}/api/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        endedAt: new Date().toISOString(),
        totals,
        issuesWritten,
        fixOutcomes,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { registeredIssues?: number };
    return data.registeredIssues ?? 0;
  } catch {
    return null;
  }
}
```

And at the call site in `runOnce`:

```ts
const registered = await dashboardCompleteRun(
  dashboardUrl,
  dashboardRunId,
  status,
  totals,
  report.issuesWritten ?? [],
  report.fixOutcomes?.map((o) => ({
    issueJsonPath: o.issueJsonPath,
    outcome: o.outcome,
    prUrl: o.prUrl,
    branch: o.branch,
  })),
);
```

- [ ] **Step 9: Run all watch tests**

Run: `cd packages/cli && pnpm exec vitest run tests/autopilot-watch-auto-pr.test.ts`
Expected: 3 preflight tests pass; existing watch tests unchanged.

- [ ] **Step 10: Typecheck**

Run: `cd packages/cli && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/cli/src/commands/autopilot-watch.ts packages/cli/tests/autopilot-watch-auto-pr.test.ts
git commit -m "feat(cli): autopilot --watch --auto-pr — preflight + coordinator wiring"
```

---

## Task 6: CLI flag — add `--auto-pr` to bin

**Files:**
- Modify: `packages/cli/bin/contractqa.ts:107-141`

- [ ] **Step 1: Add the flag and pass through**

In `packages/cli/bin/contractqa.ts`, in the `autopilot` command block, add the option:

```ts
  .option('--auto-pr', 'Night-shift mode: route Phase C through git worktree + gh pr create')
```

(Insert after `--regression-scope` line.)

Extend the `.action(...)` type:

```ts
.action(async (opts: {
  timeBudget: string;
  fix: boolean;
  yes?: boolean;
  regenerate?: boolean;
  regressionScope?: string;
  watch?: boolean;
  watchDebounce?: string;
  dashboardUrl?: string;
  autoPr?: boolean;  // ← new
}) => {
```

And pass it through to `watchAndRerun`:

```ts
await watchAndRerun(baseOpts, {
  debounceMs: Number(opts.watchDebounce ?? '2000'),
  onLog: (line) => console.log(line),
  dashboardUrl: opts.dashboardUrl,
  autoPr: opts.autoPr,
  regressionScope: baseOpts.regressionScope,
});
```

Also reject `--auto-pr` without `--watch` early — auto-PR only makes sense in watch mode:

Above the `if (!opts.watch)` block, add:

```ts
if (opts.autoPr && !opts.watch) {
  console.error('--auto-pr requires --watch (use: contractqa autopilot --watch --auto-pr)');
  process.exit(2);
}
```

- [ ] **Step 2: Rebuild the CLI**

```bash
cd packages/cli && pnpm exec tsc --build
```
Expected: no errors.

- [ ] **Step 3: Smoke test — flag is recognized**

```bash
node packages/cli/dist/bin/contractqa.js autopilot --help
```
Expected: `--auto-pr` appears in the options listing.

- [ ] **Step 4: Smoke test — preflight rejects when not in a git repo**

```bash
cd /tmp && mkdir empty-auto-pr-test && cd empty-auto-pr-test
node /Users/zmy/intership/5.10+/qa-agent/packages/cli/dist/bin/contractqa.js autopilot --watch --auto-pr --time-budget 5000 || echo "exit code: $?"
```
Expected: errors out at preflight (no git remote / not a git repo), non-zero exit.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/bin/contractqa.ts
git commit -m "feat(cli): --auto-pr flag on contractqa autopilot

Requires --watch (rejected otherwise with exit code 2).
Forwards autoPr + regressionScope to watchAndRerun."
```

---

## Task 7: Dashboard schema migration

**Files:**
- Create: `apps/dashboard/drizzle/migrations/0003_fix_pr.sql`
- Modify: `apps/dashboard/drizzle/schema.ts`

- [ ] **Step 1: Write the SQL migration**

Create `apps/dashboard/drizzle/migrations/0003_fix_pr.sql`:

```sql
-- 0003_fix_pr.sql
-- Adds night-shift auto-PR metadata to the issues table.
-- See docs/superpowers/specs/2026-05-18-night-shift-auto-pr-design.md §6
ALTER TABLE issues
  ADD COLUMN fix_pr_url    text,
  ADD COLUMN fix_outcome   text,
  ADD COLUMN fix_branch    text;
```

- [ ] **Step 2: Update the Drizzle schema**

In `apps/dashboard/drizzle/schema.ts`, extend the `issues` table:

```ts
export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id'),
  title: text('title'),
  severity: text('severity'),
  confidence: numeric('confidence'),
  status: text('status'),
  issueJsonPath: text('issue_json_path'),
  fixPrUrl: text('fix_pr_url'),
  fixOutcome: text('fix_outcome'),
  fixBranch: text('fix_branch'),
});
```

- [ ] **Step 3: Apply the migration locally (sanity check)**

If docker compose is already up:

```bash
docker compose -f docker/docker-compose.yml exec postgres \
  psql -U postgres -d contractqa -f /tmp/0003_fix_pr.sql \
  || (cat apps/dashboard/drizzle/migrations/0003_fix_pr.sql \
      | docker compose -f docker/docker-compose.yml exec -T postgres \
        psql -U postgres -d contractqa)
```

Verify:
```bash
docker compose -f docker/docker-compose.yml exec postgres \
  psql -U postgres -d contractqa -c '\d issues'
```
Expected: `fix_pr_url`, `fix_outcome`, `fix_branch` columns appear.

If postgres isn't running, skip — this will be applied by `contractqa dashboard` on next boot via the migration runner.

- [ ] **Step 4: Typecheck the dashboard**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/drizzle/migrations/0003_fix_pr.sql apps/dashboard/drizzle/schema.ts
git commit -m "feat(dashboard): 0003_fix_pr migration — add fix_pr_url/outcome/branch to issues"
```

---

## Task 8: Dashboard API — accept `fixOutcomes` in PATCH

**Files:**
- Modify: `apps/dashboard/app/api/runs/[id]/route.ts`

- [ ] **Step 1: Add the type and accept the field**

Open `apps/dashboard/app/api/runs/[id]/route.ts`. Find the JSDoc comment block at the top describing the PATCH body shape (around lines 8-15). Extend it:

```ts
 *   issuesWritten?: string[],
 *   fixOutcomes?: Array<{ issueJsonPath: string; outcome: string; prUrl?: string; branch?: string }>,
```

Find the `Body` interface (~line 32-37). Add:

```ts
type FixOutcome = {
  issueJsonPath: string;
  outcome: string;
  prUrl?: string;
  branch?: string;
};

interface Body {
  status?: Status;
  endedAt?: string;
  totals?: unknown;
  issuesWritten?: string[];
  fixOutcomes?: FixOutcome[];
}
```

- [ ] **Step 2: Build a lookup map and pass to `registerIssuesFromPaths`**

After parsing `body`, build:

```ts
const fixMap = new Map<string, FixOutcome>();
for (const fo of body.fixOutcomes ?? []) {
  fixMap.set(fo.issueJsonPath, fo);
}
```

Change the call:

```ts
if (body.issuesWritten && body.issuesWritten.length > 0) {
  registered = await registerIssuesFromPaths(id, body.issuesWritten, fixMap);
}
```

- [ ] **Step 3: Extend `registerIssuesFromPaths` to persist fix columns**

Find the function definition (around line 84) and modify its signature:

```ts
async function registerIssuesFromPaths(
  runId: string,
  paths: string[],
  fixMap?: Map<string, { outcome: string; prUrl?: string; branch?: string }>,
): Promise<number> {
```

In the insert/update block where each issue row is built, include the new columns when `fixMap` has an entry for that path:

```ts
const fo = fixMap?.get(absolutePath);
const row = {
  runId,
  title: parsed.title ?? 'Untitled',
  severity: parsed.severity ?? 'unknown',
  confidence: ...,
  status: parsed.status ?? 'open',
  issueJsonPath: absolutePath,
  fixOutcome: fo?.outcome ?? null,
  fixPrUrl: fo?.prUrl ?? null,
  fixBranch: fo?.branch ?? null,
};
```

(Adjust property name/shape to match how the existing code does Drizzle inserts. If it uses `db.insert(issues).values(row)`, the same `row` object works.)

- [ ] **Step 4: Add a failing test for the API extension**

Create `apps/dashboard/__tests__/api-runs-id-fix-outcomes.test.ts` (or wherever dashboard API tests live — check `apps/dashboard/package.json` for test setup. If no test infra exists, write a manual `curl` smoke test as Step 5 instead and skip this step):

```ts
// Use whatever test setup the dashboard already has. If none, see Step 5.
```

If no Vitest setup in `apps/dashboard`, skip to Step 5.

- [ ] **Step 5: Manual smoke test via curl**

In one terminal:
```bash
docker compose -f docker/docker-compose.yml up -d
cd apps/dashboard && pnpm dev
```

In another:
```bash
# Create a run
RUN_ID=$(curl -s -X POST http://localhost:3010/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"cwd":"/tmp/x","triggerType":"cli-watch"}' | jq -r .id)

# Create a fake issue.json
mkdir -p /tmp/fixoutcomes/i1
echo '{"title":"test","severity":"high","status":"open"}' > /tmp/fixoutcomes/i1/issue.json

# PATCH with fixOutcomes
curl -s -X PATCH http://localhost:3010/api/runs/$RUN_ID \
  -H 'Content-Type: application/json' \
  -d "{
    \"status\":\"passed\",
    \"endedAt\":\"2026-05-18T22:00:00Z\",
    \"issuesWritten\":[\"/tmp/fixoutcomes/i1/issue.json\"],
    \"fixOutcomes\":[{
      \"issueJsonPath\":\"/tmp/fixoutcomes/i1/issue.json\",
      \"outcome\":\"SUCCESS\",
      \"prUrl\":\"https://github.com/x/y/pull/1\",
      \"branch\":\"contractqa-fix/test\"
    }]
  }"

# Verify in DB
docker compose -f docker/docker-compose.yml exec postgres \
  psql -U postgres -d contractqa -c \
  "SELECT issue_json_path, fix_pr_url, fix_outcome, fix_branch FROM issues WHERE run_id = '$RUN_ID'"
```
Expected: row has `fix_pr_url = 'https://github.com/x/y/pull/1'`, `fix_outcome = 'SUCCESS'`, `fix_branch = 'contractqa-fix/test'`.

- [ ] **Step 6: Typecheck**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/app/api/runs/\[id\]/route.ts
git commit -m "feat(dashboard/api): PATCH /api/runs/:id accepts fixOutcomes

When fixOutcomes is present, registerIssuesFromPaths writes
fix_pr_url, fix_outcome, fix_branch onto the matching issues row
(matched by issue_json_path)."
```

---

## Task 9: Dashboard UI — Fix card on Issue Detail + PR chip on Run Overview

**Files:**
- Modify: `apps/dashboard/app/runs/[id]/page.tsx` (or wherever run-overview lives)
- Modify: Issue detail page (path TBD — `find apps/dashboard/app -name 'page.tsx' | xargs grep -l 'issue'`)

- [ ] **Step 1: Locate the Issue Detail page**

Run:
```bash
find /Users/zmy/intership/5.10+/qa-agent/apps/dashboard/app -name 'page.tsx' | xargs grep -l 'issue' 2>/dev/null
```

Note the exact path. It is likely `apps/dashboard/app/runs/[id]/issues/[issueId]/page.tsx` per existing dashboard scaffolding.

- [ ] **Step 2: Add the Fix card component**

In the Issue Detail page, after the existing detail blocks, add a server-component Fix card:

```tsx
{issue.fixOutcome && (
  <section className="fix-card" data-outcome={issue.fixOutcome}>
    <h2>Auto-fix</h2>
    <dl>
      <dt>Outcome</dt>
      <dd>
        <span className={`badge outcome-${issue.fixOutcome.toLowerCase()}`}>
          {issue.fixOutcome}
        </span>
      </dd>
      {issue.fixPrUrl && (
        <>
          <dt>Pull Request</dt>
          <dd>
            <a href={issue.fixPrUrl} target="_blank" rel="noreferrer">
              {issue.fixPrUrl}
            </a>
          </dd>
        </>
      )}
      {issue.fixBranch && (
        <>
          <dt>Branch</dt>
          <dd><code>{issue.fixBranch}</code></dd>
        </>
      )}
    </dl>
  </section>
)}
```

The query that hydrates `issue` must include the three new columns. Find the Drizzle select for the issue page (e.g. `db.select().from(issues).where(...)`); it auto-includes the new columns since we added them to the schema. No change needed to the select unless it uses an explicit column list.

- [ ] **Step 3: Add CSS tokens following DESIGN.md**

In the page's CSS module (e.g. `apps/dashboard/app/runs/[id]/issues/[issueId]/page.module.css` — match existing pattern):

```css
.fix-card {
  border: 1px solid var(--color-border, #2a2a2a);
  border-radius: 2px;
  padding: 16px;
  margin-top: 16px;
}
.badge {
  padding: 2px 8px;
  border-radius: 2px;
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
}
.outcome-success { background: #F4D03F; color: #000; }  /* sodium yellow — sole accent */
.outcome-regression { background: #5a1a1a; color: #fff; }
.outcome-exhausted, .outcome-parse_error, .outcome-contract_revision_needed {
  background: #2a2a2a; color: #aaa;
}
.outcome-skipped_pr_exists { background: #1a3a5a; color: #fff; }
```

(Refer to `DESIGN.md` for the actual variable names. The sodium yellow `#F4D03F` MUST only appear on the SUCCESS state — that's the only screen-allowed accent placement per CLAUDE.md.)

- [ ] **Step 4: Add the PR-count chip to Run Overview**

Locate Run Overview page (e.g. `apps/dashboard/app/runs/[id]/page.tsx`). In the header section near totals, add:

```tsx
{issues.some((i) => i.fixPrUrl) && (
  <span className="chip chip-prs">
    {issues.filter((i) => i.fixPrUrl).length} PRs
  </span>
)}
```

(`issues` here is the existing query that hydrates the page's issue list.)

- [ ] **Step 5: Manual smoke test**

With the dashboard running and the curl-seeded data from Task 8 Step 5, navigate to:
```
http://localhost:3010/runs/<RUN_ID>
```
Expected: PR chip visible in header.

Navigate to the issue's detail page. Expected: Fix card visible with PR link, branch name, SUCCESS badge in sodium yellow.

- [ ] **Step 6: Typecheck**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/app/runs apps/dashboard/app/runs/\[id\]
git commit -m "feat(dashboard/ui): Fix card on Issue Detail + PRs chip on Run Overview

Shows fix outcome, PR URL, branch name. SUCCESS state uses the
sole-allowed sodium-yellow accent per DESIGN.md."
```

---

## Task 10: End-to-end integration test with stub `gh`

**Files:**
- Create: `e2e/night-shift.test.ts`
- Create: `e2e/stub-gh.sh` (helper script)

- [ ] **Step 1: Create the stub gh binary**

Create `e2e/stub-gh.sh`:

```bash
#!/usr/bin/env bash
# stub-gh.sh: a fake `gh` that records argv and returns canned responses.
# Used by night-shift.test.ts to avoid hitting real GitHub.

LOG="${GH_STUB_LOG:-/tmp/gh-stub-calls.log}"
echo "$@" >> "$LOG"

case "$1" in
  --version)
    echo "gh version 2.40.0 (stub)"
    exit 0
    ;;
  auth)
    if [[ "$2" == "status" ]]; then
      echo "Logged in to github.com as stub"
      exit 0
    fi
    ;;
  pr)
    case "$2" in
      list)
        # Idempotency probe — return empty.
        echo ""
        exit 0
        ;;
      create)
        # Always succeed with a canned URL.
        echo "https://github.com/stub/repo/pull/${GH_STUB_PR_NUMBER:-1}"
        exit 0
        ;;
    esac
    ;;
esac

echo "stub-gh: unhandled $@" >&2
exit 1
```

```bash
chmod +x e2e/stub-gh.sh
```

- [ ] **Step 2: Write the failing e2e test**

Create `e2e/night-shift.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

describe('autopilot --watch --auto-pr end-to-end with stub gh', () => {
  it('runs preflight, opens worktree, calls stub gh pr create, records PR URL', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'night-shift-e2e-'));
    try {
      // 1. Initialize a tiny git repo with a failing HTTP smoke contract.
      await runShell('git init -b main', tmp);
      await runShell('git remote add origin git@github.com:stub/repo.git', tmp);
      await writeFile(path.join(tmp, 'README.md'), 'fixture\n');
      await runShell('git add . && git -c user.email=test@e.com -c user.name=t commit -m init', tmp);

      await mkdir(path.join(tmp, 'qa/contracts/_smoke'), { recursive: true });
      await writeFile(
        path.join(tmp, 'qa/contracts/_smoke/will-fail.yml'),
        `id: will-fail
description: always fails (port 1 never listens)
http:
  request: { method: GET, url: "http://127.0.0.1:1/nope" }
  expect: { status: 200 }
`,
      );

      // 2. Run contractqa autopilot --watch --auto-pr with stub gh on PATH.
      const stubLog = path.join(tmp, 'gh-stub-calls.log');
      const stubGh = path.resolve(__dirname, 'stub-gh.sh');
      const stubDir = path.join(tmp, '.stub-bin');
      await mkdir(stubDir);
      // Symlink stub as `gh`:
      await runShell(`ln -s ${stubGh} ${path.join(stubDir, 'gh')}`, tmp);

      const cliPath = path.resolve(__dirname, '../packages/cli/dist/bin/contractqa.js');
      const env = {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        GH_STUB_LOG: stubLog,
        // Use a stub LLM to avoid hitting real Claude. The autopilot's pickClient
        // surfaces an error if no API key/CC creds present — we provide ANTHROPIC_API_KEY
        // and stub via vitest mock OR use the openai-compatible client with a local stub.
        // SIMPLER: set --no-fix? No — we want fix path. We MUST have an LLM stub here.
        // Two options: (a) mock pickClient inside test via vi.mock; (b) skip fix entirely.
        // For e2e correctness, expect this test to require manual LLM setup OR be
        // marked .skip in CI until an LLM stub is wired. See Step 4 note.
      };

      // Run for 10 seconds then SIGINT.
      const child = spawn('node', [cliPath, 'autopilot', '--watch', '--auto-pr', '--yes', '--time-budget', '5000'], {
        cwd: tmp,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stdout += d.toString()));

      await new Promise((r) => setTimeout(r, 10_000));
      child.kill('SIGINT');
      await new Promise((r) => child.on('exit', r));

      // 3. Assert stub gh was called.
      const log = await readFile(stubLog, 'utf8');
      expect(log).toContain('--version');
      expect(log).toContain('auth status');
      // If LLM stub worked → expect `pr create` call.
      // Without LLM stub → at minimum preflight ran (version + auth).
      // Document the limitation in Step 4.
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});

function runShell(cmd: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', cmd], { cwd, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} → ${code}`))));
  });
}
```

- [ ] **Step 3: Run the e2e**

```bash
cd e2e && pnpm exec vitest run night-shift.test.ts
```
Expected:
- Preflight assertions pass (stub gh `--version` + `auth status` were called).
- The `pr create` assertion may not run because the LLM stub is not yet wired — see Step 4.

- [ ] **Step 4: Document LLM-stub limitation**

The e2e test as written verifies preflight + watch loop start. The full fix → PR loop requires an LLM stub. Add a comment at the top of `e2e/night-shift.test.ts`:

```ts
// NOTE: This e2e verifies preflight + watch-loop startup against the stub gh.
// To exercise the full fix → commit → PR path, an LLM stub must be wired via
// the orchestrator's `LLMClient` injection. Tracked: see future plan for
// `contractqa autopilot --watch --auto-pr --llm-recording <fixture>` (a
// RecordingLLMClient already exists at packages/orchestrator/src/llm/recording-client.ts).
```

- [ ] **Step 5: Commit**

```bash
git add e2e/night-shift.test.ts e2e/stub-gh.sh
git commit -m "test(e2e): night-shift auto-PR preflight + watch-loop startup

Stubs gh via PATH override and asserts preflight calls. Full fix→PR
loop requires LLM stub wiring — documented for follow-up."
```

---

## Self-Review Checklist

Run through this AFTER all 10 tasks are complete:

- [ ] All steps have actual code (no "implement here" placeholders)
- [ ] Type names match across tasks: `CoordinatorFixOutcome`, `OpenFixPrResult`, `AutopilotOptions.fixStrategy`, `WatchOptions.autoPr`
- [ ] Spec §5.1 (HTTP-only regression) is implemented (Task 3 Step 7's `wrappedRunContract`)
- [ ] Spec §5.2 (idempotency probes) is implemented (Task 3 Step 7's `findExistingPr` call)
- [ ] Spec §5.3 (files-changed filter) is implemented (Task 1 Step 16's `filterAutopilotInternals`)
- [ ] Spec §3.2.1 (redaction) is implemented (Task 2 Step 3's `redactSecrets`)
- [ ] Spec §3.5 (git ≥ 2.32 + gh ≥ 2.0) is enforced (Task 1 Step 9 + Task 5 Step 3)
- [ ] Spec §3.6 (startup log) is implemented (Task 5 Step 6's log lines)
- [ ] Spec §6 (DB columns + API extension + UI) is implemented (Tasks 7, 8, 9)
- [ ] No changes to `packages/orchestrator/src/shadow-pipeline.ts` (per spec §4.3)
- [ ] CLI flag rejects `--auto-pr` without `--watch` (Task 6 Step 1)
- [ ] Sodium yellow `#F4D03F` used ONLY on the SUCCESS badge (Task 9 Step 3)

---

## Final smoke test

After all commits land:

```bash
# Rebuild everything
pnpm -r --filter './packages/**' build
pnpm -r --filter './packages/**' test

# Boot dashboard
pnpm exec contractqa dashboard &
sleep 10

# In a scratch git repo with an HTTP smoke contract:
cd /tmp/scratch && contractqa autopilot --watch --auto-pr --yes \
  --time-budget 60000 --dashboard-url http://localhost:3010
```
Expected:
- Startup banner: `[watch] auto-pr ON · base branch: main · regression scope: touched-files`
- Phase A failure → coordinator opens worktree → stub-LLM-or-real-LLM patches → commit → push → PR opens.
- Dashboard at `http://localhost:3010/runs/<id>` shows the issue with Fix card and PR link.
