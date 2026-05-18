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

import type { runShadowFix } from '../src/autopilot/shadow-fix-coordinator.js';

const mkExec = (urls: Record<string, string> = {}) =>
  vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      // idempotency probe — return empty (no existing PR)
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      // Return a fake PR URL so openFixPR resolves to status:'success'
      return { stdout: 'https://github.com/x/y/pull/42\n', stderr: '', exitCode: 0 };
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
    // mkExec returns a fake URL for `gh pr create` so openFixPR resolves to
    // status='success' and mapResult promotes runShadowFix's SUCCESS into a
    // coordinator-level SUCCESS.
  });
});

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

describe('ShadowFixCoordinator.fix push-failure safety net', () => {
  it('returns EXHAUSTED when openFixPR push fails even if runShadowFix reports SUCCESS', async () => {
    // Simulate: runShadowFix calls our openFixPR, which fails (push rejected),
    // returns {url: ''}, runShadowFix then optimistically reports SUCCESS.
    // mapResult MUST translate this to EXHAUSTED.
    const fakeRunShadowFix = vi.fn(async (input) => {
      const pr = await input.openFixPR({
        branch: 'contractqa-fix/abc',
        baseBranch: 'main',
        issueId: 'abc',
        filesChanged: ['src/a.ts'],
      });
      return { outcome: 'SUCCESS' as const, prUrl: pr.url, attempts: 1 };
    });

    // Exec mock: idempotency probe returns empty (no existing PR),
    // then git push fails inside openFixPR.
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (cmd === 'git' && args[0] === 'push') {
        return { stdout: '', stderr: 'remote rejected', exitCode: 128 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const coord = new ShadowFixCoordinator(
      {
        worktreeRoot: '/tmp/wt',
        repoRoot: '/tmp/repo',
        baseBranch: 'main',
        contractsDir: '/tmp/c',
        llmClient: stubLlm,
        regressionScope: 'touched-files',
      },
      {
        writePromptFile: async (_b, dest) => dest,
        runContract: async (p) => ({ contractPath: p, status: 'pass' }),
        runShadowFixImpl: fakeRunShadowFix as unknown as typeof runShadowFix,
        exec,
      },
    );

    const result = await coord.fix({
      issueId: 'abc',
      issueJsonPath: '/tmp/issue.json',
      failingContractPath: '/tmp/c.yml',
      bundlePath: '/tmp',
    });

    expect(result.outcome).toBe('EXHAUSTED');
    expect(result.prUrl).toBeUndefined();
  });
});
