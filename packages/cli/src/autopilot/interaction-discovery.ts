// packages/cli/src/autopilot/interaction-discovery.ts
//
// Interaction-driven contract discovery — opt-in alternative to
// discoverByModule. Three stages: enumerate surface, generate contracts per
// interaction, merge with existing.
//
// Spec: docs/superpowers/specs/2026-05-18-interaction-driven-discovery-design.md
import { z } from 'zod';
import type { LLMClient } from '@contractqa/orchestrator/llm';
import type { ContractProposal } from './llm-discovery.js';

export const InteractionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id must be kebab-case alphanumeric'),
  type: z.enum(['button', 'form', 'route', 'api-endpoint', 'link', 'submit-handler']),
  file: z.string(),
  name: z.string(),
  route: z.string().optional(),
  module: z.string(),
  rationale: z.string(),
});
export type Interaction = z.infer<typeof InteractionSchema>;
export const InteractionsSchema = z.array(InteractionSchema);

export interface EnumerateSurfaceOptions {
  cwd: string;
  llmClient: LLMClient;
  signal?: AbortSignal;
  maxTokens?: number;
  onQuarantine?: (raw: string, reason: string) => void;
}

export interface EnumerateSurfaceResult {
  interactions: Interaction[] | null;
  truncated: boolean;
  diagnostics: {
    fileCount: number;
    tokensEstimate: number;
    // Interactions whose `file` field did not resolve to a real path inside
    // cwd (LLM hallucination or attempted `..` escape). Dropped before being
    // returned; surfaced here so callers can summarize them in one log line
    // instead of a per-item ENOENT warn in Stage 2.
    hallucinatedInteractions: string[];
  };
}

export interface GenerateContractForOptions {
  interaction: Interaction;
  cwd: string;
  llmClient: LLMClient;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface GenerateContractForResult {
  proposals: ContractProposal[];
  rawResponse?: string;
  error?: string;
}

export interface MergeContractsInput {
  cwd: string;
  proposals: Array<{ interaction: Interaction; proposal: ContractProposal }>;
  maxContracts?: number;
  onEvent?: (event: MergeEvent) => void;
}

export type MergeEvent =
  | { type: 'skip-id-collision'; id: string }
  | { type: 'skip-content-duplicate'; id: string; existingId: string }
  | { type: 'skip-file-exists'; id: string; targetPath: string }
  | { type: 'write'; id: string; targetPath: string }
  | { type: 'cap-reached'; cap: number };

export interface MergeContractsResult {
  written: string[];
  skipped: Array<{ id: string; reason: string }>;
  hitCap: boolean;
}

export interface DiscoverByInteractionOptions {
  cwd: string;
  llmClient: LLMClient;
  signal: AbortSignal;
  concurrency?: number;
  maxContracts?: number;
  onEvent?: (event: DiscoveryEvent) => void;
}

export type DiscoveryEvent =
  | { type: 'stage'; stage: 'enumerate' | 'generate' | 'merge'; status: 'start' | 'done' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'progress'; phase: 'generate'; done: number; total: number };

export interface DiscoverByInteractionResult {
  interactionsFound: number;
  contractsWritten: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

// Implementations below.

import { readdir, readFile, stat, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { createHash } from 'node:crypto';

const DEFAULT_ENUMERATE_MAX_TOKENS = 50_000;
const ENTRY_FILE_MAX_BYTES = 32 * 1024;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache',
  '.vercel', '.parcel-cache', 'coverage', '.nyc_output', 'qa',
]);

const ENTRY_FILE_CANDIDATES = [
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'app/layout.tsx', 'app/layout.jsx',
  'app/page.tsx', 'app/page.jsx',          // home page (often present even without layout)
  'middleware.ts', 'middleware.tsx',        // Next.js auth/redirect middleware
  'src/router.tsx', 'src/router.ts',
  'src/main.tsx', 'src/main.ts',
  'vite.config.js', 'vite.config.ts',
  'package.json',
];

// Rough token estimate: ~4 chars per token (English/code average).
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

/**
 * Strip common LLM wrapping (markdown fences, leading prose) before JSON.parse.
 * Returns the input unchanged if no obvious wrapping is detected — the caller
 * still gets the raw string for quarantine on parse failure.
 */
export function extractJsonFromLlmResponse(content: string): string {
  let s = content.trim();

  // Strip ```json ... ``` or ``` ... ``` fences (most common case).
  const fenceMatch = s.match(/^```(?:json|JSON)?\s*\n?([\s\S]+?)\n?```\s*$/);
  if (fenceMatch && fenceMatch[1]) {
    s = fenceMatch[1].trim();
  }

  // If there's prose before the JSON, find the first '[' or '{' and slice from there.
  // We prefer '[' first since both Stage 1 (Interaction[]) and Stage 2 (ContractProposal[])
  // expect top-level arrays.
  const firstBracket = s.indexOf('[');
  const firstBrace = s.indexOf('{');
  const firstJson = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)
    ? firstBracket
    : firstBrace;
  if (firstJson > 0) s = s.slice(firstJson);

