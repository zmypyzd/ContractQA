import path from 'node:path';
import type { FixOutcome } from './fix-loop.js';
import { runFixLoop } from './fix-loop.js';

export type ShadowFixOutcome = FixOutcome | 'REGRESSION';
import {
  type VerifyScope,
  findContractsTouchingFiles,
  walkAllContracts,
  extractTouchedFiles,
} from './verify-scope.js';

export interface ShadowFixInput {
  issueId: string;
  bundlePath: string;
  baseBranch: string;
  repoRoot: string;
  worktreeRoot: string;
  maxAttempts: number;
  originalPrNumber?: number;
  createWorktree: (i: {
    repoRoot: string;
    issueId: string;
    worktreeRoot: string;
    baseBranch: string;
  }) => Promise<{ path: string; branch: string; remove: () => Promise<void> }>;
  runClaude: (i: { promptPath: string; cwd: string; allowedTools: string[] }) => Promise<{
    validation_result: 'PASS' | 'FAIL' | 'PARSE_ERROR';
    proposed_contract_revision?: unknown;
    files_changed?: string[];
    /** Unified diff of files changed by the fix. Used when verifyScope !== 'one'. */
    patch_diff?: string;
    raw_stdout: string;
  }>;
  openFixPR: (i: {
    branch: string;
    baseBranch: string;
    issueId: string;
    filesChanged: string[];
    originalPrNumber?: number;
  }) => Promise<{ url: string }>;
  commentOnPR?: (i: { prNumber: number; body: string }) => Promise<void>;
  writePromptFile: (bundlePath: string, dest: string) => Promise<string>;

  /**
   * @experimental — added in v1.1.0 for autopilot.
   * Controls which contracts are re-run after a successful fix to detect regressions.
   * - `'one'` (default): no additional regression check beyond what `runClaude` already verifies.
   * - `'touched-files'`: re-runs contracts whose YAML text mentions any file in `patchDiff`.
   * - `'all'`: re-runs every contract in `contractsDir`.
   */
  verifyScope?: VerifyScope;

  /**
   * Required when `verifyScope === 'touched-files'` or `'all'`.
   * Absolute path to the directory containing .yml/.yaml contract files.
   */
  contractsDir?: string;

  /**
   * Absolute path to the failing contract YAML file.
   * Used to exclude it from the regression check set (it is already verified by `runClaude`).
   */
  failingContractPath?: string;

  /**
   * Unified diff produced by the fix (e.g., `git diff HEAD~1 HEAD`).
   * Required when `verifyScope === 'touched-files'`.
   * May also be provided on the `runClaude` result as `patch_diff`.
   */
  patchDiff?: string;

  /**
   * Run a single contract and return whether it passes.
   * Required when `verifyScope !== 'one'`.
   */
  runContract?: (contractPath: string) => Promise<{ contractPath: string; status: 'pass' | 'fail' }>;
}

export interface ShadowFixResult {
  outcome: ShadowFixOutcome;
  prUrl?: string;
  attempts: number;
  /** Populated when outcome === 'REGRESSION': which contract regressed. */
  regressionContract?: string;
}

async function runConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<unknown[]> {
  const results: unknown[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= items.length) return;
      results[myIdx] = await fn(items[myIdx]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runShadowFix(i: ShadowFixInput): Promise<ShadowFixResult> {
  const wt = await i.createWorktree({
    repoRoot: i.repoRoot,
    issueId: i.issueId,
    worktreeRoot: i.worktreeRoot,
    baseBranch: i.baseBranch,
  });
  try {
    const promptPath = await i.writePromptFile(
      i.bundlePath,
      path.join(wt.path, '.contractqa-fix-prompt.md'),
    );
    const loop = await runFixLoop({
      maxAttempts: i.maxAttempts,
      fix: async () =>
        i.runClaude({
          promptPath,
          cwd: wt.path,
          allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
        }),
    });

    if (loop.outcome === 'SUCCESS') {
      // Regression check: run contracts that may be affected by the fix
      const scope = i.verifyScope ?? 'one';
      if (scope !== 'one' && !i.runContract) {
        throw new Error(
          `runShadowFix: verifyScope='${scope}' requires runContract to be provided. ` +
          `Either pass runContract or use verifyScope='one' (default).`,
        );
      }
      if (scope !== 'one' && !i.contractsDir) {
        throw new Error(
          `runShadowFix: verifyScope='${scope}' requires contractsDir to be provided.`,
        );
      }
      if (scope !== 'one' && i.runContract && i.contractsDir) {
        const lastResult = loop.history.at(-1);
        const diff = i.patchDiff ?? lastResult?.patch_diff ?? '';

        let contractsToCheck: string[];
        if (scope === 'touched-files') {
          const touched = extractTouchedFiles(diff);
          const related = findContractsTouchingFiles(i.contractsDir, touched);
          // Exclude the failing contract itself (already verified by runClaude)
          contractsToCheck = related.filter((c) => c !== i.failingContractPath);
        } else {
          // 'all'
          contractsToCheck = walkAllContracts(i.contractsDir).filter(
            (c) => c !== i.failingContractPath,
          );
        }

        if (contractsToCheck.length > 0) {
          const REGRESSION_CONCURRENCY = 4;
          const results = await runConcurrent(contractsToCheck, REGRESSION_CONCURRENCY, (c) => i.runContract!(c)) as Array<{ status: string; contractPath?: string }>;
          const regression = results.find((r) => r.status === 'fail');
          if (regression) {
            return {
              outcome: 'REGRESSION',
              attempts: loop.attempts,
              regressionContract: regression.contractPath,
            };
          }
        }
      }

      const pr = await i.openFixPR({
        branch: wt.branch,
        baseBranch: i.baseBranch,
        issueId: i.issueId,
        filesChanged: loop.history.at(-1)?.files_changed ?? [],
        originalPrNumber: i.originalPrNumber,
      });
      return { outcome: 'SUCCESS', prUrl: pr.url, attempts: loop.attempts };
    }

    if (loop.outcome === 'EXHAUSTED' && i.originalPrNumber && i.commentOnPR) {
      await i.commentOnPR({
        prNumber: i.originalPrNumber,
        body: `ContractQA shadow-fix exhausted (${loop.attempts}/${i.maxAttempts}). Latest stdout:\n\n\`\`\`\n${loop.history.at(-1)?.raw_stdout ?? ''}\n\`\`\``,
      });
    }
    return { outcome: loop.outcome, attempts: loop.attempts };
  } finally {
    await wt.remove();
  }
}
