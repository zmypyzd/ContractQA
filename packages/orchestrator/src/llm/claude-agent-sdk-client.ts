// packages/orchestrator/src/llm/claude-agent-sdk-client.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { LLMTransportError, type LLMClient, type GenerateOptions, type GenerateResult } from './index.js';

export class ClaudeAgentSDKClient implements LLMClient {
  readonly providerName = 'claude-agent-sdk' as const;
  readonly modelHint: string;
  private readonly model: string | undefined;

  constructor(opts: { model?: string } = {}) {
    // Match AnthropicSDKClient's env contract — same var works for both
    // client paths so tuning experiments are reproducible regardless of
    // which provider pickClient lands on.
    this.model = opts.model ?? process.env.CONTRACTQA_LLM_MODEL ?? undefined;
    this.modelHint = this.model ?? 'claude-code-managed';
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    if (opts.signal?.aborted) throw new Error('aborted before start');

    // Compose a single prompt from system + messages (Claude Agent SDK takes one prompt string).
    const promptParts: string[] = [];
    if (opts.system) promptParts.push(`SYSTEM:\n${opts.system}`);
    for (const m of opts.messages) {
      promptParts.push(`${m.role.toUpperCase()}:\n${m.content}`);
    }
    const prompt = promptParts.join('\n\n');

    let content = '';
    try {
      // The SDK `options.model` accepts the same model IDs as the Anthropic
      // SDK (e.g. 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'). When
      // unset, Claude Code's CLI default applies — usually the model your
      // current Claude Code session is on.
      const sdkOptions: Parameters<typeof query>[0]['options'] = {
        permissionMode: 'bypassPermissions',
      };
      if (this.model) sdkOptions.model = this.model;
      for await (const msg of query({ prompt, options: sdkOptions })) {
        if (opts.signal?.aborted) throw new Error('aborted mid-stream');
        // Claude Agent SDK emits various message types; concatenate text 'result' frames.
        const r = msg as { type?: string; result?: string; text?: string };
        if (r.type === 'result' && typeof r.result === 'string') content += r.result;
        else if (typeof r.text === 'string') content += r.text;
      }
    } catch (err) {
      // Don't wrap abort signals — they're not transport failures.
      if (err instanceof Error && /abort/i.test(err.message)) throw err;
      throw new LLMTransportError(`Claude Agent SDK call failed: ${(err as Error).message}`, {
        provider: 'claude-agent-sdk',
        cause: err,
      });
    }

    // Usage is not exposed by the SDK in the same way; report zeros.
    return { content, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