  // Similarly, strip trailing prose after the matching closing bracket. Heuristic:
  // find the LAST ']' or '}' in the string.
  const lastBracket = s.lastIndexOf(']');
  const lastBrace = s.lastIndexOf('}');
  const lastJson = Math.max(lastBracket, lastBrace);
  if (lastJson >= 0 && lastJson < s.length - 1) s = s.slice(0, lastJson + 1);

  return s.trim();
}

async function walkProject(cwd: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(cwd, full);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        await rec(full);
      } else if (e.isFile()) {
        const s = await stat(full);
        if (s.size > 100 * 1024) continue;  // skip >100kB
        out.push(rel.split(path.sep).join('/'));
      }
    }
  }
  await rec(cwd);
  return out.sort();   // alphabetical sort so truncation is deterministic
}

async function loadEntryFiles(cwd: string): Promise<Array<{ path: string; content: string }>> {
  const found: Array<{ path: string; content: string }> = [];
  for (const candidate of ENTRY_FILE_CANDIDATES) {
    if (found.length >= 5) break;
    try {
      const full = path.join(cwd, candidate);
      let content = await readFile(full, 'utf8');
      if (content.length > ENTRY_FILE_MAX_BYTES) {
        content = content.slice(0, ENTRY_FILE_MAX_BYTES) + '\n// [... truncated for token budget]';
      }
      found.push({ path: candidate, content });
    } catch {
      // not present; skip
    }
  }
  return found;
}

function buildSystemPrompt(framework: string, routes: string): string {
  return [
    'You are an expert QA engineer reading a project to identify every',
    'user-triggerable interaction. Output strictly a JSON array of Interaction',
    'objects. No prose, no markdown fences.',
    '',
    `Project framework: ${framework}.`,
    `Known routes: ${routes}.`,
    '',
    'Each Interaction:',
    '  {',
    '    id: string                  // kebab-case-alphanumeric, e.g. "btn-launcher-night-shift"',
    '    type: "button"|"form"|"route"|"api-endpoint"|"link"|"submit-handler",',
    '    file: string                // relative path with forward slashes',
    '    name: string                // human-readable',
    '    route?: string              // for type ∈ {route, api-endpoint}',
    '    module: string              // top-level grouping (dashboard, launcher, api, ...)',
    '    rationale: string           // one sentence: why testable',
    '  }',
    '',
    'Rules:',
    '1. Bias toward inclusion. Better to list 300 interactions and prune later',
    '   than to skip a real one. When uncertain, INCLUDE.',
    '2. Target output: at least 1 interaction per route + 1 per button/form/link',
    '   in each route component tree. For a project with 30 routes and ~5',
    '   interactive elements per route, expect ~150 interactions. Undershooting',
    '   is a failure mode.',
    '3. Include any element a user can click, type into, submit, drag, or',
    '   navigate to — even if it looks like a "presentation" component.',
    '   A <Card onClick> IS an interaction. A <Badge as={Link}> IS an',
    '   interaction. When in doubt, include and let dedup handle duplicates.',
    '4. The ONLY hard skips:',
    '   - Test files (.test.*, .spec.*, *.stories.*, __mocks__/**)',
    '   - Pure type-definition files (.d.ts)',
    '   - Files with zero JSX/handler tokens after a quick grep',
    '5. If conditional rendering hides an interaction, still list it.',
    '6. `id` MUST be deterministic and unique within this list.',
    '7. Strict JSON output: a single top-level array. No prose.',
  ].join('\n');
}

