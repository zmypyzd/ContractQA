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
  diagnostics: { fileCount: number; tokensEstimate: number };
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

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ENUMERATE_MAX_TOKENS = 50_000;
const ENTRY_FILE_MAX_BYTES = 32 * 1024;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache',
  '.vercel', '.parcel-cache', 'coverage', '.nyc_output', 'qa',
]);

const ENTRY_FILE_CANDIDATES = [
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'app/layout.tsx', 'app/layout.jsx',
  'src/router.tsx', 'src/router.ts',
  'src/main.tsx', 'src/main.ts',
  'vite.config.js', 'vite.config.ts',
  'package.json',
];

// Rough token estimate: ~4 chars per token (English/code average).
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
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
      diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user) },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    opts.onQuarantine?.(content, 'LLM response is not valid JSON');
    return {
      interactions: null,
      truncated: truncatedCount > 0,
      diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user) },
    };
  }

  const parsed = InteractionsSchema.safeParse(json);
  if (!parsed.success) {
    opts.onQuarantine?.(content, `Zod validation failed: ${parsed.error.message}`);
    return {
      interactions: null,
      truncated: truncatedCount > 0,
      diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user) },
    };
  }

  return {
    interactions: parsed.data,
    truncated: truncatedCount > 0,
    diagnostics: { fileCount: allFiles.length, tokensEstimate: estimateTokens(user) },
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

function buildGenerateSystemPrompt(): string {
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
    '    uncertainQuestions?: [{ text, type, defaultAnswer, appliesTo, choices? }],',
    '    evidence: { sourceFiles: string[], rationale: string }',
    '  }',
    '',
    'Each YAML contract:',
    '  id: <kebab-case-id>',
    '  title: <human title>',
    '  area: <auth|core|admin|...>',
    '  severity: <P0|P1|P2>',
    '  preconditions: { auth_state: logged_in|anonymous, role: ... }',
    '  actions: [ {type:goto,path}, {type:click,target:{role,name_regex}}, ... ]',
    '  expected: { url?, http_status?, localStorage?, auth_state? }',
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

  let json: unknown;
  try {
    json = JSON.parse(content);
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
