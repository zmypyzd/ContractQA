// packages/orchestrator/src/llm/anthropic-sdk-client.ts
import Anthropic from '@anthropic-ai/sdk';
import { LLMTransportError, type LLMClient, type GenerateOptions, type GenerateResult } from './index.js';

export class AnthropicSDKClient implements LLMClient {
  readonly providerName = 'anthropic-sdk' as const;
  readonly modelHint: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('AnthropicSDKClient requires ANTHROPIC_API_KEY or opts.apiKey.');
    this.client = new Anthropic({ apiKey });
    this.modelHint = opts.model ?? process.env.CONTRACTQA_LLM_MODEL ?? 'claude-sonnet-4-6';
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    try {
      const resp = await this.client.messages.create(
        {
          model: this.modelHint,
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.2,
          system: opts.system,
          messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        opts.signal ? { signal: opts.signal } : undefined,
      );
      const textBlocks = (resp.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '');
      return {
        content: textBlocks.join(''),
        usage: {
          inputTokens: resp.usage?.input_tokens ?? 0,
          outputTokens: resp.usage?.output_tokens ?? 0,
        },
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new LLMTransportError(`Anthropic call failed: ${(err as Error).message}`, {
        provider: 'anthropic-sdk',
        statusCode: status,
        cause: err,
      });
    }
  }
}
