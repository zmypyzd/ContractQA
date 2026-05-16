// packages/orchestrator/tests/llm/types.test.ts
import { describe, it, expect } from 'vitest';
import { LLMConfigError, type LLMClient, type GenerateOptions, type GenerateResult } from '../../src/llm/index.js';

describe('llm/index types', () => {
  it('exports LLMConfigError with structured fields', () => {
    const err = new LLMConfigError('no client available', { tried: ['openai-compatible', 'anthropic-sdk', 'claude-agent-sdk'] });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LLMConfigError');
    expect(err.tried).toEqual(['openai-compatible', 'anthropic-sdk', 'claude-agent-sdk']);
  });

  it('LLMClient shape is callable as documented', async () => {
    const fake: LLMClient = {
      providerName: 'openai-compatible',
      modelHint: 'fake-model',
      async generate(_opts: GenerateOptions): Promise<GenerateResult> {
        return { content: 'hi', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const r = await fake.generate({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.content).toBe('hi');
  });
});
