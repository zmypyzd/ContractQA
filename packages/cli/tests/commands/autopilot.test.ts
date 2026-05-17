// packages/cli/tests/commands/autopilot.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runAutopilot } from '../../src/commands/autopilot.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cqa-autopilot-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: tmp });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0' } }));
  mkdirSync(join(tmp, 'app'));
  execSync('git add . && git commit -q -m init', { cwd: tmp });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function emptyLLM(): LLMClient {
  return {
    providerName: 'openai-compatible',
    modelHint: 'fake',
    async generate() { return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } }; },
  };
}

describe('runAutopilot', () => {
  it('completes Phase A even when LLM returns empty discovery', async () => {
    const r = await runAutopilot({
      cwd: tmp,
      llmClient: emptyLLM(),
      timeBudgetMs: 60_000,
      fix: false,
      yes: true,
    });
    expect(r.phaseA).toBeDefined();
    expect(r.phaseB.generated).toBe(0);
    expect(existsSync(join(tmp, 'qa/contracts/_smoke'))).toBe(true);
  });

  it('writes AUTOPILOT_REPORT.md', async () => {
    await runAutopilot({
      cwd: tmp,
      llmClient: emptyLLM(),
      timeBudgetMs: 60_000,
      fix: false,
      yes: true,
    });
    expect(existsSync(join(tmp, 'qa/AUTOPILOT_REPORT.md'))).toBe(true);
  });

  it('triggers time-budget when ms is very short', async () => {
    const slowLLM: LLMClient = {
      providerName: 'openai-compatible',
      modelHint: 'fake',
      async generate({ signal }) {
        await new Promise((res, rej) => {
          const t = setTimeout(res, 1000);
          signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
        });
        return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    const r = await runAutopilot({
      cwd: tmp,
      llmClient: slowLLM,
      timeBudgetMs: 50, // very short
      fix: false,
      yes: true,
    });
    expect(r.budgetTriggered).toBe('time-budget');
  });
});
