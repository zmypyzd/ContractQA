// packages/orchestrator/src/llm/openai-compatible-client.ts
import OpenAI from 'openai';
import { LLMTransportError, type LLMClient, type GenerateOptions, type GenerateResult } from './index.js';

export class OpenAICompatibleClient implements LLMClient {
  readonly providerName = 'openai-compatible' as const;
  readonly modelHint: string;
  private readonly client: OpenAI;

  constructor(opts: { apiKey?: string; baseURL?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAICompatibleClient requires OPENAI_API_KEY or opts.apiKey.');
    const baseURL = opts.baseURL ?? process.env.OPENAI_BASE_URL ?? undefined;
    this.client = new OpenAI({ apiKey, baseURL });
    this.modelHint = opts.model ?? process.env.CONTRACTQA_LLM_MODEL ?? 'gpt-4o-mini';
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    for (const m of opts.messages) messages.push(m);

    try {
      const resp = await this.client.chat.completions.create(
        {
          model: this.modelHint,
          messages,
          max_tokens: opts.maxTokens,
          temperature: opts.temperature ?? 0.2,
        },
        opts.signal ? { signal: opts.signal } : undefined,
      );
      const content = resp.choices[0]?.message?.content ?? '';
      return {
        content,
        usage: {
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new LLMTransportError(`OpenAI-compatible call failed: ${(err as Error).message}`, {
        provider: 'openai-compatible',
        statusCode: status,
        cause: err,
      });
    }
  }
}
