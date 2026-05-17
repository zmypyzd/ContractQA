/**
 * C3: Tests for LLMClient injection in runClaudeFix.
 * The existing spawn-based tests (claude-code.test.ts) continue to pass unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeFix } from '../src/claude-code.js';
import type { LLMClient } from '../src/llm/index.js';

function mockLLMClient(content: string): LLMClient {
  return {
    providerName: 'openai-compatible',
    modelHint: 'test-model',
    generate: vi.fn().mockResolvedValue({
      content,
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
  };
}

describe('runClaudeFix with LLMClient injection', () => {
  it('uses llmClient.generate() instead of spawn when llmClient is provided', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-cc-llm-'));
    try {
      const promptPath = join(tmp, 'prompt.md');
      writeFileSync(promptPath, 'Fix the failing test.\n');

      const response = JSON.stringify({
        root_cause: 'missing null check',
        files_changed: ['src/auth.ts'],
        tests_run: ['repro'],
        validation_result: 'PASS',
      });

      const llmClient = mockLLMClient(response);

      const r = await runClaudeFix({
        promptPath,
        cwd: tmp,
        allowedTools: ['Read', 'Edit', 'Bash'],
        llmClient,
      });

      expect(llmClient.generate).toHaveBeenCalledOnce();
      const callArgs = (llmClient.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // System message should be present
      expect(callArgs.system).toBeTruthy();
      // User message content should contain the prompt text
      expect(callArgs.messages[0].role).toBe('user');
      expect(callArgs.messages[0].content).toContain('Fix the failing test.');

      expect(r.validation_result).toBe('PASS');
      expect(r.root_cause).toBe('missing null check');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns PARSE_ERROR when LLMClient returns non-JSON', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-cc-llm-'));
    try {
      const promptPath = join(tmp, 'prompt.md');
      writeFileSync(promptPath, 'Fix the test.\n');

      const llmClient = mockLLMClient('not json at all');

      const r = await runClaudeFix({
        promptPath,
        cwd: tmp,
        allowedTools: ['Read'],
        llmClient,
      });

      expect(r.validation_result).toBe('PARSE_ERROR');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns FAIL when LLMClient throws', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-cc-llm-'));
    try {
      const promptPath = join(tmp, 'prompt.md');
      writeFileSync(promptPath, 'Fix the test.\n');

      const llmClient: LLMClient = {
        providerName: 'anthropic-sdk',
        modelHint: 'test',
        generate: vi.fn().mockRejectedValue(new Error('LLM transport error')),
      };

      const r = await runClaudeFix({
        promptPath,
        cwd: tmp,
        allowedTools: ['Read'],
        llmClient,
      });

      expect(r.validation_result).toBe('FAIL');
      expect(r.raw_stdout).toContain('LLM transport error');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('passes AbortSignal to llmClient.generate() when signal is provided', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cqa-cc-llm-'));
    try {
      const promptPath = join(tmp, 'prompt.md');
      writeFileSync(promptPath, 'Fix the test.\n');

      const llmClient = mockLLMClient(JSON.stringify({ validation_result: 'PASS', raw_stdout: '' }));
      const controller = new AbortController();

      await runClaudeFix({
        promptPath,
        cwd: tmp,
        allowedTools: ['Read'],
        llmClient,
        signal: controller.signal,
      });

      const callArgs = (llmClient.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.signal).toBe(controller.signal);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
