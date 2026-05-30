// packages/orchestrator/src/llm/claude-agent-sdk-client.ts
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { LLMTransportError, type LLMClient, type GenerateOptions, type GenerateResult } from './index.js';

// Resolve the LOCALLY INSTALLED Claude Code executable so the SDK spawns it
// instead of its own bundled `cli.js`.
//
// WHY (2026-05-30 root-cause, supersedes the Entry 7 "harness 403" theory):
// `@anthropic-ai/claude-agent-sdk@0.1.77` ships an 11 MB bundled `cli.js`
// (frozen ~May 17) and spawns IT by default (sdk.mjs: pathToClaudeCodeExecutable
// defaults to join(__dirname,'cli.js')). That OLDER client gets
//   API Error: 403 {"type":"forbidden","message":"Request not allowed"} · Please run /login
// under OAuth subscription auth — EVEN with minimal options (harness OFF). The
// locally installed `claude` (e.g. v2.1.158, a native binary) does NOT 403.
// Proven by A/B: same network (US exit IP), same flags — bundled cli.js → 403,
// installed binary via pathToClaudeCodeExecutable → success. So the blocker was
// never credits, the account, the network, or the repo harness; it was which
// executable the SDK launches.
//
// Resolution order: CONTRACTQA_CLAUDE_EXECUTABLE env → `command -v claude` →
// undefined (let the SDK fall back to its bundled cli.js, preserving old
// behavior when no local install exists, e.g. CI without Claude Code).
function resolveInstalledClaude(): string | undefined {
  const override = process.env.CONTRACTQA_CLAUDE_EXECUTABLE?.trim();
  if (override) return existsSync(override) ? override : undefined;
  try {
    const p = execSync('command -v claude', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (p && existsSync(p)) return p;
  } catch {
    // `claude` not on PATH — fall through to bundled cli.js.
  }
  return undefined;
}

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
  // Whether to wrap the inner Claude Code agent in the cwd / systemPrompt /
  // disallowedTools / maxTurns harness. Default **off** as of 2026-05-28
  // (commit reverting Entry 4 default): the harness's option-bag triggers
  // a server-side 403 ("Request not allowed") under OAuth subscription
  // auth, breaking ALL discovery calls including Haiku (Entry 7 bisect in
  // qa/eval/tuning-log.md). Pre-Entry-4 behavior (no harness) was 10/10
  // working with Haiku in Entry 3 and is restored here.
  //
  // The harness exists for Sonnet — without it Sonnet enters a 69-tool-call
  // loop and times out at 240s+ (docs/SONNET_SDK_HARNESS_INVESTIGATION.md).
  // For Sonnet under API-key auth (where 403 doesn't apply), opt back in
  // via CONTRACTQA_ENABLE_SDK_HARNESS=1 or `enableHarness: true`.
  private readonly harnessEnabled: boolean;
  // Path to the locally installed `claude` binary, or undefined to use the
  // SDK's bundled cli.js. Resolved once per client; see resolveInstalledClaude.
  private readonly claudeExecutable: string | undefined;

  constructor(opts: { model?: string; enableHarness?: boolean; disableHarness?: boolean } = {}) {
    // Match AnthropicSDKClient's env contract — same var works for both
    // client paths so tuning experiments are reproducible regardless of
    // which provider pickClient lands on.
    this.model = opts.model ?? process.env.CONTRACTQA_LLM_MODEL ?? undefined;
    this.modelHint = this.model ?? 'claude-code-managed';
    this.isolatedCwd = mkdtempSync(path.join(tmpdir(), 'cqa-llm-'));
    // enableHarness ctor opt wins; then CONTRACTQA_ENABLE_SDK_HARNESS=1 env;
    // legacy disableHarness:true ctor opt forces off (kept for tests);
    // legacy CONTRACTQA_DISABLE_SDK_HARNESS=1 env also forces off; default off.
    if (opts.enableHarness === true) this.harnessEnabled = true;
    else if (opts.disableHarness === true) this.harnessEnabled = false;
    else if (process.env.CONTRACTQA_ENABLE_SDK_HARNESS === '1') this.harnessEnabled = true;
    else if (process.env.CONTRACTQA_DISABLE_SDK_HARNESS === '1') this.harnessEnabled = false;
    else this.harnessEnabled = false;
    this.claudeExecutable = resolveInstalledClaude();
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
      //
      // BUT: these same options trigger 403 under OAuth subscription auth
      // (Entry 7 bisect, tuning-log.md). Under ANTHROPIC_API_KEY billing the
      // 403 should not apply and the harness works again. And with
      // harnessDisabled, we drop the harness to let the inner agent use its
      // full Claude Code scaffolding — the A/B comparison Arm C.
      const sdkOptions: Parameters<typeof query>[0]['options'] = this.harnessEnabled
        ? {
            permissionMode: 'bypassPermissions',
            cwd: this.isolatedCwd,
            systemPrompt: STATELESS_SYSTEM_PROMPT,
            disallowedTools: STATELESS_DISALLOWED_TOOLS,
            maxTurns: 1,
          }
        : {
            permissionMode: 'bypassPermissions',
          };
      if (this.model) sdkOptions.model = this.model;
      // Spawn the locally installed claude (not the SDK's bundled, 403-prone
      // cli.js) when available. See resolveInstalledClaude for the why.
      if (this.claudeExecutable) sdkOptions.pathToClaudeCodeExecutable = this.claudeExecutable;
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
