// packages/orchestrator/tests/llm/pick-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all three LLM SDKs so pick-client tests run without real SDK installs
vi.mock('openai', () => ({ default: class FakeOpenAI { constructor() {} } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class FakeAnthropic { constructor() {} } }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

const ORIG_ENV = { ...process.env };

function clearEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CONTRACTQA_FORCE_SDK_CLIENT;
}

describe('pickClient', () => {
  beforeEach(() => clearEnv());
  afterEach(() => { process.env = { ...ORIG_ENV }; });

  it('returns OpenAICompatibleClient when OPENAI_API_KEY set', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({ resolveSdk: () => true });
    expect(c.providerName).toBe('openai-compatible');
  });

  it('returns AnthropicSDKClient when only ANTHROPIC_API_KEY set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({ resolveSdk: () => true });
    expect(c.providerName).toBe('anthropic-sdk');
  });

  it('falls back to ClaudeAgentSDKClient when no env keys but SDK + creds resolve', async () => {
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

  it('CONTRACTQA_FORCE_SDK_CLIENT=claude-agent forces ClaudeAgentSDKClient even when ANTHROPIC_API_KEY set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
    process.env.CONTRACTQA_FORCE_SDK_CLIENT = 'claude-agent';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({
      resolveSdk: (name) => name === '@anthropic-ai/claude-agent-sdk',
      claudeAgentCredsExist: () => false, // does NOT need creds — forced
    });
    expect(c.providerName).toBe('claude-agent-sdk');
  });

  it('CONTRACTQA_FORCE_SDK_CLIENT=anthropic requires ANTHROPIC_API_KEY', async () => {
    process.env.CONTRACTQA_FORCE_SDK_CLIENT = 'anthropic';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    await expect(pickClient({ resolveSdk: () => true }))
      .rejects.toThrow(/CONTRACTQA_FORCE_SDK_CLIENT=anthropic requires ANTHROPIC_API_KEY/);
  });

  it('CONTRACTQA_FORCE_SDK_CLIENT=anthropic with key returns AnthropicSDKClient', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
    process.env.CONTRACTQA_FORCE_SDK_CLIENT = 'anthropic';
    const { pickClient } = await import('../../src/llm/pick-client.js');
    const c = await pickClient({ resolveSdk: () => true });
    expect(c.providerName).toBe('anthropic-sdk');
  });
});
