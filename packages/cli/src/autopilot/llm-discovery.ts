// packages/cli/src/autopilot/llm-discovery.ts
import { z } from 'zod';
import { stringify as yamlStringify } from 'yaml';
import type { LLMClient } from '@contractqa/orchestrator/llm';
import type { TargetContext } from './bootstrap.js';
import { extractJsonFromLlmResponse } from './interaction-discovery.js';

// Heuristic: an LLM-emitted object is a raw contract (not a wrapped
// ContractProposal) when it carries the contract id/area shape but is
// missing the wrapper's `yaml` string field.
function looksLikeRawContract(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.area === 'string' &&
    typeof r.yaml !== 'string'
  );
}

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

export const DISCOVERY_PROMPT_VERSION = '2';

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
    // ─── class-targeted CoT (tuning v1, 2026-05-28) ───
    'Before generating contracts for a module, mentally enumerate invariants',
    'in EACH of these four classes. Most agents over-produce functionality',
    'invariants and miss the other three — force breadth.',
    '',
    '  1. FUNCTIONALITY — user-visible actions with observable outcomes',
    '     (create/edit/delete/navigate/search/filter).',
    '  2. CONSTRAINT — limits / allowed sets / hard invariants',
    '     ("limited to N categories", "role-restricted", "cannot do X twice",',
    '      value bounds, uniqueness). Phrasing clue: "X must hold" / "Y is not allowed".',
    '  3. INTERACTION — state changes DURING a user flow',
    '     ("after switching filter, list updates in real time", debounced search,',
    '      loading states, dialog toggles, dropdown auto-close).',
    '  4. CONTENT — data accuracy and cross-view consistency',
    '     (detail page matches list, no truncation, prices match, labels accurate).',
    '',
    'For each class that applies, produce at least one contract that would',
    'FAIL if the invariant is broken. Prefer Stream 5 scoped assertions',
    '(element_text_equals, attribute_equals, input_value, class_contains) over',
    'broad `dom.contains_text` needles — the latter silent-pass on most pages.',
    '',
    'Each ContractProposal is a JSON object with this exact shape:',
    '  {',
    '    yaml: string,              // the YAML contract (see schema below), as a YAML-formatted string',
    '    confidence: "high" | "medium" | "low",',
    '    module: string,            // the module name passed in the user prompt',
    '    uncertainQuestions?: [ { text, type: "yes-no"|"multiple-choice", defaultAnswer, appliesTo: "whole-contract" | { jsonPath: "..." }, choices?: [string] } ],',
    '    evidence: { sourceFiles: string[], rationale: string }',
    '  }',
    '',
    'The YAML string inside `yaml` must itself conform to this contract shape:',
    '  id: <string-id>',
    '  title: <human-readable title>',
    '  area: <auth | core | admin | ...>',
    '  severity: <P0 | P1 | P2>',
    '  preconditions: { auth_state: logged_in | anonymous, role: <role-name> }',
    '  actions: [ { type: goto, path }, { type: click, target: { role, name_regex } }, { type: fill, target, value }, { type: wait, ms }, { type: http, method, path, body?, headers? } ]',
    '  expected: { url: { matches: <regex> }, localStorage: { no_key_matches: <regex>, has_key_matches: <regex> }, cookies: { no_name_matches: <regex> }, dom: { contains_text: [string], not_contains_text: [string], role_count: [{ role, name_regex?, eq|gte|lte }], attribute_equals: [{ target, attribute, equals: <string|bool> }], input_value: [{ target, equals?, matches? }], class_contains: [{ target, class }], element_text_equals: [{ target, equals }] }, auth_state: { fully_logged_out: bool }, http: { status: number|number[], body: { contains: [string], not_contains: [string], contains_keys: [string], not_contains_keys: [string] }, headers: { <name>: <value> } } }',
    '  verification: { wait_ms?, retries? }',
    '',
    'HARD CONSTRAINTS — the runner DROPS contracts that violate these:',
    '  - DO NOT invent fields like http_status, pathParams, queryParams. ExpectedBlock is STRICT (only the keys above).',
    '  - For HTTP API contracts: use {type: http} actions and assert via expected.http.{status, body, headers}.',
    '  - For DOM checks: actions MUST include at least one goto/click/fill — http-only actions + expected.dom is rejected (G18).',
    '  - For DOM richness: prefer Stream 5 fields over contains_text needles. A scoped element_text_equals on a specific test_id beats',
    '    a contains_text needle that might appear anywhere on the page. attribute_equals catches disabled/aria-* state. input_value',
    '    catches form-input persistence. Target shape: { role?, name_regex?, test_id?, text?, first?, within? }.',
    '',
    'Example output (single ContractProposal — top-level is an ARRAY of these):',
    '  {',
    '    "yaml": "id: INV-A2\\ntitle: Logged-out users cannot access protected routes\\narea: auth\\nseverity: P0\\npreconditions: { auth_state: logged_in, role: normal_user }\\nactions:\\n  - { type: goto, path: /lobby }\\n  - type: click\\n    target: { role: button, name_regex: \\"logout|sign out\\" }\\n  - { type: goto, path: /agents }\\nexpected:\\n  url: { matches: \\"^/login\\" }\\n  localStorage: { no_key_matches: \\"^sb-\\" }\\n  auth_state: { fully_logged_out: true }\\n",',
    '    "confidence": "high",',
    '    "module": "auth",',
    '    "evidence": { "sourceFiles": ["app/(auth)/logout/route.ts"], "rationale": "logout handler redirects to /login and clears sb-* keys" }',
    '  }',
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
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, wait);
          const onAbort = () => { clearTimeout(t); reject(new Error('aborted during backoff')); };
          signal.addEventListener('abort', onAbort, { once: true });
        });
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('exhausted retries');
}

function parseProposals(raw: string, module: string): ContractProposal[] | null {
  // LLMs (Claude in particular) frequently emit "Now I have understanding of
  // the X module. Let me produce the JSON array..." before the actual array.
  // Without preamble-stripping, every single LLM response gets quarantined
  // and Phase B reports generated=0. The deep-discovery path solved this
  // months ago via extractJsonFromLlmResponse; the modules path was left
  // exposed. See Finding 6 — 2026-05-27 root-cause.
  try {
    const cleaned = extractJsonFromLlmResponse(raw);
    const json = JSON.parse(cleaned);
    const parsed = ProposalsSchema.safeParse(json);
    if (parsed.success) return parsed.data as ContractProposal[];

    // Finding 7 fallback: the LLM commonly ignores the ContractProposal
    // wrapper and emits raw contract objects ({id, area, severity, actions,
    // expected, ...}) at the top level. Rather than silent-quarantining a
    // whole batch of otherwise-valid contracts, synthesize the wrapper
    // shape so they reach the loader. Confidence defaults to "medium"
    // (LLM omitted it — safest middle ground for the gating downstream).
    if (Array.isArray(json) && json.length > 0 && json.every(looksLikeRawContract)) {
      return json.map((c) => ({
        yaml: yamlStringify(c),
        confidence: 'medium' as const,
        module,
        evidence: { sourceFiles: [], rationale: 'discoverByModule (raw-contract fallback, Finding 7)' },
      }));
    }
    return null;
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
      const parsed = parseProposals(raw, m);
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
