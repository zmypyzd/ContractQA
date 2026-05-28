// packages/orchestrator/src/llm/claude-agent-sdk-client.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { LLMTransportError, type LLMClient, type GenerateOptions, type GenerateResult } from './index.js';

// Tools the inner agent should NEVER reach for during a stateless JSON
// generation. Sonnet without these constraints enters Read/Bash/Glob/Task
// loops and times out at 240s+ (see docs SONNET_SDK_HARNESS_INVESTIGATION.md
// 2026-05-28 probes). Haiku also calls tools but ~6× less and converges
// before timeout — fix benefits both models.
//
// We DON'T disallow MCP tools by name (would need full registry walk);
// maxTurns: 1 + this list + minimal systemPrompt makes tool use unreachable
// in practice.
const STATELESS_DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep', 'Task', 'Agent',
  'WebFetch', 'WebSearch',
];

// Replaces CC's "you are Claude Code…" preamble with a focused JSON-only
// directive. Stops the inner agent from thinking it's expected to do
// software engineering work.
const STATELESS_SYSTEM_PROMPT =
  'You are a JSON-output assistant invoked by an automated pipeline. ' +
  'Read the user message, follow its instructions, and respond with the ' +
  'requested content directly. Do not use tools. Do not spawn subagents. ' +
  'Do not analyze the project. Respond in one turn with the final answer.';

export class ClaudeAgentSDKClient implements LLMClient {
  readonly providerName = 'claude-agent-sdk' as const;
  readonly modelHint: string;
  private readonly model: string | undefined;
  // One isolated working dir per client instance — keeps inner agent away
  // from the calling repo's CLAUDE.md / MEMORY.md / hooks / skill metadata
  // so it doesn't auto-load 100+ skill descriptions on every call.
  private readonly isolatedCwd: string;

  constructor(opts: { model?: string } = {}) {
    // Match AnthropicSDKClient's env contract — same var works for both
    // client paths so tuning experiments are reproducible regardless of
    // which provider pickClient lands on.
    this.model = opts.model ?? process.env.CONTRACTQA_LLM_MODEL ?? undefined;
    this.modelHint = this.model ?? 'claude-code-managed';
    this.isolatedCwd = mkdtempSync(path.join(tmpdir(), 'cqa-llm-'));
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
      // Harness constraints (2026-05-28 fix per docs/SONNET_SDK_HARNESS_INVESTIGATION.md):
      //   - cwd: tmp dir → no CLAUDE.md / hooks / skill autoload from caller repo
      //   - systemPrompt: minimal JSON-only → no CC "I'm Claude Code" agentic preamble
      //   - disallowedTools: blocks Read/Bash/Task/etc → no file probing or subagent spawn
      //   - maxTurns: 1 → forbids multi-turn loops even if a tool somehow got through
      // Without these, Sonnet+discovery-prompt enters a 69-tool-call / 240s+ loop.
      const sdkOptions: Parameters<typeof query>[0]['options'] = {
        permissionMode: 'bypassPermissions',
        cwd: this.isolatedCwd,
        systemPrompt: STATELESS_SYSTEM_PROMPT,
        disallowedTools: STATELESS_DISALLOWED_TOOLS,
        maxTurns: 1,
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
