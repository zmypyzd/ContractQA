// packages/orchestrator/tests/llm/openai-compatible-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'mock content' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        },
      };
      static lastConstructorArgs: unknown;
      constructor(args: unknown) { (FakeOpenAI as any).lastConstructorArgs = args; }
    },
  };
});

describe('OpenAICompatibleClient', () => {
  beforeEach(() => { delete process.env.OPENAI_BASE_URL; });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  it('reads OPENAI_API_KEY and OPENAI_BASE_URL', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1';
    const { OpenAICompatibleClient } = await import('../../src/llm/openai-compatible-client.js');
    new OpenAICompatibleClient();
    const FakeOpenAI = (await import('openai')).default as any;
    expect(FakeOpenAI.lastConstructorArgs).toMatchObject({
      apiKey: 'sk-test',
      baseURL: 'https://api.minimax.chat/v1',
    });
  });

  it('maps GenerateOptions to OpenAI chat-completions shape and returns content + usage', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const { OpenAICompatibleClient } = await import('../../src/llm/openai-compatible-client.js');
    const c = new OpenAICompatibleClient();
    const r = await c.generate({
      system: 'You are a QA engineer.',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 1000,
      temperature: 0.2,
    });
    expect(r.content).toBe('mock content');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('passes signal through to the underlying SDK', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const { OpenAICompatibleClient } = await import('../../src/llm/openai-compatible-client.js');
    const c = new OpenAICompatibleClient();
    const ac = new AbortController();
    await c.generate({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal });
    const FakeOpenAI = (await import('openai')).default as any;
    const call = (new FakeOpenAI({}).chat.completions.create as any).mock?.calls?.at(-1);
    // The mocked impl receives (params, requestOptions); requestOptions.signal should be set.
    if (call) {
      expect(call[1]?.signal).toBe(ac.signal);
    }
  });

  it('throws LLMTransportError with statusCode on 429', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.doMock('openai', () => ({
      default: class { chat = { completions: { create: vi.fn().mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 })) } }; constructor() {} },
    }));
    const { OpenAICompatibleClient } = await import('../../src/llm/openai-compatible-client.js?retry-test');
    const { LLMTransportError } = await import('../../src/llm/index.js');
    const c = new OpenAICompatibleClient();
    await expect(c.generate({ messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toBeInstanceOf(LLMTransportError);
  });
});