function buildUserPrompt(fileList: string[], entryFiles: Array<{ path: string; content: string }>, truncatedCount: number): string {
  const parts: string[] = [];
  parts.push('FILE TREE:');
  parts.push(fileList.join('\n'));
  if (truncatedCount > 0) {
    parts.push(`[... ${truncatedCount} more files truncated]`);
  }
  parts.push('');
  parts.push('ENTRY FILES:');
  for (const f of entryFiles) {
    parts.push(`--- ${f.path} ---`);
    parts.push(f.content);
    parts.push('');
  }
  return parts.join('\n');
}

export async function enumerateSurface(opts: EnumerateSurfaceOptions): Promise<EnumerateSurfaceResult> {
  const maxTokens = opts.maxTokens ?? DEFAULT_ENUMERATE_MAX_TOKENS;
  const allFiles = await walkProject(opts.cwd);
  const entryFiles = await loadEntryFiles(opts.cwd);

  // Token budget: entry files first (higher signal), then file tree.
  const entryTokens = entryFiles.reduce((sum, f) => sum + estimateTokens(`--- ${f.path} ---\n${f.content}\n\n`), 0);
  const overheadTokens = 1000;  // for prompt structure + system prompt
  const fileListBudget = Math.max(0, maxTokens - entryTokens - overheadTokens);

  let fileList = allFiles;
  let truncatedCount = 0;
  const fullListStr = allFiles.join('\n');
  if (estimateTokens(fullListStr) > fileListBudget) {
    // Keep alphabetical-first 80%, drop the rest with a marker.
    const keepCount = Math.floor(allFiles.length * 0.8);
    fileList = allFiles.slice(0, keepCount);
    truncatedCount = allFiles.length - keepCount;
  }

  // Detect framework + routes via TargetContext.
  const { assembleTargetContext } = await import('./bootstrap.js');
  const ctx = await assembleTargetContext(opts.cwd);
  const routes = ctx.routes.length > 0 ? ctx.routes.join(', ') : 'unknown';

  const system = buildSystemPrompt(ctx.framework, routes);
  const user = buildUserPrompt(fileList, entryFiles, truncatedCount);

  let content: string;
  try {
    const r = await opts.llmClient.generate({
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.2,
      signal: opts.signal,
    });
    content = r.content;
  } catch (err) {
    opts.onQuarantine?.(String(err), `LLM call failed: ${(err as Error).message}`);
    return {
      interactions: null,
      truncated: truncatedCount > 0,
      diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user), hallucinatedInteractions: [] },
    };
  }

  const cleaned = extractJsonFromLlmResponse(content);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    opts.onQuarantine?.(content, 'LLM response is not valid JSON');
    return {
      interactions: null,
      truncated: truncatedCount > 0,
      diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user), hallucinatedInteractions: [] },
    };
  }

  const parsed = InteractionsSchema.safeParse(json);
  if (!parsed.success) {
    opts.onQuarantine?.(content, `Zod validation failed: ${parsed.error.message}`);
    return {
      interactions: null,
      truncated: truncatedCount > 0,
      diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user), hallucinatedInteractions: [] },
    };
  }

  // Drop interactions whose `file` is a hallucination — either a path the LLM
  // invented (not in the project tree) or a `..` escape attempt. We check the
  // un-truncated `allFiles` so paths that were truncated from the prompt but
  // are actually present still pass.
  const fileSet = new Set(allFiles);
  const hallucinated: string[] = [];
  const survived: Interaction[] = [];
  for (const it of parsed.data) {
    // A path with `..` anywhere — including embedded segments like
    // `app/../../escape.tsx` — cannot represent a file inside cwd. Reject.
    const hasEscape = it.file.split('/').includes('..');
    if (hasEscape || !fileSet.has(it.file)) {
      hallucinated.push(it.id);
    } else {
      survived.push(it);
    }
  }

  return {
    interactions: survived,
    truncated: truncatedCount > 0,
    diagnostics: {
      fileCount: allFiles.length,
      tokensEstimate: estimateTokens(user),
      hallucinatedInteractions: hallucinated,
    },
  };
}

const DEFAULT_GENERATE_MAX_TOKENS = 10_000;
const WINDOW_LINES_BEFORE = 40;
const WINDOW_LINES_AFTER = 40;
const FALLBACK_WINDOW_LINES = 80;

