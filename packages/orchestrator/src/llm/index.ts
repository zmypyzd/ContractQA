export type ProviderName = 'openai-compatible' | 'anthropic-sdk' | 'claude-agent-sdk';

export interface GenerateOptions {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** @experimental — subpath `@contractqa/orchestrator/llm` is not semver-stable. */
export interface LLMClient {
  readonly providerName: ProviderName;
  readonly modelHint: string;
  generate(opts: GenerateOptions): Promise<GenerateResult>;
}

export class LLMConfigError extends Error {
  readonly tried: readonly ProviderName[];
  constructor(message: string, opts: { tried: readonly ProviderName[] }) {
    super(message);
    this.name = 'LLMConfigError';
    this.tried = opts.tried;
  }
}

export class LLMTransportError extends Error {
  readonly provider: ProviderName;
  readonly statusCode?: number;
  constructor(message: string, opts: { provider: ProviderName; statusCode?: number; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = 'LLMTransportError';
    this.provider = opts.provider;
    this.statusCode = opts.statusCode;
  }
}

// pickClient re-exported in Task A2
// export { pickClient } from './pick-client.js';
