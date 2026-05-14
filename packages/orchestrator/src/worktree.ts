import path from 'node:path';
import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(nodeExec);

export interface FixWorktree {
  path: string;
  branch: string;
  remove: () => Promise<void>;
}

export interface CreateFixWorktreeInput {
  repoRoot: string;
  issueId: string;
  worktreeRoot: string;
  baseBranch: string;
  exec?: (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;
}

export async function createFixWorktree(input: CreateFixWorktreeInput): Promise<FixWorktree> {
  const run =
    input.exec ??
    ((c: string, o: { cwd: string }) =>
      execAsync(c, o) as unknown as Promise<{ stdout: string; stderr: string }>);
  const branch = `contractqa-fix/${input.issueId}`;
  const dest = path.join(input.worktreeRoot, input.issueId);
  await run(`git worktree add -b ${branch} ${dest} ${input.baseBranch}`, { cwd: input.repoRoot });
  return {
    path: dest,
    branch,
    remove: async () => {
      await run(`git worktree remove --force ${dest}`, { cwd: input.repoRoot });
      await run(`git branch -D ${branch}`, { cwd: input.repoRoot }).catch(() => undefined);
    },
  };
}
