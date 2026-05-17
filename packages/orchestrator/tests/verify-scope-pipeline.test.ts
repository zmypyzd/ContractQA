import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShadowFix } from '../src/shadow-pipeline.js';

// Helper to build a minimal ShadowFixInput that succeeds on first attempt
function baseInput(overrides: Partial<Parameters<typeof runShadowFix>[0]> = {}) {
  const remove = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue({ path: '/wt', branch: 'cqa/x', remove });
  const runClaude = vi.fn().mockResolvedValue({
    validation_result: 'PASS',
    files_changed: ['src/auth.ts'],
    raw_stdout: '',
  });
  const openPR = vi.fn().mockResolvedValue({ url: 'https://github.com/x/pr/1' });
  return {
    issueId: 'AUTH-001',
    bundlePath: '/art/runs/x',
    baseBranch: 'main',
    repoRoot: '/repo',
    worktreeRoot: '/tmp',
    maxAttempts: 3,
    createWorktree: create,
    runClaude,
    openFixPR: openPR,
    writePromptFile: vi.fn().mockResolvedValue('/wt/.contractqa-fix-prompt.md'),
    ...overrides,
  } as Parameters<typeof runShadowFix>[0];
}

describe('orchestrator verifyScope', () => {
  it('default behaviour (verifyScope omitted) runs only the failing contract — no extra runContract calls', async () => {
    const runContract = vi.fn().mockResolvedValue({ contractPath: '/qa/contracts/auth.yml', status: 'pass' });
    const input = baseInput({ runContract });
    const r = await runShadowFix(input);
    expect(r.outcome).toBe('SUCCESS');
    // With default 'one' scope, runContract should NOT be called (no extra regression check)
    expect(runContract).not.toHaveBeenCalled();
  });

  it('verifyScope: "touched-files" runs contracts that mention files in the patch', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-vs-'));
    try {
      mkdirSync(join(tmp, 'qa', 'contracts'), { recursive: true });
      // This contract mentions the patched file
      writeFileSync(
        join(tmp, 'qa', 'contracts', 'logout.yml'),
        '# evidence: app/auth/actions.ts\nid: LOGOUT\n',
      );
      // This contract does NOT mention the patched file
      writeFileSync(
        join(tmp, 'qa', 'contracts', 'orders.yml'),
        '# evidence: app/orders/page.tsx\nid: ORDERS\n',
      );

      const patchDiff = `diff --git a/app/auth/actions.ts b/app/auth/actions.ts\n--- a/app/auth/actions.ts\n+++ b/app/auth/actions.ts\n@@ -1 +1,2 @@\n const x = 1;\n+const y = 2;\n`;

      const runContract = vi.fn().mockResolvedValue({ contractPath: join(tmp, 'qa', 'contracts', 'logout.yml'), status: 'pass' });

      const runClaude = vi.fn().mockResolvedValue({
        validation_result: 'PASS',
        files_changed: ['app/auth/actions.ts'],
        patch_diff: patchDiff,
        raw_stdout: '',
      });

      const r = await runShadowFix(baseInput({
        runClaude,
        runContract,
        verifyScope: 'touched-files',
        contractsDir: join(tmp, 'qa', 'contracts'),
        failingContractPath: join(tmp, 'qa', 'contracts', 'auth.yml'),
        patchDiff,
      }));

      expect(r.outcome).toBe('SUCCESS');
      // logout.yml mentions app/auth/actions.ts → should be checked
      expect(runContract).toHaveBeenCalledWith(join(tmp, 'qa', 'contracts', 'logout.yml'));
      // orders.yml does NOT mention it → should NOT be checked
      expect(runContract).not.toHaveBeenCalledWith(join(tmp, 'qa', 'contracts', 'orders.yml'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('regression detected: outcome is REGRESSION and fix-PR is not opened', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-vs-reg-'));
    try {
      mkdirSync(join(tmp, 'qa', 'contracts'), { recursive: true });
      writeFileSync(
        join(tmp, 'qa', 'contracts', 'logout.yml'),
        '# evidence: app/auth/actions.ts\nid: LOGOUT\n',
      );

      const patchDiff = `--- a/app/auth/actions.ts\n+++ b/app/auth/actions.ts\n`;

      // runContract reports regression in logout.yml
      const runContract = vi.fn().mockResolvedValue({
        contractPath: join(tmp, 'qa', 'contracts', 'logout.yml'),
        status: 'fail',
      });

      const openPR = vi.fn().mockResolvedValue({ url: 'https://github.com/x/pr/1' });

      const r = await runShadowFix(baseInput({
        openFixPR: openPR,
        runContract,
        verifyScope: 'touched-files',
        contractsDir: join(tmp, 'qa', 'contracts'),
        failingContractPath: join(tmp, 'qa', 'contracts', 'auth.yml'),
        patchDiff,
      }));

      expect(r.outcome).toBe('REGRESSION');
      // Should NOT open a PR when regression is detected
      expect(openPR).not.toHaveBeenCalled();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('verifyScope: "all" checks all contracts in contractsDir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-vs-all-'));
    try {
      mkdirSync(join(tmp, 'qa', 'contracts'), { recursive: true });
      writeFileSync(join(tmp, 'qa', 'contracts', 'a.yml'), 'id: A\n');
      writeFileSync(join(tmp, 'qa', 'contracts', 'b.yml'), 'id: B\n');

      const runContract = vi.fn().mockResolvedValue({ contractPath: '', status: 'pass' });

      const r = await runShadowFix(baseInput({
        runContract,
        verifyScope: 'all',
        contractsDir: join(tmp, 'qa', 'contracts'),
        failingContractPath: join(tmp, 'qa', 'contracts', 'auth.yml'),
        patchDiff: '',
      }));

      expect(r.outcome).toBe('SUCCESS');
      expect(runContract).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