function extractWindow(fileContent: string, matchTokens: string[]): string {
  const lines = fileContent.split('\n');
  let matchIdx = -1;
  for (const token of matchTokens) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(token)) { matchIdx = i; break; }
    }
    if (matchIdx >= 0) break;
  }
  if (matchIdx < 0) {
    return lines.slice(0, FALLBACK_WINDOW_LINES).join('\n');
  }
  const start = Math.max(0, matchIdx - WINDOW_LINES_BEFORE);
  const end = Math.min(lines.length, matchIdx + WINDOW_LINES_AFTER + 1);
  return lines.slice(start, end).join('\n');
}

export function buildGenerateSystemPrompt(): string {
  // Reuse the existing schema description from llm-discovery.ts. We replicate
  // it here (rather than importing) because llm-discovery's prompt is
  // constructed from a TargetContext and includes 'modules' framing.
  return [
    'You are an expert QA engineer. Given a single user-triggerable',
    'interaction in a project and its surrounding source code, output a JSON',
    'array of 0-3 ContractProposal objects describing user-visible invariants',
    'of that interaction. No prose, no markdown fences.',
    '',
    'ContractProposal:',
    '  {',
    '    yaml: string,              // YAML for one contract',
    '    confidence: "high" | "medium" | "low",',
    '    module: string,',
    '    uncertainQuestions?: UncertainQuestion[],',
    '    evidence: { sourceFiles: string[], rationale: string }',
    '  }',
    '',
    'UncertainQuestion:',
    '  {',
    '    text: string,                                // the question, as plain prose',
    '    type: "yes-no" | "multiple-choice",          // strictly these two literals; do NOT emit "boolean"/"text"/"confirm"/"choice"',
    '    defaultAnswer: string,                       // always a string, even for yes-no (use "yes"/"no", NOT true/false)',
    '    choices?: string[],                          // required for multiple-choice, omit for yes-no',
    '    appliesTo: "whole-contract" | { jsonPath: string }',
    '                                                 // either the literal string "whole-contract", or an object',
    '                                                 // like { "jsonPath": "expected.visible" }. Do NOT emit a bare',
    '                                                 // string like "expected.visible" or "preconditions.auth_state".',
    '  }',
    '',
    'Each YAML contract MUST conform to this schema. The runner rejects any',
    'extra keys or unlisted action types — be strict.',
    '',
    '  id: <kebab-case-id>             # ^[a-zA-Z][a-zA-Z0-9-]*$, max 100',
    '  title: <human title>',
    '  area: <auth|core|admin|api|...>',
    '  severity: <P0|P1|P2|P3>',
    '  preconditions:',
    '    auth_state: logged_in|anonymous   # optional',
    '    role: <role-name>                 # optional',
    '  actions:                          # must be non-empty; EXACTLY one of these 5 shapes per item',
    '    - { type: goto,  path: <string>, locale?: <string> }',
    '    - { type: click, target: <Target> }',
    '    - { type: fill,  target: <Target>, value: <string> }',
    '    - { type: wait,  ms: <integer> }',
    '    - { type: http,  method: GET|POST|PUT|PATCH|DELETE, path: <string>, body?: <any>, headers?: <object> }',
    '  expected:                         # all sub-fields optional; OMIT keys you cannot assert',
    '    url:           { matches: <regex> }                         # OBJECT, not bare string',
    '    localStorage:  { no_key_matches?: <regex>, has_key_matches?: <regex> }',
    '    sessionStorage:{ no_key_matches?: <regex> }',
    '    cookies:       { no_name_matches?: <regex> }',
    '    dom:           { contains_text?: [string], not_contains_text?: [string],',
    '                     role_count?: [{ role, name_regex?, eq?|gte?|lte? }] }',
    '    auth_state:    { fully_logged_out?: <bool> }',
    '    http:          { status?: <number|number[]>,',
    '                     body?: { contains?: [string], not_contains?: [string],',
    '                              contains_keys?: [string], not_contains_keys?: [string] },',
    '                     headers?: { <header-name>: <value> } }',
    '',
    '  Target shape: { role?, name_regex?, test_id?, text?, first?, within? }',
    '',
    'HARD CONSTRAINTS (the runner WILL drop your contract if violated):',
    '  - actions[*].type MUST be one of: goto, click, fill, wait, http.',
    '    DO NOT invent api-call, api-request, ws-connect, websocket, navigate, submit, etc.',
    '    For backend HTTP assertions use {type: http, method, path}.',
    '  - expected.url MUST be {matches: <regex>}, never a bare string.',
    '  - DO NOT emit pathParams, queryParams, or any key not listed above. expected is STRICT.',
    '    For HTTP status / body / header assertions, use a {type: http} action AND',
    '    assert via expected.http.{status, body, headers}.',
    '  - G18: if expected.dom is set, actions MUST include at least one goto/click/fill.',
    '    DOM checks fired after http-only actions evaluate on the wrong page and the runner now rejects them.',
    '  - name_regex MUST be a valid JS RegExp source. NO lookbehind (?<=, NO lookahead (?=,',
    '    NO inline flags like (?i) (use case-insensitive *patterns* instead, e.g. [Cc]ancel).',
    '    Avoid catastrophic backtracking patterns like (a|b)+ or (.*)+ — the runner rejects these.',
    '  - All action item objects are STRICT — no extra keys.',
    '',
    'If the interaction has no user-visible invariant beyond "it renders",',
    'output an empty array [].',
    'Strict JSON output: single top-level array. No prose.',
  ].join('\n');
}

