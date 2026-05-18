# Interaction-Driven Contract Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--discovery-mode deep` to `contractqa autopilot` that uses LLM-driven surface enumeration + per-interaction contract generation, targeting 100-300 contracts via 1:1 surface coverage (vs. the current 9-24 cap).

**Architecture:** Two-stage LLM pipeline. Stage 1 enumerates interactions from project source code (1 large call, 50k token cap). Stage 2 generates 1-3 contracts per interaction (N small calls, 10k token cap, 4-way concurrent). Stage 3 incrementally merges into `qa/contracts/` with 3-layer dedup (id / content hash / file-exists). Old `discoverByModule` stays as the default; new path is opt-in.

**Tech Stack:** TypeScript + Node 22, pnpm monorepo, Vitest tests, Zod schemas, Commander.js CLI, SSE for Dashboard, Drizzle/Postgres (only touched by indirect Phase B/C output).

**Spec:** [`docs/superpowers/specs/2026-05-18-interaction-driven-discovery-design.md`](../specs/2026-05-18-interaction-driven-discovery-design.md)

**Spec deviations noted upfront:**

1. Spec §5.1.4 says framework + packageManager + router come from `assembleTargetContext` in `bootstrap.ts`. Verified — `TargetContext` exposes `framework` and `routes` but NOT `packageManager`. **This plan drops `{packageManager}` from the prompt** (low-signal, not worth adding a new detector). The `{router}` placeholder is filled from `TargetContext.routes.join(', ')` when present, else `'unknown'`.

