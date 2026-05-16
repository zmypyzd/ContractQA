// packages/orchestrator/src/llm/pick-client.ts
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LLMConfigError, type LLMClient, type ProviderName } from './index.js';

export interface PickClientOptions {
  /** Override for tests: resolve(name) returns true if the named SDK is installed. */
  resolveSdk?: (name: string) => boolean;
  /** Override for tests: returns true if Claude Code credentials exist locally. */
  claudeAgentCredsExist?: () => boolean;
}

function defaultResolveSdk(name: string): boolean {
  try {
    createRequire(import.meta.url).resolve(name);
    return true;
  } catch {
    return false;
  }
}

function defaultClaudeAgentCredsExist(): boolean {
  return existsSync(join(homedir(), '.claude', 'credentials.json')) ||
         existsSync(join(homedir(), '.config', 'claude-code', 'credentials.json'));
}

export async function pickClient(opts: PickClientOptions = {}): Promise<LLMClient> {
  const resolveSdk = opts.resolveSdk ?? defaultResolveSdk;
  const credsExist = opts.claudeAgentCredsExist ?? defaultClaudeAgentCredsExist;
  const tried: ProviderName[] = [];

  if (process.env.OPENAI_API_KEY) {
    tried.push('openai-compatible');
    if (!resolveSdk('openai')) {
      throw new LLMConfigError(
        'OPENAI_API_KEY is set but the `openai` SDK is not installed. Run `npm install openai`.',
        { tried },
      );
    }
    const { OpenAICompatibleClient } = await import('./openai-compatible-client.js');
    return new OpenAICompatibleClient();
  }

  if (process.env.ANTHROPIC_API_KEY) {
    tried.push('anthropic-sdk');
    if (!resolveSdk('@anthropic-ai/sdk')) {
      throw new LLMConfigError(
        'ANTHROPIC_API_KEY is set but `@anthropic-ai/sdk` is not installed. Run `npm install @anthropic-ai/sdk`.',
        { tried },
      );
    }
    const { AnthropicSDKClient } = await import('./anthropic-sdk-client.js');
    return new AnthropicSDKClient();
  }

  tried.push('claude-agent-sdk');
  if (resolveSdk('@anthropic-ai/claude-agent-sdk') && credsExist()) {
    const { ClaudeAgentSDKClient } = await import('./claude-agent-sdk-client.js');
    return new ClaudeAgentSDKClient();
  }

  throw new LLMConfigError(
    'No LLM client available. Configure ONE of:\n' +
      '  1. export OPENAI_API_KEY=...  (and optionally OPENAI_BASE_URL for MiniMax/DeepSeek/OpenRouter)\n' +
      '  2. export ANTHROPIC_API_KEY=...\n' +
      '  3. install Claude Code (https://claude.ai/code) and log in\n',
    { tried },
  );
}
