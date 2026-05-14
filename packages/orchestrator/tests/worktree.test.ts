import { describe, it, expect, vi } from 'vitest';
import { createFixWorktree } from '../src/worktree.js';

describe('createFixWorktree', () => {
  it('invokes git worktree add with isolated branch name', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const r = await createFixWorktree({
      repoRoot: '/repo',
      issueId: 'AUTH-LOGOUT-001',
      worktreeRoot: '/tmp/cqa-wt',
      baseBranch: 'main',
      exec,
    });
    const cmds = exec.mock.calls.map((c) => c[0]);
    expect(cmds.some((c) => (c as string).includes('worktree add'))).toBe(true);
    expect(cmds.some((c) => (c as string).includes('contractqa-fix/AUTH-LOGOUT-001'))).toBe(true);
    expect(r.path).toContain('AUTH-LOGOUT-001');
    expect(r.branch).toBe('contractqa-fix/AUTH-LOGOUT-001');
  });
});