2. Spec §6.2 says Stage 2 "reuses the same system prompt used by `discoverByModule` (`llm-discovery.ts:40-83`)". On closer reading, that prompt is framed around module-batched discovery (`"Output 3-8 ContractProposal objects"`) and references `TargetContext`. Using it verbatim for per-interaction generation would confuse the LLM. **This plan writes a new per-interaction system prompt** (Task 2 Step 3's `buildGenerateSystemPrompt`) that reuses the same `ContractProposal` shape and YAML contract schema but is framed around a single interaction. The "no new schema" promise in §6.2 is honored — the schema is duplicated as `ProposalSchema` to keep the file self-contained but matches the existing one exactly.

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/cli/src/autopilot/interaction-discovery.ts` | Stage 1 (`enumerateSurface`), Stage 2 (`generateContractFor`, `runPool`), Stage 3 (`buildExistingIndex`, `mergeContracts`), orchestrator (`discoverByInteraction`). All shared types exported. |
| `packages/cli/tests/interaction-discovery.test.ts` | Unit tests with mocked `LLMClient` + tmpdir fixtures. |
| `packages/cli/tests/fixtures/interaction-discovery/` | Tiny fixture project (3 files) for the integration test. |

### Modified files
| Path | Change |
|---|---|
| `packages/cli/src/commands/autopilot.ts` | Add `discoveryMode? \| deepConcurrency? \| deepMaxContracts?` to `AutopilotOptions`; Phase B branches on `discoveryMode`. |
| `packages/cli/bin/contractqa.ts` | Add 3 Commander options on the `autopilot` command; forward to `runAutopilot`. |
| `apps/dashboard/app/launcher/stream/route.ts` | Parse `discoveryMode` URL param; forward to `runAutopilot`. |
| `apps/dashboard/app/launcher/page.tsx` | Add `deepMode` state + DEEP toggle; add persistent `errors[]` state + `ErrorsBanner` component; `startRun()` sends `discoveryMode` in URL. |
| `apps/dashboard/app/launcher/launcher.module.css` | Add `.errorsBanner`, `.errorsClear` rules. Reuse existing `.toggle` for the new DEEP toggle. |

### Unchanged (intentional)
- `packages/cli/src/autopilot/llm-discovery.ts` — `discoverByModule` stays as the default path.
- `packages/cli/src/autopilot/smoke-patterns.ts` — Phase A.
- `packages/orchestrator/*` — orchestrator unchanged.
- `apps/dashboard/drizzle/*` — no schema changes.

---

## Shared Types (defined in Task 1)

```ts
// packages/cli/src/autopilot/interaction-discovery.ts (all exported)

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
  maxTokens?: number;       // default 50000
  onQuarantine?: (raw: string, reason: string) => void;
}

export interface EnumerateSurfaceResult {
  interactions: Interaction[] | null;   // null on failure
  truncated: boolean;
  diagnostics: { fileCount: number; tokensEstimate: number };
}

export interface GenerateContractForOptions {
  interaction: Interaction;
  cwd: string;
  llmClient: LLMClient;
  signal?: AbortSignal;
  maxTokens?: number;       // default 10000
}

export interface GenerateContractForResult {
  proposals: ContractProposal[];
  rawResponse?: string;
  error?: string;
}

export interface MergeContractsInput {
  cwd: string;
  proposals: Array<{ interaction: Interaction; proposal: ContractProposal }>;
  maxContracts?: number;    // default 500
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
  concurrency?: number;     // default 4
  maxContracts?: number;    // default 500
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
```

```ts
// extension to packages/cli/src/commands/autopilot.ts (Task 5)
export interface AutopilotOptions {
  // ... existing fields
  discoveryMode?: 'modules' | 'deep';
  deepConcurrency?: number;
  deepMaxContracts?: number;
}
```

---

## Task 1: `interaction-discovery.ts` skeleton + types + `enumerateSurface`

**Files:**
- Create: `packages/cli/src/autopilot/interaction-discovery.ts`
- Test: `packages/cli/tests/interaction-discovery.test.ts`

- [ ] **Step 1: Write the failing test for `InteractionSchema`**

Create `packages/cli/tests/interaction-discovery.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  InteractionSchema,
  InteractionsSchema,
  enumerateSurface,
  type Interaction,
} from '../src/autopilot/interaction-discovery.js';

describe('InteractionSchema', () => {
  it('accepts a valid interaction', () => {
    const valid: Interaction = {
      id: 'btn-launcher-night-shift',
      type: 'button',
      file: 'apps/dashboard/app/launcher/page.tsx',
      name: 'Night-shift button',
      module: 'dashboard',
      rationale: 'triggers auto-pr watch mode',
    };
    expect(InteractionSchema.parse(valid)).toEqual(valid);
  });

  it('rejects id with uppercase letters', () => {
    expect(() =>
      InteractionSchema.parse({
        id: 'BTN-Launcher',
        type: 'button',
        file: 'a.tsx',
        name: 'x',
        module: 'm',
        rationale: 'r',
      }),
    ).toThrow(/kebab-case/);
  });

  it('rejects unknown type', () => {
    expect(() =>
      InteractionSchema.parse({
        id: 'x',
        type: 'unknown-type',
        file: 'a.tsx',
        name: 'x',
        module: 'm',
        rationale: 'r',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure (module missing)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts`
Expected: FAIL — `Cannot find module '../src/autopilot/interaction-discovery.js'`

- [ ] **Step 3: Create module skeleton with shared types**

Create `packages/cli/src/autopilot/interaction-discovery.ts`:

```ts
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

export async function enumerateSurface(_opts: EnumerateSurfaceOptions): Promise<EnumerateSurfaceResult> {
  throw new Error('not implemented yet');
}
```

- [ ] **Step 4: Run test, expect PASS (3 schema tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'InteractionSchema'`
Expected: `3 passed`

- [ ] **Step 5: Failing tests for `enumerateSurface`**

Append to `packages/cli/tests/interaction-discovery.test.ts`:

```ts
// Helper: build a stub LLMClient that returns a canned response.
const stubLlm = (response: string): LLMClient => ({
  providerName: 'anthropic-sdk',
  modelHint: 'test',
  generate: vi.fn(async () => ({ content: response, usage: { inputTokens: 0, outputTokens: 0 } })),
});

// Use require/dynamic-import-style import for stubLlm typing:
import type { LLMClient } from '@contractqa/orchestrator/llm';

describe('enumerateSurface', () => {
  it('returns parsed interactions from valid LLM JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{"name":"x"}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app', 'page.tsx'), 'export default function Page() { return null }');

    const cannedInteractions = [
      {
        id: 'btn-app-cta',
        type: 'button',
        file: 'app/page.tsx',
        name: 'CTA',
        module: 'app',
        rationale: 'main call-to-action',
      },
    ];
    const llm = stubLlm(JSON.stringify(cannedInteractions));

    const result = await enumerateSurface({ cwd, llmClient: llm });

    expect(result.interactions).toEqual(cannedInteractions);
    expect(result.truncated).toBe(false);
    expect(result.diagnostics.fileCount).toBeGreaterThan(0);
  });

  it('returns interactions=null on invalid JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const onQuarantine = vi.fn();
    const llm = stubLlm('not json at all');

    const result = await enumerateSurface({ cwd, llmClient: llm, onQuarantine });

    expect(result.interactions).toBeNull();
    expect(onQuarantine).toHaveBeenCalledWith('not json at all', expect.stringContaining('JSON'));
  });

  it('returns interactions=null on schema validation failure', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const invalid = [{ id: 'UPPERCASE', type: 'button', file: 'x', name: 'y', module: 'z', rationale: 'r' }];
    const onQuarantine = vi.fn();
    const llm = stubLlm(JSON.stringify(invalid));

    const result = await enumerateSurface({ cwd, llmClient: llm, onQuarantine });

    expect(result.interactions).toBeNull();
    expect(onQuarantine).toHaveBeenCalled();
  });

  it('marks truncated=true and emits warn when file tree exceeds cap', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');
    // Create enough files to exceed a small artificial cap
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    for (let i = 0; i < 100; i++) {
      await writeFile(path.join(cwd, 'src', `f${i}.ts`), '// x');
    }

    const llm = stubLlm('[]');
    const result = await enumerateSurface({ cwd, llmClient: llm, maxTokens: 500 });

    expect(result.truncated).toBe(true);
  });
});
```

- [ ] **Step 6: Run, expect failure ("not implemented yet")**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'enumerateSurface'`
Expected: FAIL — error thrown

- [ ] **Step 7: Implement `enumerateSurface`**

Replace the `enumerateSurface` stub in `packages/cli/src/autopilot/interaction-discovery.ts` AND add helper functions at the bottom:

```ts
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
```

- [ ] **Step 8: Re-run tests**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'enumerateSurface'`
Expected: `4 passed`

- [ ] **Step 9: Typecheck**

Run: `cd packages/cli && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/autopilot/interaction-discovery.ts packages/cli/tests/interaction-discovery.test.ts
git commit -m "feat(cli/autopilot): interaction-discovery — Stage 1 surface enumeration

Adds InteractionSchema (Zod) + enumerateSurface() that walks the project,
loads up to 5 entry files, builds an LLM prompt biased toward inclusion
(per spec §5.2 rewritten rules), and returns parsed interactions or null
on parse/validation failure. Truncates file tree to fit the 50k token cap;
quarantines invalid LLM output via onQuarantine callback."
```

---

## Task 2: `generateContractFor` + concurrency pool

**Files:**
- Modify: `packages/cli/src/autopilot/interaction-discovery.ts` (add `generateContractFor` + `runPool`)
- Modify: `packages/cli/tests/interaction-discovery.test.ts` (add tests)

- [ ] **Step 1: Failing tests for `generateContractFor`**

Append to `packages/cli/tests/interaction-discovery.test.ts`:

```ts
import { generateContractFor } from '../src/autopilot/interaction-discovery.js';

describe('generateContractFor', () => {
  const sampleInteraction: Interaction = {
    id: 'btn-login-submit',
    type: 'button',
    file: 'app/login/page.tsx',
    name: 'Submit',
    module: 'auth',
    rationale: 'main login submit button',
  };

  it('returns proposals when LLM returns valid JSON array', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    await writeFile(
      path.join(cwd, 'app/login/page.tsx'),
      `// line 1\n// line 2\nexport default function Page() {\n  return <button>Submit</button>;\n}\n`,
    );
    const proposalYaml = 'id: INV-LOGIN-1\ntitle: t\narea: auth\nseverity: P0';
    const llm = stubLlm(JSON.stringify([
      {
        yaml: proposalYaml,
        confidence: 'high',
        module: 'auth',
        evidence: { sourceFiles: ['app/login/page.tsx'], rationale: 'r' },
      },
    ]));

    const result = await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.yaml).toBe(proposalYaml);
  });

  it('returns empty proposals when LLM returns []', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    await writeFile(path.join(cwd, 'app/login/page.tsx'), 'export {}');
    const llm = stubLlm('[]');

    const result = await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    expect(result.proposals).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('returns error when LLM returns invalid JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    await writeFile(path.join(cwd, 'app/login/page.tsx'), 'export {}');
    const llm = stubLlm('not json');

    const result = await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    expect(result.proposals).toEqual([]);
    expect(result.error).toMatch(/JSON/);
    expect(result.rawResponse).toBe('not json');
  });

  it('extracts 40+40 lines around the first match of interaction.name', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    const lines = Array.from({ length: 200 }, (_, i) => `// line ${i}`);
    lines[100] = '<button>Submit</button>';
    await writeFile(path.join(cwd, 'app/login/page.tsx'), lines.join('\n'));

    let receivedUserContent = '';
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async (opts) => {
        receivedUserContent = opts.messages[0]!.content;
        return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
      }),
    };

    await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    // Should include lines around line 100 (the match)
    expect(receivedUserContent).toContain('line 60');
    expect(receivedUserContent).toContain('line 100');
    expect(receivedUserContent).toContain('line 140');
    expect(receivedUserContent).not.toContain('line 0');
    expect(receivedUserContent).not.toContain('line 199');
  });
});
```

- [ ] **Step 2: Run, expect failure (`generateContractFor` not exported)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'generateContractFor'`
Expected: FAIL — function missing

- [ ] **Step 3: Implement `generateContractFor`**

Append to `packages/cli/src/autopilot/interaction-discovery.ts`:

```ts
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

  // Try matching by name first, then by id (kebab-case won't match much in source).
  let window = extractWindow(fileContent, [opts.interaction.name, opts.interaction.id]);

  // Truncate if window itself exceeds the per-call cap (preserve middle).
  if (estimateTokens(window) > maxTokens - 1000) {
    const lines = window.split('\n');
    const keep = Math.floor(lines.length * ((maxTokens - 1000) / estimateTokens(window)));
    const trimStart = Math.floor((lines.length - keep) / 2);
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
```

- [ ] **Step 4: Run, expect PASS (4 generateContractFor tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'generateContractFor'`
Expected: `4 passed`

- [ ] **Step 5: Failing test for `runPool` concurrency helper**

Append to `packages/cli/tests/interaction-discovery.test.ts`:

```ts
import { runPool } from '../src/autopilot/interaction-discovery.js';

describe('runPool', () => {
  it('processes all items respecting the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    const results = await runPool(items, 4, async (i) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i * 2;
    });

    expect(results).toEqual(items.map((i) => i * 2));
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);  // proves concurrency was actually used
  });

  it('continues processing when an individual item throws', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runPool(items, 2, async (i) => {
      if (i === 3) throw new Error('boom');
      return i;
    });
    // Errors become null in the results array; other items still complete.
    expect(results[0]).toBe(1);
    expect(results[1]).toBe(2);
    expect(results[2]).toBeNull();
    expect(results[3]).toBe(4);
    expect(results[4]).toBe(5);
  });
});
```

- [ ] **Step 6: Run, expect failure (`runPool` missing)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'runPool'`
Expected: FAIL — function missing

- [ ] **Step 7: Implement `runPool`**

Append to `packages/cli/src/autopilot/interaction-discovery.ts`:

```ts
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
```

- [ ] **Step 8: Run, expect PASS (2 runPool tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'runPool'`
Expected: `2 passed`

- [ ] **Step 9: Typecheck + run all tests in the file**

```bash
cd packages/cli && pnpm exec tsc --noEmit
cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts
```
Expected: typecheck clean; ~13 tests pass (3 schema + 4 enumerate + 4 generate + 2 pool).

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/autopilot/interaction-discovery.ts packages/cli/tests/interaction-discovery.test.ts
git commit -m "feat(cli/autopilot): interaction-discovery — Stage 2 contract gen + pool

Adds generateContractFor() that extracts a 40+40 line window around the
interaction's name in its file, prompts the LLM with the per-interaction
spec from §6.2, parses the response into ContractProposal[]. Adds runPool()
for bounded concurrency; individual failures become null in the results
array without breaking the batch."
```

---

## Task 3: `buildExistingIndex` + `mergeContracts` (Stage 3)

**Files:**
- Modify: `packages/cli/src/autopilot/interaction-discovery.ts` (add Stage 3 functions)
- Modify: `packages/cli/tests/interaction-discovery.test.ts` (add tests)

- [ ] **Step 1: Failing tests for `buildExistingIndex`**

Append to `packages/cli/tests/interaction-discovery.test.ts`:

```ts
import { buildExistingIndex, mergeContracts, contentHash, parseContract } from '../src/autopilot/interaction-discovery.js';

describe('buildExistingIndex', () => {
  it('returns empty maps when qa/contracts does not exist', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'idx-'));
    const idx = await buildExistingIndex(cwd);
    expect(idx.byId.size).toBe(0);
    expect(idx.byHash.size).toBe(0);
  });

  it('indexes all yaml files under qa/contracts recursively', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'idx-'));
    await mkdir(path.join(cwd, 'qa/contracts/auth'), { recursive: true });
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/auth/login.yml'),
      'id: INV-AUTH-LOGIN\ntitle: t\nactions: []\nexpected: {}\n',
    );
    await writeFile(
      path.join(cwd, 'qa/contracts/core/feed.yaml'),
      'id: INV-CORE-FEED\ntitle: t\nactions: []\nexpected: {}\n',
    );

    const idx = await buildExistingIndex(cwd);

    expect(idx.byId.size).toBe(2);
    expect(idx.byId.has('INV-AUTH-LOGIN')).toBe(true);
    expect(idx.byId.has('INV-CORE-FEED')).toBe(true);
    expect(idx.byHash.size).toBe(2);
  });

  it('skips malformed yaml without throwing', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'idx-'));
    await mkdir(path.join(cwd, 'qa/contracts'), { recursive: true });
    await writeFile(path.join(cwd, 'qa/contracts/broken.yml'), 'this is: not [valid yaml');
    await writeFile(
      path.join(cwd, 'qa/contracts/good.yml'),
      'id: INV-GOOD\ntitle: t\nactions: []\nexpected: {}\n',
    );

    const idx = await buildExistingIndex(cwd);
    expect(idx.byId.has('INV-GOOD')).toBe(true);
    expect(idx.byId.size).toBe(1);
  });
});

describe('contentHash', () => {
  it('produces same hash regardless of key order in nested objects', () => {
    const a = { actions: [{ type: 'goto', path: '/x' }], expected: { url: '/y' }, title: 't' };
    const b = { title: 't', expected: { url: '/y' }, actions: [{ type: 'goto', path: '/x' }] };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('omits id from the hash', () => {
    const a = { id: 'INV-1', actions: [], expected: {} };
    const b = { id: 'INV-2', actions: [], expected: {} };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('changes when actions differ', () => {
    const a = { id: 'x', actions: [{ type: 'goto', path: '/a' }], expected: {} };
    const b = { id: 'x', actions: [{ type: 'goto', path: '/b' }], expected: {} };
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});
```

- [ ] **Step 2: Run, expect failure (functions missing)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'buildExistingIndex|contentHash'`
Expected: FAIL — functions not exported

- [ ] **Step 3: Install `yaml` package availability check**

```bash
cd packages/cli && node -e "console.log(require.resolve('yaml'))" 2>&1 | head -1
```
Expected: a path. If not installed, add it: `pnpm add yaml` from the `packages/cli/` dir.

- [ ] **Step 4: Implement `buildExistingIndex` + `contentHash` + `parseContract`**

Append to `packages/cli/src/autopilot/interaction-discovery.ts`:

```ts
import { parse as yamlParse } from 'yaml';
import { createHash } from 'node:crypto';

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
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await rec(full);
      } else if (e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml'))) {
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
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8');
      const parsed = parseContract(content);
      const hash = contentHash(parsed);
      const meta: ExistingContractMeta = { id: parsed.id, filePath, contentHash: hash };
      byId.set(parsed.id, meta);
      byHash.set(hash, meta);
    } catch {
      // skip malformed silently — they won't dedup but also won't block
    }
  }
  return { byId, byHash };
}
```

- [ ] **Step 5: Run, expect PASS (3 buildExistingIndex + 3 contentHash tests)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'buildExistingIndex|contentHash'`
Expected: `6 passed`

- [ ] **Step 6: Failing tests for `mergeContracts`**

Append to `packages/cli/tests/interaction-discovery.test.ts`:

```ts
describe('mergeContracts', () => {
  const interaction: Interaction = {
    id: 'btn-x',
    type: 'button',
    file: 'app/x.tsx',
    name: 'X',
    module: 'core',
    rationale: 'r',
  };

  const proposal = (id: string, area: string, action: string = '/x'): ContractProposal => ({
    yaml: `id: ${id}\ntitle: t\narea: ${area}\nactions:\n  - {type: goto, path: ${action}}\nexpected:\n  url: { matches: "${action}" }\n`,
    confidence: 'high',
    module: area,
    evidence: { sourceFiles: ['app/x.tsx'], rationale: 'r' },
  });

  it('writes a new contract when nothing exists', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-NEW-1', 'core') }],
    });

    expect(result.written).toHaveLength(1);
    expect(result.written[0]).toBe(path.join(cwd, 'qa/contracts/core/INV-NEW-1.yml'));
    expect(result.skipped).toHaveLength(0);
  });

  it('Layer 1 — skips on id collision with existing', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/core/INV-DUPE.yml'),
      'id: INV-DUPE\ntitle: existing\nactions: []\nexpected: {}\n',
    );

    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-DUPE', 'core', '/different') }],
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'INV-DUPE', reason: expect.stringContaining('id collision') });
  });

  it('Layer 2 — skips on content hash duplicate (different id, same content)', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/core/INV-A.yml'),
      'id: INV-A\ntitle: t\nactions:\n  - {type: goto, path: /x}\nexpected:\n  url: { matches: "/x" }\n',
    );

    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-B', 'core') }],
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'INV-B', reason: expect.stringContaining('content duplicate') });
  });

  it('Layer 3 — skips when target file already exists (race-safety)', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    // Index does NOT see this file (it's added after buildExistingIndex would scan):
    // Simulate by writing a file that won't be in the in-memory index because we'll
    // intentionally place it AFTER mergeContracts builds the index. For this unit
    // test, we put a syntactically-broken file so it's skipped by buildExistingIndex
    // but still exists on disk.
    await writeFile(path.join(cwd, 'qa/contracts/core/INV-RACE.yml'), '[not valid yaml');

    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-RACE', 'core', '/race') }],
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'INV-RACE', reason: expect.stringContaining('file exists') });
  });

  it('writes generated-by frontmatter on written files', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-FRONTMATTER', 'core') }],
    });
    const written = await readFile(path.join(cwd, 'qa/contracts/core/INV-FRONTMATTER.yml'), 'utf8');
    expect(written).toContain('# generated-by: deep-discovery v1');
    expect(written).toContain('# interaction: btn-x (button)');
  });

  it('stops at maxContracts cap and emits cap-reached event', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    const events: MergeEvent[] = [];
    const proposals = Array.from({ length: 5 }, (_, i) => ({
      interaction,
      proposal: proposal(`INV-CAP-${i}`, 'core', `/${i}`),
    }));

    const result = await mergeContracts({
      cwd,
      proposals,
      maxContracts: 3,
      onEvent: (e) => events.push(e),
    });

    expect(result.written).toHaveLength(3);
    expect(result.hitCap).toBe(true);
    expect(events.find((e) => e.type === 'cap-reached')).toBeDefined();
  });

  it('falls back to interaction.module when contract YAML has no area', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    const noArea: ContractProposal = {
      yaml: 'id: INV-NO-AREA\ntitle: t\nactions: []\nexpected: {}\n',
      confidence: 'high',
      module: 'mod-x',
      evidence: { sourceFiles: [], rationale: 'r' },
    };
    await mergeContracts({ cwd, proposals: [{ interaction, proposal: noArea }] });
    expect(
      await readFile(path.join(cwd, 'qa/contracts/core/INV-NO-AREA.yml'), 'utf8').catch(() => null),
    ).not.toBeNull();
    // interaction.module is 'core' → falls back to that
  });
});
```

- [ ] **Step 7: Run, expect failure (mergeContracts missing)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'mergeContracts'`
Expected: FAIL

- [ ] **Step 8: Implement `mergeContracts`**

Append to `packages/cli/src/autopilot/interaction-discovery.ts`:

```ts
import { mkdir, writeFile, access } from 'node:fs/promises';

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
      skipped.push({ id: '(unparseable)', reason: `parse failed: ${(err as Error).message}` });
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
      await writeFile(targetPath, `${frontmatter}\n${proposal.yaml}`);
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
```

- [ ] **Step 9: Run, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'mergeContracts'`
Expected: `7 passed`

- [ ] **Step 10: Run all interaction-discovery tests + typecheck**

```bash
cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts
cd packages/cli && pnpm exec tsc --noEmit
```
Expected: ~22 tests pass (3 schema + 4 enumerate + 4 generate + 2 pool + 3 index + 3 hash + 7 merge); typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add packages/cli/src/autopilot/interaction-discovery.ts packages/cli/tests/interaction-discovery.test.ts
git commit -m "feat(cli/autopilot): interaction-discovery — Stage 3 incremental merge

Adds buildExistingIndex (walks qa/contracts/**/*.{yml,yaml}, indexes by id
and content hash), contentHash (sha256 of stable-stringified parsed YAML
minus id), and mergeContracts (3-layer dedup per spec §7: id collision,
content duplicate, file-exists race guard; writes generated-by frontmatter;
respects deepMaxContracts cap)."
```

---

## Task 4: `discoverByInteraction` orchestrator + fallback

**Files:**
- Modify: `packages/cli/src/autopilot/interaction-discovery.ts` (add orchestrator)
- Modify: `packages/cli/tests/interaction-discovery.test.ts` (add tests)

- [ ] **Step 1: Failing tests for `discoverByInteraction`**

Append to `packages/cli/tests/interaction-discovery.test.ts`:

```ts
import { discoverByInteraction, type DiscoveryEvent } from '../src/autopilot/interaction-discovery.js';

