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

  it('honours abort signal', async () => {
    const { ClaudeAgentSDKClient } = await import('../../src/llm/claude-agent-sdk-client.js');
    const c = new ClaudeAgentSDKClient();
    const ac = new AbortController();
    ac.abort();
    await expect(c.generate({ messages: [{ role: 'user', content: 'Hi' }], signal: ac.signal }))
      .rejects.toThrow(/abort/i);
  });
});