function buildGenerateUserPrompt(interaction: Interaction, window: string): string {
  return [
    `Interaction:`,
    `  id: ${interaction.id}`,
    `  type: ${interaction.type}`,
    `  name: ${interaction.name}`,
    `  route: ${interaction.route ?? 'n/a'}`,
    `  module: ${interaction.module}`,
    `  file: ${interaction.file}`,
    `  rationale: ${interaction.rationale}`,
    '',
    `Source context (around the interaction):`,
    '```',
    window,
    '```',
  ].join('\n');
}

const UncertainQuestionSchema = z.object({
  text: z.string(),
  type: z.enum(['yes-no', 'multiple-choice']),
  choices: z.array(z.string()).optional(),
  defaultAnswer: z.string(),
  appliesTo: z.union([z.literal('whole-contract'), z.object({ jsonPath: z.string() })]),
});

// Tolerant container: each entry is validated independently. Bad items are
// dropped silently — historically a single malformed question (e.g.
// `type: "boolean"`, `defaultAnswer: true`, `appliesTo: "expected.visible"`)
// poisoned the whole proposal, so the autopilot run produced zero contracts
// for that interaction. Dropping just the bad item lets the rest survive.
const UncertainQuestionsArraySchema = z
  .preprocess(
    (arr) =>
      Array.isArray(arr)
        ? arr.filter((item) => UncertainQuestionSchema.safeParse(item).success)
        : arr,
    z.array(UncertainQuestionSchema),
  )
  .optional();

const ProposalSchema = z.object({
  yaml: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  module: z.string(),
  uncertainQuestions: UncertainQuestionsArraySchema,
  evidence: z.object({ sourceFiles: z.array(z.string()), rationale: z.string() }),
});
const ProposalsSchema = z.array(ProposalSchema);

