// packages/orchestrator/tests/llm/anthropic-sdk-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'mock anthropic content' }],
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    };
    static lastArgs: unknown;
    constructor(args: unknown) { (FakeAnthropic as any).lastArgs = args; }
  },
}));

describe('AnthropicSDKClient', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; });

  it('forwards api key and constructs', async () => {
    const { AnthropicSDKClient } = await import('../../src/llm/anthropic-sdk-client.js');
    new AnthropicSDKClient();
    const FakeAnthropic = (await import('@anthropic-ai/sdk')).default as any;
    expect(FakeAnthropic.lastArgs).toMatchObject({ apiKey: 'sk-ant-test' });
  });

  it('maps GenerateOptions to messages.create shape', async () => {
    const { AnthropicSDKClient } = await import('../../src/llm/anthropic-sdk-client.js');
    const c = new AnthropicSDKClient();
    const r = await c.generate({
      system: 'You are a QA engineer.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 1000,
    });
    expect(r.content).toBe('mock anthropic content');
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });

  it('uses CONTRACTQA_LLM_MODEL or default model hint', async () => {
    process.env.CONTRACTQA_LLM_MODEL = 'claude-sonnet-4-6';
    const { AnthropicSDKClient } = await import('../../src/llm/anthropic-sdk-client.js?model-test');
    const c = new AnthropicSDKClient();
    expect(c.modelHint).toBe('claude-sonnet-4-6');
    delete process.env.CONTRACTQA_LLM_MODEL;
  });
});
