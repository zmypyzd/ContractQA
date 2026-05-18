import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Mock smoke-patterns to inject one HTTP-typed pattern so Phase A produces a
// failure without needing a real server. The pattern hits a closed port.
vi.mock('../src/autopilot/smoke-patterns.js', () => ({
  applicablePatterns: () => [
    {
      id: 'TEST-always-fail',
      title: 'Always-failing HTTP pattern for test',
      appliesTo: () => true,
      generate: () => ({
        id: 'TEST-always-fail',
        title: 'Always-failing HTTP pattern for test',
        area: 'smoke',
        severity: 'P0',
        // HTTP action type so runContractPath executes it (not defer).
        actions: [{ type: 'http', method: 'GET', url: 'http://127.0.0.1:1/never-listens' }],
        expected: { status: 200 },
      }),
    },
  ],
}));

// Import after mocks are registered.
const { runAutopilot } = await import('../src/commands/autopilot.js');
const { ShadowFixCoordinator } = await import('../src/autopilot/shadow-fix-coordinator.js');

describe('autopilot Phase C dispatch with fixStrategy=shadow', () => {
  it('routes failures through coordinator.fix and includes fixOutcomes in report', async () => {
    // Build a minimal cwd with git + package.json committed (clean working tree
    // so stash guard doesn't stash files before assembleTargetContext runs).
    const cwd = await mkdtemp(path.join(tmpdir(), 'autopilot-shadow-'));
    await exec('git', ['init'], { cwd });
    await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'test-app', version: '0.0.1' }));
    await exec('git', ['add', 'package.json'], { cwd });
    await exec('git', [
      '-c', 'user.email=test@test.com',
      '-c', 'user.name=test',
      'commit', '-m', 'init',
    ], { cwd });

    // Stub coordinator that records calls and returns SUCCESS with a fake PR.
    const fixCalls: string[] = [];
    const stubCoordinator = {
      fix: vi.fn(async (req: { issueId: string; issueJsonPath: string }) => {
        fixCalls.push(req.issueId);
        return {
          issueId: req.issueId,
          issueJsonPath: req.issueJsonPath,
          branchSafeId: 'fake-id',
          outcome: 'SUCCESS' as const,
          prUrl: 'https://github.com/x/y/pull/1',
          branch: 'contractqa-fix/fake-id',
          skippedBrowserContracts: 0,
        };
      }),
    } as unknown as typeof ShadowFixCoordinator.prototype;

    // Stub LLM client so Phase B completes immediately with no proposals.
    const stubLlm = {
      providerName: 'anthropic-sdk' as const,
      modelHint: 'test',
      generate: async () => ({ content: '{"proposals":[]}', usage: { inputTokens: 0, outputTokens: 0 } }),
    };

    const report = await runAutopilot({
      cwd,
      timeBudgetMs: 30_000,
      fix: true,
      yes: true,
      regenerate: true,
      fixStrategy: 'shadow',
      shadowCoordinator: stubCoordinator as unknown as InstanceType<typeof ShadowFixCoordinator>,
      llmClient: stubLlm,
    });

    expect(fixCalls.length).toBeGreaterThan(0);
    expect(report.fixOutcomes).toBeDefined();
    expect(report.fixOutcomes!.length).toBeGreaterThan(0);
    expect(report.fixOutcomes![0].prUrl).toBe('https://github.com/x/y/pull/1');
  }, 30_000);
});
