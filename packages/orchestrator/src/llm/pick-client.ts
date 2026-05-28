// packages/orchestrator/src/llm/pick-client.ts
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
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

/**
 * Decide whether Claude Code is installed AND likely authenticated on this
 * machine. Returning true means we'll hand off to the Claude Agent SDK at
 * runtime; if the SDK then can't auth, it'll surface its own error.
 *
 * Signals (any one is enough):
 *
 *   1. A credentials.json file at one of the historical CC paths. Older CC
 *      installs put OAuth tokens here; some Linux deployments still do.
 *   2. macOS Keychain item present. Modern CC on macOS stores tokens in the
 *      login keychain instead of a file, so the absence of credentials.json
 *      tells us nothing. We check `security find-generic-password` would have
 *      found something via the proxy signal "~/.claude/ has substantial CC
 *      state (daemon/, projects/, or todos/)".
 *   3. CC environment variables. CLAUDE_CODE_ENTRYPOINT is set when this
 *      process is itself a child of a CC session, which is a strong signal
 *      that CC is installed and the user is authenticated.
 *
 * This is permissive on purpose. A false positive (we say "yes" but the SDK
 * can't auth) is recoverable: the SDK throws and the caller gets a clear
 * error. A false negative (we say "no" but the user actually has CC working)
 * is worse — they see "No LLM client available" and don't know why.
 */
function defaultClaudeAgentCredsExist(): boolean {
  const home = homedir();

  // Signal 1: file at one of the documented paths.
  const credsFiles = [
    join(home, '.claude', 'credentials.json'),
    join(home, '.config', 'claude-code', 'credentials.json'),
    join(home, 'Library', 'Application Support', 'Claude', 'credentials.json'),
  ];
  for (const p of credsFiles) {
    if (existsSync(p)) return true;
  }

  // Signal 2: macOS keychain proxy — look for CC's local state directory and
  // any of its working subdirectories. CC creates these on first run, well
  // before auth completes, so their presence doesn't *prove* auth; we still
  // hand off to the SDK to make the real call.
  if (platform() === 'darwin') {
    const claudeDir = join(home, '.claude');
    if (existsSync(claudeDir)) {
      try {
        const entries = readdirSync(claudeDir);
        const ccMarkers = ['daemon', 'projects', 'todos', 'sessions', 'cache'];
        if (entries.some((e) => ccMarkers.includes(e))) return true;
      } catch {
        // .claude exists but unreadable; treat as unknown.
      }
    }
  }

  // Signal 3: running inside a CC session right now.
  if (process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDECODE === '1') {
    return true;
  }

  return false;
}

export async function pickClient(opts: PickClientOptions = {}): Promise<LLMClient> {
  const resolveSdk = opts.resolveSdk ?? defaultResolveSdk;
  const credsExist = opts.claudeAgentCredsExist ?? defaultClaudeAgentCredsExist;
  const tried: ProviderName[] = [];

  // Experimental override for the harness-vs-no-harness A/B (Entry 8 plan,
  // tuning-log.md). Default routing is unchanged; this env flag only fires
  // when explicitly set.
  //
  //   CONTRACTQA_FORCE_SDK_CLIENT=claude-agent → force ClaudeAgentSDKClient
  //     even when ANTHROPIC_API_KEY is set, so we can compare:
  //       - AnthropicSDKClient (direct messages.create, no tools)
  //       - ClaudeAgentSDKClient + harness (current default, stateless JSON)
  //       - ClaudeAgentSDKClient + CONTRACTQA_DISABLE_SDK_HARNESS=1
  //         (full Claude Code agentic search via Read/Grep/Glob/Task)
  //   CONTRACTQA_FORCE_SDK_CLIENT=anthropic → force AnthropicSDKClient
  //     (mostly defensive; equivalent to setting ANTHROPIC_API_KEY alone)
  const forceClient = process.env.CONTRACTQA_FORCE_SDK_CLIENT;
  if (forceClient === 'claude-agent') {
    tried.push('claude-agent-sdk');
    if (!resolveSdk('@anthropic-ai/claude-agent-sdk')) {
      throw new LLMConfigError(
        'CONTRACTQA_FORCE_SDK_CLIENT=claude-agent but `@anthropic-ai/claude-agent-sdk` is not installed.',
        { tried },
      );
    }
    const { ClaudeAgentSDKClient } = await import('./claude-agent-sdk-client.js');
    return new ClaudeAgentSDKClient();
  }
  if (forceClient === 'anthropic') {
    tried.push('anthropic-sdk');
    if (!resolveSdk('@anthropic-ai/sdk')) {
      throw new LLMConfigError(
        'CONTRACTQA_FORCE_SDK_CLIENT=anthropic but `@anthropic-ai/sdk` is not installed.',
        { tried },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new LLMConfigError(
        'CONTRACTQA_FORCE_SDK_CLIENT=anthropic requires ANTHROPIC_API_KEY to be set.',
        { tried },
      );
    }
    const { AnthropicSDKClient } = await import('./anthropic-sdk-client.js');
    return new AnthropicSDKClient();
  }

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
