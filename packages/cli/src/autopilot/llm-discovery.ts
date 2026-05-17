// packages/cli/src/autopilot/llm-discovery.ts
import { z } from 'zod';
import type { LLMClient } from '@contractqa/orchestrator/llm';
import type { TargetContext } from './bootstrap.js';

export interface UncertainQuestion {
  text: string;
  type: 'yes-no' | 'multiple-choice';
  choices?: string[];
  defaultAnswer: string;
  appliesTo: 'whole-contract' | { jsonPath: string };
}

export interface ContractProposal {
  yaml: string;
  confidence: 'high' | 'medium' | 'low';
  module: string;
  uncertainQuestions?: UncertainQuestion[];
  evidence: { sourceFiles: string[]; rationale: string };
}

const ProposalSchema = z.object({
  yaml: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  module: z.string(),
  uncertainQuestions: z.array(z.object({
    text: z.string(),
    type: z.enum(['yes-no', 'multiple-choice']),
    choices: z.array(z.string()).optional(),
    defaultAnswer: z.string(),
    appliesTo: z.union([z.literal('whole-contract'), z.object({ jsonPath: z.string() })]),
  })).optional(),
  evidence: z.object({ sourceFiles: z.array(z.string()), rationale: z.string() }),
});

const ProposalsSchema = z.array(ProposalSchema);

export const DISCOVERY_PROMPT_VERSION = '1';

function buildSystemPrompt(ctx: TargetContext): string {
  return [
    'You are an expert QA engineer reading source code to infer product invariants.',
    'Output strictly a JSON array of ContractProposal objects. No prose, no markdown fences.',
    '',
    'Context:',
    `- Framework: ${ctx.framework}`,
    `- Auth provider: ${ctx.authProvider}`,
    `- Entry routes: ${ctx.routes.join(', ') || '(unknown)'}`,
    '',
    'Confidence rubric:',
    '- high: invariant directly evidenced by code (e.g., explicit redirect after logout); no ambiguity.',
    '- medium: invariant implied by patterns; one decision point needs user confirmation via uncertainQuestions.',
    '- low: invariant requires guessing intent; only emit if asking a clear yes/no clarifies it.',
    '',
    'For confidence != "high", emit at least one uncertainQuestions entry with a defaultAnswer.',
  ].join('\n');
}

function buildModulePrompt(module: string, dirHint: string): string {
  return `Analyze module "${module}" rooted at ${dirHint}. Focus on user-visible behaviour, not implementation. Output 3-8 ContractProposal objects.`;
}

export interface DiscoveryOptions {
  modules?: string[];
  backoffMs?: number;
  maxRetries?: number;
  onQuarantine?: (raw: string, module: string) => void;
}

async function callWithBackoff(
  llm: LLMClient,
  system: string,
  user: string,
  signal: AbortSignal,
  opts: { backoffMs: number; maxRetries: number },
): Promise<string> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= opts.maxRetries) {
    if (signal.aborted) throw new Error('aborted');
    try {
      const r = await llm.generate({ system, messages: [{ role: 'user', content: user }], temperature: 0.2, signal });
      return r.content;
    } catch (err) {
      lastErr = err;
      const status = (err as { statusCode?: number; status?: number }).statusCode
        ?? (err as { statusCode?: number; status?: number }).status;
      if (status === 429 || status === 503 || (status !== undefined && status >= 500)) {
        const wait = opts.backoffMs * (2 ** attempt);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('exhausted retries');
}

function parseProposals(raw: string): ContractProposal[] | null {
  try {
    const json = JSON.parse(raw);
    const parsed = ProposalsSchema.safeParse(json);
    if (!parsed.success) return null;
    return parsed.data as ContractProposal[];
  } catch {
    return null;
  }
}

export async function discoverByModule(
  ctx: TargetContext,
  llm: LLMClient,
  onModule: (module: string, proposals: ContractProposal[]) => Promise<void>,
  signal: AbortSignal,
  opts: DiscoveryOptions = {},
): Promise<void> {
  const modules = opts.modules ?? ['auth', 'core', 'admin'];
  const system = buildSystemPrompt(ctx);
  const backoffMs = opts.backoffMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 4;

  for (const m of modules) {
    if (signal.aborted) return;
    const user = buildModulePrompt(m, `${ctx.cwd}/${m}`);
    try {
      const raw = await callWithBackoff(llm, system, user, signal, { backoffMs, maxRetries });
      const parsed = parseProposals(raw);
      if (parsed === null) {
        opts.onQuarantine?.(raw, m);
        await onModule(m, []);
        continue;
      }
      await onModule(m, parsed);
    } catch (err) {
      opts.onQuarantine?.(`ERROR: ${(err as Error).message}`, m);
      await onModule(m, []);
    }
  }
}