export async function generateContractFor(opts: GenerateContractForOptions): Promise<GenerateContractForResult> {
  const maxTokens = opts.maxTokens ?? DEFAULT_GENERATE_MAX_TOKENS;
  const filePath = path.join(opts.cwd, opts.interaction.file);

  let fileContent = '';
  try {
    fileContent = await readFile(filePath, 'utf8');
  } catch (err) {
    return { proposals: [], error: `failed to read ${opts.interaction.file}: ${(err as Error).message}` };
  }

  // Try matching by id first (unique/precise), then name as fallback.
  let window = extractWindow(fileContent, [opts.interaction.id, opts.interaction.name]);

  // Truncate if window itself exceeds the per-call cap (anchor-preserving).
  if (estimateTokens(window) > maxTokens - 1000) {
    const lines = window.split('\n');
    const keep = Math.floor(lines.length * ((maxTokens - 1000) / estimateTokens(window)));

    // Locate the anchor line inside the window (same tokens as extractWindow).
    let matchIdx = -1;
    for (const token of [opts.interaction.id, opts.interaction.name]) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(token)) { matchIdx = i; break; }
      }
      if (matchIdx >= 0) break;
    }

    let trimStart = Math.floor((lines.length - keep) / 2);
    if (matchIdx >= 0) {
      // Clamp so matchIdx is inside [trimStart, trimStart + keep).
      if (matchIdx < trimStart) trimStart = matchIdx;
      else if (matchIdx >= trimStart + keep) trimStart = Math.max(0, matchIdx - keep + 1);
    }

    window = lines.slice(trimStart, trimStart + keep).join('\n');
  }

  const system = buildGenerateSystemPrompt();
  const user = buildGenerateUserPrompt(opts.interaction, window);

  let content: string;
  try {
    const r = await opts.llmClient.generate({
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.2,
      signal: opts.signal,
    });
    content = r.content;
  } catch (err) {
    return { proposals: [], error: `LLM call failed: ${(err as Error).message}` };
  }

  const cleaned = extractJsonFromLlmResponse(content);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return { proposals: [], rawResponse: content, error: 'LLM response is not valid JSON' };
  }

  const parsed = ProposalsSchema.safeParse(json);
  if (!parsed.success) {
    return { proposals: [], rawResponse: content, error: `Zod validation failed: ${parsed.error.message}` };
  }

  return { proposals: parsed.data as ContractProposal[] };
}

/**
 * Process `items` with a worker pool of `limit` concurrent workers.
 * Returns results in input order. Individual failures become `null` —
 * other items continue.
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= items.length) return;
      try {
        results[myIdx] = await fn(items[myIdx]!);
      } catch {
        results[myIdx] = null;
      }
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ─── Stage 3: buildExistingIndex + mergeContracts ────────────────────────────

export interface ParsedContract {
  id: string;
  area?: string;
  [k: string]: unknown;
}

export function parseContract(yamlStr: string): ParsedContract {
  const obj = yamlParse(yamlStr) as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    throw new Error('contract YAML is not an object');
  }
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new Error('contract YAML missing required `id` field');
  }
  return obj as ParsedContract;
}

/** Deterministic JSON: sorts object keys recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}

/** Hash the full parsed contract minus `id` — see spec §7.2 Layer 2. */
export function contentHash(parsed: Record<string, unknown>): string {
  const { id: _id, ...rest } = parsed;
  return createHash('sha256').update(stableStringify(rest)).digest('hex');
}

export interface ExistingContractMeta {
  id: string;
  filePath: string;
  contentHash: string;
}

export interface ExistingIndex {
  byId: Map<string, ExistingContractMeta>;
  byHash: Map<string, ExistingContractMeta>;
}

async function walkYamlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(d: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name as string);
      if (e.isDirectory()) {
        await rec(full);
      } else if (e.isFile() && ((e.name as string).endsWith('.yml') || (e.name as string).endsWith('.yaml'))) {
        out.push(full);
      }
    }
  }
  await rec(dir);
  return out;
}

export async function buildExistingIndex(cwd: string): Promise<ExistingIndex> {
  const byId = new Map<string, ExistingContractMeta>();
  const byHash = new Map<string, ExistingContractMeta>();
  const files = await walkYamlFiles(path.join(cwd, 'qa', 'contracts'));

  const parsed = await Promise.all(
    files.map(async (filePath) => {
      try {
        const content = await readFile(filePath, 'utf8');
        const obj = parseContract(content);
        const hash = contentHash(obj);
        return { ok: true as const, filePath, id: obj.id, hash };
      } catch {
        return { ok: false as const };
      }
    }),
  );

  for (const r of parsed) {
    if (!r.ok) continue;
    const meta: ExistingContractMeta = { id: r.id, filePath: r.filePath, contentHash: r.hash };
    byId.set(r.id, meta);
    byHash.set(r.hash, meta);
  }

  return { byId, byHash };
}

