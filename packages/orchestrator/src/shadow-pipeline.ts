import path from 'node:path';
import type { FixOutcome } from './fix-loop.js';
import { runFixLoop } from './fix-loop.js';

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
}

export interface ShadowFixResult {
  outcome: FixOutcome;
  prUrl?: string;
  attempts: number;
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
