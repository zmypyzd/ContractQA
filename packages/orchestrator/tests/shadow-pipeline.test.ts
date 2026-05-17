import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('throws when verifyScope is touched-files but runContract is omitted', async () => {
    await expect(
      runShadowFix({
        issueId: 'x',
        bundlePath: '/x',
        baseBranch: 'main',
        repoRoot: '/r',
        worktreeRoot: '/t',
        maxAttempts: 1,
        createWorktree: vi
          .fn()
          .mockResolvedValue({ path: '/wt', branch: 'b', remove: vi.fn().mockResolvedValue(undefined) }),
        runClaude: vi.fn().mockResolvedValue({ validation_result: 'PASS', files_changed: [], raw_stdout: '' }),
        openFixPR: vi.fn().mockResolvedValue({ url: 'https://github.com/x/pr/1' }),
        writePromptFile: vi.fn().mockResolvedValue('/p'),
        verifyScope: 'touched-files',
        // runContract intentionally omitted
        contractsDir: '/some/dir',
      }),
    ).rejects.toThrow("runShadowFix: verifyScope='touched-files' requires runContract to be provided");
  });

  it('caps regression-check concurrency at 4 (wall-time test)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-conc-'));
    try {
      mkdirSync(join(tmp, 'contracts'), { recursive: true });
      // Create 20 contract YAML files all mentioning the touched file
      for (let i = 0; i < 20; i++) {
        writeFileSync(join(tmp, 'contracts', `c${i}.yml`), `# app/auth.ts\n`);
      }

      let running = 0;
      let maxObservedConcurrency = 0;
      const runContract = vi.fn().mockImplementation(async (_path: string) => {
        running++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, running);
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        running--;
        return { contractPath: _path, status: 'pass' as const };
      });

      const start = Date.now();
      const r = await runShadowFix({
        issueId: 'conc-test',
        bundlePath: '/x',
        baseBranch: 'main',
        repoRoot: '/r',
        worktreeRoot: '/t',
        maxAttempts: 1,
        createWorktree: vi
          .fn()
          .mockResolvedValue({ path: '/wt', branch: 'b', remove: vi.fn().mockResolvedValue(undefined) }),
        runClaude: vi.fn().mockResolvedValue({
          validation_result: 'PASS',
          files_changed: ['app/auth.ts'],
          patch_diff: '--- a/app/auth.ts\n+++ b/app/auth.ts\n',
          raw_stdout: '',
        }),
        openFixPR: vi.fn().mockResolvedValue({ url: 'https://github.com/x/pr/1' }),
        writePromptFile: vi.fn().mockResolvedValue('/p'),
        verifyScope: 'all',
        contractsDir: join(tmp, 'contracts'),
        runContract,
      });
      const elapsed = Date.now() - start;

      expect(r.outcome).toBe('SUCCESS');
      // With 20 contracts at 100ms each and concurrency=4: ceil(20/4)*100 = 500ms
      // Allow generous tolerance of 600ms
      expect(elapsed).toBeLessThan(600);
      // Max observed concurrency should not exceed 4
      expect(maxObservedConcurrency).toBeLessThanOrEqual(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
