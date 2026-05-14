import { describe, it, expect, vi } from 'vitest';
import { runShadowFix } from '../src/shadow-pipeline.js';

describe('runShadowFix', () => {
  it('happy path: creates worktree, runs claude, opens fix-PR, removes worktree', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ path: '/wt', branch: 'cqa/x', remove });
    const fix = vi
      .fn()
      .mockResolvedValue({
        validation_result: 'PASS',
        files_changed: ['src/auth.ts'],
        raw_stdout: '',
      });
    const openPR = vi.fn().mockResolvedValue({ url: 'https://github.com/x/pr/1' });
    const r = await runShadowFix({
      issueId: 'AUTH-LOGOUT-001',
      bundlePath: '/art/runs/x',
      baseBranch: 'main',
      repoRoot: '/repo',
      worktreeRoot: '/tmp',
      maxAttempts: 3,
      createWorktree: create,
      runClaude: fix,
      openFixPR: openPR,
      writePromptFile: vi.fn().mockResolvedValue('/tmp/p.md'),
    });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.prUrl).toBe('https://github.com/x/pr/1');
    expect(create).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('on EXHAUSTED: comments root-cause on original PR, does not open fix-PR', async () => {
    const comment = vi.fn().mockResolvedValue(undefined);
    const openPR = vi.fn();
    const r = await runShadowFix({
      issueId: 'x',
      bundlePath: '/x',
      baseBranch: 'main',
      repoRoot: '/r',
      worktreeRoot: '/t',
      maxAttempts: 3,
      createWorktree: vi
        .fn()
        .mockResolvedValue({ path: '/wt', branch: 'b', remove: vi.fn() }),
      runClaude: vi.fn().mockResolvedValue({ validation_result: 'FAIL', raw_stdout: '' }),
      openFixPR: openPR as never,
      commentOnPR: comment,
      originalPrNumber: 42,
      writePromptFile: vi.fn().mockResolvedValue('/p'),
    });
    expect(r.outcome).toBe('EXHAUSTED');
    expect(comment).toHaveBeenCalled();
    expect(openPR).not.toHaveBeenCalled();
  });
});
