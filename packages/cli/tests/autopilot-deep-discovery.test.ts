import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runAutopilot } from '../src/commands/autopilot.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';

describe('runAutopilot discoveryMode=deep', () => {
  let cwd = '';
  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  });

  it('routes Phase B through deep discovery; existing tests unaffected when omitted', async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'deep-mode-'));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd });
    await writeFile(path.join(cwd, 'package.json'), '{"name":"x"}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app/page.tsx'), 'export default () => <button>X</button>');
    execSync('git add . && git commit -q -m init', { cwd });

    let callIdx = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          return {
            content: JSON.stringify([
              { id: 'btn-x', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return {
          content: JSON.stringify([
            { yaml: 'id: INV-DEEP\ntitle: t\nactions: []\nexpected: {}\n', confidence: 'high', module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' } },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const report = await runAutopilot({
      cwd,
      timeBudgetMs: 30_000,
      fix: false,  // skip Phase C to keep this test focused
      yes: true,
      regenerate: true,
      discoveryMode: 'deep',
      llmClient: llm,
    });

    // Should have written at least 1 contract via deep flow
    const written = await readFile(path.join(cwd, 'qa/contracts/app/INV-DEEP.yml'), 'utf8').catch(() => '');
    expect(written).toContain('id: INV-DEEP');
    expect(report.phaseB?.generated).toBeGreaterThan(0);
  }, 30_000);

  it('throws on invalid discoveryMode value', async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'deep-mode-invalid-'));
    await writeFile(path.join(cwd, 'package.json'), '{"name":"x"}');
    execSync('git init -q && git add . && git -c user.email=t@t.t -c user.name=t commit -q -m init', { cwd, shell: '/bin/bash' });

    const llm: LLMClient = {
      providerName: 'anthropic-sdk', modelHint: 'test',
      generate: vi.fn(async () => ({ content: '[]', usage: { inputTokens: 0, outputTokens: 0 } })),
    };

    await expect(
      runAutopilot({
        cwd,
        timeBudgetMs: 30_000,
        fix: false,
        yes: true,
        regenerate: true,
        discoveryMode: 'depe' as 'modules' | 'deep',  // intentional typo
        llmClient: llm,
      }),
    ).rejects.toThrow(/Invalid discoveryMode/);
  }, 15_000);
});