const DEFAULT_MAX_CONTRACTS = 500;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function mergeContracts(input: MergeContractsInput): Promise<MergeContractsResult> {
  const maxContracts = input.maxContracts ?? DEFAULT_MAX_CONTRACTS;
  const emit = (e: MergeEvent) => input.onEvent?.(e);
  const existing = await buildExistingIndex(input.cwd);
  const written: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const { interaction, proposal } of input.proposals) {
    if (written.length >= maxContracts) {
      emit({ type: 'cap-reached', cap: maxContracts });
      return { written, skipped, hitCap: true };
    }

    let parsed: ParsedContract;
    try {
      parsed = parseContract(proposal.yaml);
    } catch (err) {
      const yamlSnippet = proposal.yaml.slice(0, 80).replace(/\n/g, ' ');
      skipped.push({ id: `(unparseable: ${yamlSnippet}...)`, reason: `parse failed: ${(err as Error).message}` });
      continue;
    }

    // Layer 1: id collision
    if (existing.byId.has(parsed.id)) {
      const reason = `id collision with ${existing.byId.get(parsed.id)!.filePath}`;
      skipped.push({ id: parsed.id, reason });
      emit({ type: 'skip-id-collision', id: parsed.id });
      continue;
    }

    // Layer 2: content hash duplicate
    const hash = contentHash(parsed as unknown as Record<string, unknown>);
    if (existing.byHash.has(hash)) {
      const existingId = existing.byHash.get(hash)!.id;
      const reason = `content duplicate of ${existingId}`;
      skipped.push({ id: parsed.id, reason });
      emit({ type: 'skip-content-duplicate', id: parsed.id, existingId });
      continue;
    }

    // Layer 3: file-exists guard (race-safety)
    const dir = typeof parsed.area === 'string' && parsed.area.length > 0 ? parsed.area : interaction.module;
    const targetPath = path.join(input.cwd, 'qa', 'contracts', dir, `${parsed.id}.yml`);
    if (await fileExists(targetPath)) {
      const reason = `file exists at ${targetPath}`;
      skipped.push({ id: parsed.id, reason });
      emit({ type: 'skip-file-exists', id: parsed.id, targetPath });
      continue;
    }

    // Write with frontmatter. Per spec §8 row 6: on write failure, emit error
    // log and continue with the next proposal (don't throw out of the batch).
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      const frontmatter = [
        '# generated-by: deep-discovery v1',
        `# interaction: ${interaction.id} (${interaction.type})`,
        `# rationale: ${interaction.rationale}`,
      ].join('\n');
      try {
        await writeFile(targetPath, `${frontmatter}\n${proposal.yaml}`, { flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Race: another writer landed the file between Layer 3 probe and our write.
          // Treat as Layer 3 skip.
          const reason = `file exists at ${targetPath} (race detected)`;
          skipped.push({ id: parsed.id, reason });
          emit({ type: 'skip-file-exists', id: parsed.id, targetPath });
          continue;
        }
        throw err;  // re-throw non-EEXIST to be caught by outer try/catch
      }
      written.push(targetPath);
      emit({ type: 'write', id: parsed.id, targetPath });
    } catch (err) {
      skipped.push({ id: parsed.id, reason: `write failed: ${(err as Error).message}` });
      continue;  // don't index it; don't throw
    }

    // Add to in-memory index so subsequent proposals in the same batch dedup correctly.
    const meta: ExistingContractMeta = { id: parsed.id, filePath: targetPath, contentHash: hash };
    existing.byId.set(parsed.id, meta);
    existing.byHash.set(hash, meta);
  }

  return { written, skipped, hitCap: false };
}

// ─── Orchestrator: discoverByInteraction ─────────────────────────────────────

import { discoverByModule } from './llm-discovery.js';

const DEFAULT_CONCURRENCY = 4;

async function fallbackToModuleDiscovery(
  opts: DiscoverByInteractionOptions,
  reason: string,
): Promise<DiscoverByInteractionResult> {
  opts.onEvent?.({
    type: 'log',
    level: reason.startsWith('surface enumeration returned 0') ? 'warn' : 'error',
    message: `[deep] ${reason}; falling back to module discovery`,
  });
  let written = 0;
  const { assembleTargetContext } = await import('./bootstrap.js');
  const ctx = await assembleTargetContext(opts.cwd);
  await discoverByModule(
    ctx,
    opts.llmClient,
    async (_module, proposals) => {
      // Same merge path as the deep flow.
      const merged = await mergeContracts({
        cwd: opts.cwd,
        proposals: proposals.map((p) => ({
          interaction: {
            id: 'fallback', type: 'button' as const, file: '', name: 'fallback',
            module: _module, rationale: 'discoverByModule fallback',
          },
          proposal: p,
        })),
        maxContracts: opts.maxContracts,
      });
      written += merged.written.length;
    },
    opts.signal,
  );
  return {
    interactionsFound: 0,
    contractsWritten: written,
    fallbackUsed: true,
    fallbackReason: reason,
  };
}

