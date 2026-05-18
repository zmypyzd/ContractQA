import { describe, expect, it, vi } from 'vitest';
import { checkGhAvailable, checkGitVersion, openFixPR, findExistingPr, type ExecFn } from '../src/autopilot/gh-pr.js';

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
      filesChanged: ['src/a.ts'],
      prTitle: 't',
      prBody: 'b',
      exec,
    });
    expect(result.status).toBe('already-exists');
    expect(result.prUrl).toBe(PR_URL);
  });
});

describe('defaultExec ENOENT handling', () => {
  it('checkGitVersion returns ok=false with reason when git binary is missing', async () => {
    // Use a binary that definitely doesn't exist — exercises the real defaultExec ENOENT path
    const result = await checkGitVersion({ gitBin: '/nonexistent/no-such-git-binary-xyz' });
    expect(result.ok).toBe(false);
    // reason should be informative, not empty
    expect(result.reason).toBeTruthy();
  });
});