describe('discoverByInteraction', () => {
  it('happy path: enumerate → generate → merge → returns counts', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app/page.tsx'), '<button>X</button>');

    let callCount = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // Stage 1
          return {
            content: JSON.stringify([
              { id: 'btn-app-x', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        // Stage 2
        return {
          content: JSON.stringify([
            {
              yaml: 'id: INV-ORCH-1\ntitle: t\nactions: []\nexpected: {}\n',
              confidence: 'high',
              module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' },
            },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const result = await discoverByInteraction({
      cwd,
      llmClient: llm,
      signal: new AbortController().signal,
    });

    expect(result.interactionsFound).toBe(1);
    expect(result.contractsWritten).toBe(1);
    expect(result.fallbackUsed).toBe(false);
  });

  it('falls back to discoverByModule when Stage 1 returns invalid JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => ({ content: 'not json', usage: { inputTokens: 0, outputTokens: 0 } })),
    };

    const events: DiscoveryEvent[] = [];
    const result = await discoverByInteraction({
      cwd,
      llmClient: llm,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toMatch(/surface enumeration/i);
    expect(events.find((e) => e.type === 'log' && e.level === 'error')).toBeDefined();
  });

  it('continues when some interactions fail in Stage 2', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app/page.tsx'), '<button>X</button>');

    let callCount = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify([
              { id: 'btn-a', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
              { id: 'btn-b', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        if (callCount === 2) return { content: 'broken', usage: { inputTokens: 0, outputTokens: 0 } };
        return {
          content: JSON.stringify([
            { yaml: 'id: INV-OK\ntitle: t\nactions: []\nexpected: {}\n', confidence: 'high', module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' } },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const result = await discoverByInteraction({
      cwd, llmClient: llm, signal: new AbortController().signal, concurrency: 1,
    });

    expect(result.interactionsFound).toBe(2);
    expect(result.contractsWritten).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect failure (function missing)**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'discoverByInteraction'`
Expected: FAIL

- [ ] **Step 3: Implement `discoverByInteraction` (orchestrator with fallback)**

Append to `packages/cli/src/autopilot/interaction-discovery.ts`:

```ts
import { discoverByModule } from './llm-discovery.js';
import { assembleTargetContext } from './bootstrap.js';

const DEFAULT_CONCURRENCY = 4;

async function fallbackToModuleDiscovery(
  opts: DiscoverByInteractionOptions,
  reason: string,
): Promise<DiscoverByInteractionResult> {
  opts.onEvent?.({
    type: 'log',
    level: 'error',
    message: `[deep] ${reason}; falling back to module discovery`,
  });
  let written = 0;
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
            id: 'fallback', type: 'button', file: '', name: 'fallback',
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
      onQuarantine: (raw, reason) => {
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
      message: `[deep] file tree exceeded 50k cap, truncated; consider chunking by top-level dir`,
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
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts -t 'discoverByInteraction'`
Expected: `3 passed`

- [ ] **Step 5: Run all tests + typecheck**

```bash
cd packages/cli && pnpm exec vitest run tests/interaction-discovery.test.ts
cd packages/cli && pnpm exec tsc --noEmit
```
Expected: ~25 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/autopilot/interaction-discovery.ts packages/cli/tests/interaction-discovery.test.ts
git commit -m "feat(cli/autopilot): interaction-discovery — orchestrator + fallback

Adds discoverByInteraction which chains enumerateSurface → runPool of
generateContractFor → mergeContracts, with structured DiscoveryEvent
progress callbacks. On Stage 1 failure (invalid JSON, 0 interactions, or
exception) falls back to discoverByModule so the user always gets some
contracts. Stage 2 per-interaction failures are surfaced as warn events
but don't block the batch."
```

---

## Task 5: Wire `discoveryMode` into `autopilot.ts`

**Files:**
- Modify: `packages/cli/src/commands/autopilot.ts`

- [ ] **Step 1: Add `discoveryMode` etc. to `AutopilotOptions`**

In `packages/cli/src/commands/autopilot.ts`, find the `export interface AutopilotOptions` block. Add three optional fields:

```ts
export interface AutopilotOptions {
  // ... all existing fields stay
  /**
   * Phase B discovery strategy. 'modules' (default) uses the existing
   * hardcoded 3-module × 3-8 cap. 'deep' uses LLM-driven surface enumeration
   * targeting 1 contract per interaction.
   */
  discoveryMode?: 'modules' | 'deep';
  /** Concurrency for Stage 2 LLM calls in deep mode. Default 4. */
  deepConcurrency?: number;
  /** Hard cap on contracts generated in a single deep run. Default 500. */
  deepMaxContracts?: number;
}
```

- [ ] **Step 2: Branch Phase B on `discoveryMode`**

Find the Phase B block in `autopilot.ts` (search for `discoverByModule`). It currently looks like:

```ts
await discoverByModule(ctx, llmClient, async (module, proposals) => {
  // ... existing logic writes contracts via writeIssueEvidence path
}, abortController.signal);
```

Wrap the dispatch:

```ts
if (opts.discoveryMode === 'deep') {
  emit({ type: 'log', level: 'info', message: '[autopilot] Phase B using deep (interaction-driven) discovery', elapsedMs: elapsed() });
  const { discoverByInteraction } = await import('../autopilot/interaction-discovery.js');
  const result = await discoverByInteraction({
    cwd: opts.cwd,
    llmClient,
    signal: abortController.signal,
    concurrency: opts.deepConcurrency,
    maxContracts: opts.deepMaxContracts,
    onEvent: (e) => {
      if (e.type === 'log') {
        emit({ type: 'log', level: e.level, message: e.message, elapsedMs: elapsed() });
      } else if (e.type === 'progress') {
        emit({
          type: 'phase',
          phase: 'B',
          status: 'active',
          elapsedMs: elapsed(),
          counters: { generated: e.done },
        });
      } else if (e.type === 'stage') {
        const msg = `[autopilot] deep discovery ${e.stage}: ${e.status}`;
        emit({ type: 'log', level: 'info', message: msg, elapsedMs: elapsed() });
      }
    },
  });
  // The deep path writes contracts directly to disk. Skip the per-module
  // callback that the modules path uses. Phase B counters reflect generated
  // contracts:
  phaseB.generated += result.contractsWritten;
  if (result.fallbackUsed) {
    emit({ type: 'log', level: 'warn', message: `[autopilot] deep fell back: ${result.fallbackReason}`, elapsedMs: elapsed() });
  }
} else {
  // existing modules path — unchanged below
  await discoverByModule(ctx, llmClient, async (module, proposals) => {
    // ... existing code stays here verbatim
  }, abortController.signal);
}
```

(The existing in-place flow in the `else` branch must be left byte-identical to what was there before — only wrap it with the if/else.)

- [ ] **Step 3: Regression test — existing autopilot.test.ts still passes**

```bash
cd packages/cli && pnpm exec vitest run tests/commands/autopilot.test.ts
```
Expected: all existing tests pass; no behavior change for `discoveryMode` undefined.

- [ ] **Step 4: Add integration test for deep mode**

Create or append to `packages/cli/tests/autopilot-deep-discovery.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAutopilot } from '../src/commands/autopilot.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';

describe('runAutopilot discoveryMode=deep', () => {
  let cwd = '';
  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  });

  it('routes Phase B through deep discovery; existing tests unaffected when omitted', async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'deep-mode-'));
    await writeFile(path.join(cwd, 'package.json'), '{"name":"x"}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app/page.tsx'), 'export default () => <button>X</button>');

    let callIdx = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          return {
            content: JSON.stringify([
              { id: 'btn-x', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return {
          content: JSON.stringify([
            { yaml: 'id: INV-DEEP\ntitle: t\nactions: []\nexpected: {}\n', confidence: 'high', module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' } },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const report = await runAutopilot({
      cwd,
      timeBudgetMs: 30_000,
      fix: false,  // skip Phase C to keep this test focused
      yes: true,
      regenerate: true,
      discoveryMode: 'deep',
      llmClient: llm,
    });

    // Should have written at least 1 contract via deep flow
    const written = await readFile(path.join(cwd, 'qa/contracts/app/INV-DEEP.yml'), 'utf8').catch(() => '');
    expect(written).toContain('id: INV-DEEP');
    expect(report.phaseB?.generated).toBeGreaterThan(0);
  }, 30_000);
});
```

- [ ] **Step 5: Run, expect PASS**

```bash
cd packages/cli && pnpm exec vitest run tests/autopilot-deep-discovery.test.ts
```
Expected: 1 passed.

- [ ] **Step 6: Typecheck**

```bash
cd packages/cli && pnpm exec tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/autopilot.ts packages/cli/tests/autopilot-deep-discovery.test.ts
git commit -m "feat(cli): autopilot discoveryMode=deep routes Phase B to interaction discovery

discoveryMode defaults to 'modules' (no behavior change for existing
callers). When 'deep', Phase B calls discoverByInteraction which writes
contracts directly to qa/contracts/<area>/. Progress events bridge to the
existing emit() so the Dashboard's Phase B progress bar updates per
interaction processed."
```

---

## Task 6: CLI flags

**Files:**
- Modify: `packages/cli/bin/contractqa.ts`

- [ ] **Step 1: Add three Commander options on the `autopilot` command**

In `packages/cli/bin/contractqa.ts`, find the `.command('autopilot')` block. Insert the new options after `--regression-scope`:

```ts
  .option('--discovery-mode <mode>', 'Phase B discovery: modules (default) or deep (1 contract per interaction)', 'modules')
  .option('--deep-concurrency <n>', 'Concurrent LLM calls in deep Stage 2 (default 4)', '4')
  .option('--deep-max-contracts <n>', 'Hard cap on contracts generated per deep run (default 500)', '500')
```

- [ ] **Step 2: Forward to `runAutopilot` in the action handler**

In the same command's `.action(async (opts) => { ... })`, extend the opts type:

```ts
.action(async (opts: {
  timeBudget: string;
  fix: boolean;
  yes?: boolean;
  regenerate?: boolean;
  regressionScope?: string;
  watch?: boolean;
  watchDebounce?: string;
  dashboardUrl?: string;
  autoPr?: boolean;
  discoveryMode?: string;
  deepConcurrency?: string;
  deepMaxContracts?: string;
}) => {
```

And in `baseOpts`:

```ts
const baseOpts = {
  cwd: process.cwd(),
  timeBudgetMs: Number(opts.timeBudget),
  fix: opts.fix,
  yes: opts.yes,
  regenerate: opts.regenerate,
  regressionScope: opts.regressionScope as ('one' | 'touched-files' | 'all' | undefined),
  discoveryMode: (opts.discoveryMode === 'deep' ? 'deep' : 'modules') as 'modules' | 'deep',
  deepConcurrency: Number(opts.deepConcurrency ?? '4'),
  deepMaxContracts: Number(opts.deepMaxContracts ?? '500'),
};
```

- [ ] **Step 3: Validate `--discovery-mode` accepts only known values**

Right after `baseOpts` construction (before the `if (!opts.watch)` branch), add a guard:

```ts
if (opts.discoveryMode && opts.discoveryMode !== 'modules' && opts.discoveryMode !== 'deep') {
  console.error(`Invalid --discovery-mode: ${opts.discoveryMode}. Must be 'modules' or 'deep'.`);
  process.exit(2);
}
```

- [ ] **Step 4: Rebuild + smoke test**

```bash
cd packages/cli && pnpm exec tsc --build
node packages/cli/dist/bin/contractqa.js autopilot --help | grep -E "discovery-mode|deep-"
```
Expected: 3 flags listed.

```bash
node packages/cli/dist/bin/contractqa.js autopilot --discovery-mode invalid 2>&1 | head -3
echo "exit=$?"
```
Expected: error message + exit 2.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/bin/contractqa.ts
git commit -m "feat(cli): --discovery-mode / --deep-concurrency / --deep-max-contracts flags

3 new flags on \`contractqa autopilot\`. Default --discovery-mode=modules
preserves current behavior. Invalid values exit 2 with a clear message."
```

---

## Task 7: Dashboard stream route — forward `discoveryMode`

**Files:**
- Modify: `apps/dashboard/app/launcher/stream/route.ts`

- [ ] **Step 1: Parse the new URL param**

In `apps/dashboard/app/launcher/stream/route.ts`, near the existing `const autoPrEnabled = url.searchParams.get('autoPr') === 'true';` line, add:

```ts
const discoveryMode = url.searchParams.get('discoveryMode') === 'deep' ? 'deep' : 'modules';
```

- [ ] **Step 2: Pass into `runAutopilot`**

Find the `runAutopilot({ ... })` call in `runOnce` (it currently passes `fixStrategy`, `shadowCoordinator`, `onProgress`, etc.). Add:

```ts
const report = await runAutopilot({
  cwd,
  fix: fixEnabled,
  yes: true,
  llmClient,
  fixStrategy: shadowCoordinator ? 'shadow' : 'inPlace',
  shadowCoordinator: shadowCoordinator ?? undefined,
  discoveryMode,                  // ← new
  onProgress: (event: AutopilotProgressEvent) => {
    if (event.type === 'phase' && event.counters) {
      phaseTotals[event.phase] = event.counters;
    }
    emit(event as LauncherEvent);
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Manual smoke test (dashboard already running on :3000)**

```bash
timeout 8 curl -sN "http://localhost:3000/launcher/stream?cwd=/tmp&fix=false&discoveryMode=deep" 2>&1 | head -20
```
Expected: at least one `event: log` line referencing `discoveryMode` or hitting the LLM. (If `/tmp` has no source, Stage 1 may return 0 → fallback warning surfaces.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/launcher/stream/route.ts
git commit -m "feat(dashboard/api): stream route forwards discoveryMode URL param to runAutopilot"
```

---

## Task 8: Dashboard UI — DEEP toggle + persistent errors banner

**Files:**
- Modify: `apps/dashboard/app/launcher/page.tsx`
- Modify: `apps/dashboard/app/launcher/launcher.module.css`

- [ ] **Step 1: Add `deepMode` + `errors` state to `LauncherPage`**

In `apps/dashboard/app/launcher/page.tsx`, find the `const [watchMode, setWatchMode] = useState(false);` line (around line 76). Add right below:

```ts
const [deepMode, setDeepMode] = useState(false);
const [errors, setErrors] = useState<Array<{ id: number; message: string }>>([]);
const errorIdRef = useRef(0);
```

- [ ] **Step 2: Modify `startRun` to (a) pass `discoveryMode`, (b) clear errors**

Find `const startRun = useCallback((mode: 'regular' | 'night-shift') => {`. Inside, after the existing state resets (`setRunning(true);`), add:

```ts
setErrors([]);  // a fresh run clears stale errors
```

Find the `URLSearchParams` construction. Add a line for deep mode:

```ts
const params = new URLSearchParams({
  cwd: detection.resolvedPath,
  fix: 'true',
});
if (isContinuous) params.set('watch', 'true');
if (mode === 'night-shift') params.set('autoPr', 'true');
if (deepMode) params.set('discoveryMode', 'deep');  // ← new
const url = `/launcher/stream?${params.toString()}`;
```

- [ ] **Step 3: Accumulate `level: 'error'` log events into the persistent errors state**

Find the `es.addEventListener('log', (ev) => {` handler. Replace it with:

```ts
es.addEventListener('log', (ev) => {
  const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'log' }>;
  setLogs((prev) => [...prev.slice(-9), { message: data.message, level: data.level }]);
  if (data.level === 'error') {
    const id = ++errorIdRef.current;
    setErrors((prev) => [...prev, { id, message: data.message }]);
  }
});
```

- [ ] **Step 4: Add the DEEP toggle next to the WATCH toggle**

Find the existing WATCH toggle JSX (search for `re-run on file change`). Right after that closing `</label>`, add:

```tsx
<label className={s.toggle} title="Scan all UI/API surfaces, 1 contract per interaction. 5-15 min, ~$3-5 LLM.">
  <input
    type="checkbox"
    className={s.toggleInput}
    checked={deepMode}
    onChange={(e) => setDeepMode(e.target.checked)}
    disabled={running}
  />
  <span className={s.toggleSwitch} aria-hidden />
  <span className={s.toggleLabel}>DEEP</span>
  <span className={s.toggleSubLabel}>discover all interactions</span>
</label>
```

- [ ] **Step 5: Render the persistent errors banner**

Find the `{showProgress && (` block (around the progress section). Just BEFORE that block, add:

```tsx
{errors.length > 0 && (
  <section className={s.errorsBanner} aria-label="Errors during this session">
    <header>
      <strong>{errors.length} error{errors.length === 1 ? '' : 's'}</strong>
      <button type="button" className={s.errorsClear} onClick={() => setErrors([])}>
        Clear
      </button>
    </header>
    <ul>
      {errors.map((e) => (
        <li key={e.id}>{e.message}</li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 6: Add CSS for the errors banner**

In `apps/dashboard/app/launcher/launcher.module.css`, append:

```css
.errorsBanner {
  border: 1px solid var(--error, #b94c4c);
  background: rgba(185, 76, 76, 0.08);
  border-radius: 2px;
  padding: var(--s-3, 12px);
  margin: var(--s-3, 12px) 0;
}
.errorsBanner header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 12px;
  margin-bottom: var(--s-2, 8px);
}
.errorsBanner ul {
  margin: 0;
  padding-left: var(--s-4, 16px);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}
.errorsBanner li {
  margin-bottom: var(--s-1, 4px);
  word-break: break-word;
}
.errorsClear {
  background: transparent;
  border: 1px solid var(--border, #26262b);
  color: var(--muted);
  padding: 2px 8px;
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
}
.errorsClear:hover {
  color: var(--text);
  border-color: var(--text);
}
```

If `--error` isn't in globals.css, use a literal: replace `var(--error, #b94c4c)` with `#b94c4c`.

- [ ] **Step 7: Typecheck**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```
Expected: clean.

- [ ] **Step 8: Visual smoke test via gstack-browse (or manual)**

The dev server should auto-reload. Take a screenshot:

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto http://localhost:3000/launcher && sleep 1 && $B screenshot /tmp/launcher-deep-toggle.png
```

Verify: the DEEP toggle appears next to WATCH; no rendering errors.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/app/launcher/page.tsx apps/dashboard/app/launcher/launcher.module.css
git commit -m "feat(dashboard/ui): DEEP toggle + persistent errors banner

DEEP toggle next to WATCH in the launcher's What-to-run row. When ON, all
three primary buttons (Run/Watch/夜班) send discoveryMode=deep to the
stream route. Persistent errors banner accumulates level=error log events
above the trimming logs panel; cleared on user Clear button or fresh run
start (so a successful re-run wipes stale errors)."
```

---

## Task 9: Integration test with fixture project

**Files:**
- Create: `packages/cli/tests/fixtures/interaction-discovery/` (3 files)
- Create or append: `packages/cli/tests/interaction-discovery-integration.test.ts`

- [ ] **Step 1: Create the fixture project**

```bash
mkdir -p packages/cli/tests/fixtures/interaction-discovery/app/login
mkdir -p packages/cli/tests/fixtures/interaction-discovery/api/runs

cat > packages/cli/tests/fixtures/interaction-discovery/package.json <<'EOF'
{ "name": "fixture", "version": "1.0.0" }
EOF

cat > packages/cli/tests/fixtures/interaction-discovery/app/page.tsx <<'EOF'
export default function Home() {
  return <button onClick={() => alert('hi')}>Greet</button>;
}
EOF

cat > packages/cli/tests/fixtures/interaction-discovery/app/login/page.tsx <<'EOF'
export default function Login() {
  return (
    <form action="/api/login" method="post">
      <input name="email" type="email" />
      <button type="submit">Sign in</button>
    </form>
  );
}
EOF

cat > packages/cli/tests/fixtures/interaction-discovery/api/runs/route.ts <<'EOF'
export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ id: 'r1', body });
}
EOF
```

- [ ] **Step 2: Failing integration test**

Create `packages/cli/tests/interaction-discovery-integration.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, cp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverByInteraction } from '../src/autopilot/interaction-discovery.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';

const FIXTURE = path.join(__dirname, 'fixtures/interaction-discovery');

describe('discoverByInteraction integration', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'deep-fixture-'));
    await cp(FIXTURE, cwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  });

  it('walks fixture, enumerates 3 interactions, writes 3 contracts', async () => {
    let callIdx = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          // Stage 1: 3 interactions matching the fixture
          return {
            content: JSON.stringify([
              { id: 'btn-app-greet', type: 'button', file: 'app/page.tsx', name: 'Greet', module: 'app', rationale: 'main CTA' },
              { id: 'form-login-signin', type: 'form', file: 'app/login/page.tsx', name: 'Sign in', module: 'auth', rationale: 'login form' },
              { id: 'api-runs-post', type: 'api-endpoint', file: 'api/runs/route.ts', name: 'POST /api/runs', module: 'api', route: '/api/runs', rationale: 'create run' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        // Stage 2: 1 proposal per interaction with unique id
        const id = `INV-${callIdx - 1}`;
        const area = callIdx === 2 ? 'app' : callIdx === 3 ? 'auth' : 'api';
        return {
          content: JSON.stringify([
            {
              yaml: `id: ${id}\ntitle: t-${id}\narea: ${area}\nactions:\n  - {type: goto, path: /${callIdx}}\nexpected:\n  url: { matches: "/${callIdx}" }\n`,
              confidence: 'high',
              module: area,
              evidence: { sourceFiles: [], rationale: 'r' },
            },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const result = await discoverByInteraction({
      cwd,
      llmClient: llm,
      signal: new AbortController().signal,
      concurrency: 1,  // deterministic ordering for callIdx assertions
    });

    expect(result.interactionsFound).toBe(3);
    expect(result.contractsWritten).toBe(3);
    expect(result.fallbackUsed).toBe(false);

    // Verify the 3 YAMLs landed at expected paths
    const appFiles = await readdir(path.join(cwd, 'qa/contracts/app'));
    const authFiles = await readdir(path.join(cwd, 'qa/contracts/auth'));
    const apiFiles = await readdir(path.join(cwd, 'qa/contracts/api'));
    expect(appFiles).toContain('INV-1.yml');
    expect(authFiles).toContain('INV-2.yml');
    expect(apiFiles).toContain('INV-3.yml');

    // Verify generated-by frontmatter
    const written = await readFile(path.join(cwd, 'qa/contracts/app/INV-1.yml'), 'utf8');
    expect(written).toContain('# generated-by: deep-discovery v1');
    expect(written).toContain('# interaction: btn-app-greet');
  });

  it('re-run produces 0 new contracts (dedup works)', async () => {
    // Same LLM stub as above — first run writes, second should skip all 3
    let callIdx = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1 || callIdx === 5) {
          // Stage 1 of each run
          return {
            content: JSON.stringify([
              { id: 'btn-x', type: 'button', file: 'app/page.tsx', name: 'Greet', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return {
          content: JSON.stringify([
            { yaml: 'id: INV-DEDUPE\ntitle: t\nactions: []\nexpected: {}\n', confidence: 'high', module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' } },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const first = await discoverByInteraction({ cwd, llmClient: llm, signal: new AbortController().signal, concurrency: 1 });
    expect(first.contractsWritten).toBe(1);

    // Run again — should write 0
    callIdx = 4;  // reset so callIdx === 5 hits Stage 1 again
    const second = await discoverByInteraction({ cwd, llmClient: llm, signal: new AbortController().signal, concurrency: 1 });
    expect(second.contractsWritten).toBe(0);
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
cd packages/cli && pnpm exec vitest run tests/interaction-discovery-integration.test.ts
```
Expected: 2 passed.

- [ ] **Step 4: Typecheck**

```bash
cd packages/cli && pnpm exec tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/tests/fixtures/interaction-discovery packages/cli/tests/interaction-discovery-integration.test.ts
git commit -m "test(cli/autopilot): interaction-discovery integration test with fixture

3-file fixture (Home button, Login form, POST /api/runs handler). Stubbed
LLM returns 3 interactions + 1 proposal each → verifies all 3 contracts
land at the correct directories with the generated-by frontmatter, and
that re-running produces 0 new contracts (dedup proof)."
```

---

## Self-Review Checklist

Run through this AFTER all 9 tasks land:

- [ ] Every step has actual code (no TBD / "add error handling" / "similar to Task N")
- [ ] Type names consistent: `Interaction`, `EnumerateSurfaceResult`, `MergeContractsInput`, `DiscoveryEvent`, `AutopilotOptions.discoveryMode`
- [ ] Spec §5.2 prompt wording (Bias-toward-inclusion) is in Task 1 Step 7's `buildSystemPrompt` verbatim
- [ ] Spec §7.2 hash is full-parsed-minus-id (Task 3 Step 4's `contentHash`)
- [ ] Spec §7.3 directory derives from `parsed.area ?? interaction.module` (Task 3 Step 8's `mergeContracts`)
- [ ] Spec §5.1.1 truncation is implemented (Task 1 Step 7's `enumerateSurface`)
- [ ] Spec §8 error matrix: all 8 rows covered across enumerate/generate/merge implementations
- [ ] Spec §3.3 persistent errors banner is implemented (Task 8 Step 5)
- [ ] Default `--discovery-mode modules` preserves old behavior (Task 5 Step 2 if/else branch)
- [ ] CLI rejects invalid `--discovery-mode` with exit 2 (Task 6 Step 3)
- [ ] DEEP toggle on dashboard sends `&discoveryMode=deep` (Task 8 Step 2)

---

## Final smoke test

After all commits:

```bash
# Rebuild everything
pnpm -r --filter './packages/**' build

# Apply the deep mode CLI on the contractqa repo itself (dry-friendly because
# you can interrupt with Ctrl-C; or use a small disposable repo):
ANTHROPIC_API_KEY=sk-ant-... contractqa autopilot \
  --discovery-mode deep \
  --deep-max-contracts 20 \
  --no-fix

# Or via dashboard:
#   1. Toggle DEEP on
#   2. Click ▶ Run autopilot
#   3. Watch Phase B counter climb; check qa/contracts/<module>/ for new files
```

Expected:
- Stage 1 enumerates ~50-150 interactions (depending on project)
- Stage 2 generates ~50-100 contracts after dedup
- All written files carry `# generated-by: deep-discovery v1` header
- Phase B counter in Dashboard reflects `generated` count growing
- Errors (if any) appear in the persistent errors banner above the trimming logs panel
