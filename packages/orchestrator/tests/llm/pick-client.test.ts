// packages/orchestrator/tests/llm/pick-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIG_ENV = { ...process.env };

function clearEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}

describe('pickClient', () => {
  beforeEach(() => clearEnv());
  afterEach(() => { process.env = { ...ORIG_ENV }; });

  it.skip('returns OpenAICompatibleClient when OPENAI_API_KEY set', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({ resolveSdk: () => true });
    expect(c.providerName).toBe('openai-compatible');
  });

  it.skip('returns AnthropicSDKClient when only ANTHROPIC_API_KEY set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({ resolveSdk: () => true });
    expect(c.providerName).toBe('anthropic-sdk');
  });

  it.skip('falls back to ClaudeAgentSDKClient when no env keys but SDK + creds resolve', async () => {
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({
      resolveSdk: (name) => name === '@anthropic-ai/claude-agent-sdk',
      claudeAgentCredsExist: () => true,
    });
    expect(c.providerName).toBe('claude-agent-sdk');
  });

  it('throws LLMConfigError listing all tried providers when nothing available', async () => {
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const { LLMConfigError } = await import('../../src/llm/index.js');
    await expect(pickClient({ resolveSdk: () => false, claudeAgentCredsExist: () => false }))
      .rejects.toBeInstanceOf(LLMConfigError);
  });

  it('OPENAI_API_KEY set but SDK missing → throws with install hint', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    await expect(pickClient({ resolveSdk: (name) => name !== 'openai' }))
      .rejects.toThrow(/npm install openai/);
  });
});