export async function discoverByInteraction(
  opts: DiscoverByInteractionOptions,
): Promise<DiscoverByInteractionResult> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const maxContracts = opts.maxContracts ?? DEFAULT_MAX_CONTRACTS;
  const emit = (e: DiscoveryEvent) => opts.onEvent?.(e);

  // Stage 1
  emit({ type: 'stage', stage: 'enumerate', status: 'start' });
  let enumResult: EnumerateSurfaceResult;
  try {
    enumResult = await enumerateSurface({
      cwd: opts.cwd,
      llmClient: opts.llmClient,
      signal: opts.signal,
      onQuarantine: (_raw, reason) => {
        emit({ type: 'log', level: 'warn', message: `[deep] enumerateSurface quarantine: ${reason}` });
      },
    });
  } catch (err) {
    return fallbackToModuleDiscovery(opts, `surface enumeration crashed: ${(err as Error).message}`);
  }
  emit({ type: 'stage', stage: 'enumerate', status: 'done' });

  if (enumResult.interactions === null) {
    return fallbackToModuleDiscovery(opts, 'surface enumeration failed (invalid LLM output)');
  }
  if (enumResult.interactions.length === 0) {
    return fallbackToModuleDiscovery(opts, 'surface enumeration returned 0 interactions');
  }
  if (enumResult.truncated) {
    emit({
      type: 'log',
      level: 'warn',
      message: `[deep] file tree exceeded 50k cap, truncated (was ${enumResult.diagnostics.fileCount} files total); consider chunking by top-level dir`,
    });
  }
  if (enumResult.diagnostics.hallucinatedInteractions.length > 0) {
    const ids = enumResult.diagnostics.hallucinatedInteractions;
    const sample = ids.slice(0, 5).join(', ');
    const more = ids.length > 5 ? ` (+${ids.length - 5} more)` : '';
    emit({
      type: 'log',
      level: 'warn',
      message: `[deep] dropped ${ids.length} interaction(s) with hallucinated file paths (LLM-invented or cwd-escape): ${sample}${more}`,
    });
  }

  // Stage 2
  emit({ type: 'stage', stage: 'generate', status: 'start' });
  const interactions = enumResult.interactions;
  let completed = 0;
  const results = await runPool(interactions, concurrency, async (interaction) => {
    if (opts.signal.aborted) return null;
    const r = await generateContractFor({
      interaction,
      cwd: opts.cwd,
      llmClient: opts.llmClient,
      signal: opts.signal,
    });
    completed++;
    emit({ type: 'progress', phase: 'generate', done: completed, total: interactions.length });
    if (r.error) {
      emit({ type: 'log', level: 'warn', message: `[deep] interaction ${interaction.id}: ${r.error}` });
    }
    return r;
  });
  emit({ type: 'stage', stage: 'generate', status: 'done' });

  // Build flat proposals list paired with their interaction.
  const flatProposals: Array<{ interaction: Interaction; proposal: ContractProposal }> = [];
  for (let i = 0; i < interactions.length; i++) {
    const r = results[i];
    if (!r) continue;
    for (const p of r.proposals) {
      flatProposals.push({ interaction: interactions[i]!, proposal: p });
    }
  }

  // Stage 3
  emit({ type: 'stage', stage: 'merge', status: 'start' });
  const merged = await mergeContracts({
    cwd: opts.cwd,
    proposals: flatProposals,
    maxContracts,
    onEvent: (e) => {
      if (e.type === 'write') {
        emit({ type: 'log', level: 'info', message: `[deep] wrote ${e.targetPath}` });
      } else if (e.type === 'cap-reached') {
        emit({ type: 'log', level: 'warn', message: `[deep] hit max-contracts cap (${e.cap}), stopping early` });
      }
    },
  });
  emit({ type: 'stage', stage: 'merge', status: 'done' });

  return {
    interactionsFound: interactions.length,
    contractsWritten: merged.written.length,
    fallbackUsed: false,
  };
}
