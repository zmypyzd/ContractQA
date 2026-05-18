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
    const e = err as { stdout?: string; stderr?: string; code?: unknown };
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || String(err),
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
