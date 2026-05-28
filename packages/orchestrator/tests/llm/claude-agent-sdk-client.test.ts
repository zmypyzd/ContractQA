// packages/orchestrator/tests/llm/claude-agent-sdk-client.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* () {
    yield { type: 'result', result: 'mock claude agent content' };
  }),
}));

describe('ClaudeAgentSDKClient', () => {
  it('streams query() result into a single content string', async () => {
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const c = new ClaudeAgentSDKClient();
    const r = await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(r.content).toBe('mock claude agent content');
  });

  it('returns providerName claude-agent-sdk', async () => {
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const c = new ClaudeAgentSDKClient();
    expect(c.providerName).toBe('claude-agent-sdk');
  });

  it('honours abort signal (pre-start)', async () => {
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const c = new ClaudeAgentSDKClient();
    const ac = new AbortController();
    ac.abort();
    await expect(c.generate({ messages: [{ role: 'user', content: 'Hi' }], signal: ac.signal }))
      .rejects.toThrow(/abort/i);
  });

  it('default (no harness) passes only permissionMode + model — restores pre-Entry-4 behavior', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    vi.mocked(query).mockImplementationOnce(async function* () {
      yield { type: 'result', result: 'ok' };
    });
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const c = new ClaudeAgentSDKClient(); // default: harness off
    await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    const call = vi.mocked(query).mock.calls[vi.mocked(query).mock.calls.length - 1]!;
    const opts = call[0].options!;
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.cwd).toBeUndefined();
    expect(opts.systemPrompt).toBeUndefined();
    expect(opts.disallowedTools).toBeUndefined();
    expect(opts.maxTurns).toBeUndefined();
  });

  it('enableHarness:true ctor opt re-enables the cwd+systemPrompt+disallowedTools+maxTurns harness', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    vi.mocked(query).mockImplementationOnce(async function* () {
      yield { type: 'result', result: 'ok' };
    });
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const c = new ClaudeAgentSDKClient({ enableHarness: true });
    await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    const call = vi.mocked(query).mock.calls[vi.mocked(query).mock.calls.length - 1]!;
    const opts = call[0].options!;
    expect(opts.cwd).toBeTruthy();
    expect(opts.systemPrompt).toBeTruthy();
    expect(opts.disallowedTools).toBeTruthy();
    expect(opts.maxTurns).toBe(1);
  });

  it('CONTRACTQA_ENABLE_SDK_HARNESS=1 env enables harness', async () => {
    const prev = process.env.CONTRACTQA_ENABLE_SDK_HARNESS;
    process.env.CONTRACTQA_ENABLE_SDK_HARNESS = '1';
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      vi.mocked(query).mockImplementationOnce(async function* () {
        yield { type: 'result', result: 'ok' };
      });
      const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
      const c = new ClaudeAgentSDKClient();
      await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
      const call = vi.mocked(query).mock.calls[vi.mocked(query).mock.calls.length - 1]!;
      const opts = call[0].options!;
      expect(opts.cwd).toBeTruthy();
      expect(opts.disallowedTools).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.CONTRACTQA_ENABLE_SDK_HARNESS;
      else process.env.CONTRACTQA_ENABLE_SDK_HARNESS = prev;
    }
  });

  it('legacy CONTRACTQA_DISABLE_SDK_HARNESS=1 still forces harness off (backward compat)', async () => {
    const prev = process.env.CONTRACTQA_DISABLE_SDK_HARNESS;
    process.env.CONTRACTQA_DISABLE_SDK_HARNESS = '1';
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      vi.mocked(query).mockImplementationOnce(async function* () {
        yield { type: 'result', result: 'ok' };
      });
      const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
      const c = new ClaudeAgentSDKClient();
      await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
      const call = vi.mocked(query).mock.calls[vi.mocked(query).mock.calls.length - 1]!;
      const opts = call[0].options!;
      expect(opts.cwd).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CONTRACTQA_DISABLE_SDK_HARNESS;
      else process.env.CONTRACTQA_DISABLE_SDK_HARNESS = prev;
    }
  });

  it('mid-stream abort is NOT wrapped as LLMTransportError', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const ac = new AbortController();
    // Override mock: yields one item then the abort fires on next iteration check
    vi.mocked(query).mockImplementationOnce(async function* () {
      yield { type: 'result', result: 'partial' };
      // Abort is already set by the time the loop checks signal on the next iteration
    });
    // We abort after the first yield by abusing signal already set
    ac.abort();
    // The client checks signal inside the loop after each yield — with signal pre-aborted
    // and two items, it will throw 'aborted mid-stream' (not LLMTransportError).
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const { LLMTransportError } = await import('../../src/llm/index.js');
    const c = new ClaudeAgentSDKClient();
    // pre-aborted signal: the pre-start check fires, which also throws a plain Error not LLMTransportError
    vi.mocked(query).mockImplementationOnce(async function* () {
      yield { type: 'result', result: 'partial' };
    });
    const ac2 = new AbortController();
    // Abort mid-stream: set abort after a tick so it fires inside the loop
    const generatePromise = c.generate({ messages: [{ role: 'user', content: 'Hi' }], signal: ac2.signal });
    ac2.abort();
    const err = await generatePromise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LLMTransportError);
    expect((err as Error).message).toMatch(/abort/i);
  });
});
