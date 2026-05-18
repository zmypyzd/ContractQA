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
  return out;
}

async function loadEntryFiles(cwd: string): Promise<Array<{ path: string; content: string }>> {
  const found: Array<{ path: string; content: string }> = [];
  for (const candidate of ENTRY_FILE_CANDIDATES) {
    if (found.length >= 5) break;
    try {
      const full = path.join(cwd, candidate);
      const content = await readFile(full, 'utf8');
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
