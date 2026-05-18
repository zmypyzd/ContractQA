# Interaction-Driven Contract Discovery

**Date:** 2026-05-18
**Status:** Draft (pending review)
**Author:** ContractQA team
**Tracks design from:** brainstorming session 2026-05-18

---

## 1. Goal

Replace the current hardcoded module list (`['auth', 'core', 'admin']`) capping
discovery at **9-24 contracts** with an **interaction-driven discovery** that:

1. Lets an LLM read the whole project source code to enumerate every user-triggerable interaction (button, form, route, API endpoint).
2. Generates **1 contract per meaningful interaction** (target: 1:1 surface coverage — 100-300 contracts for a medium project).
3. **Merges incrementally** with existing contracts — never overwrites the user's hand-written invariants.
4. Surfaces all errors prominently (CLI stdout + Dashboard persistent error banner) so silent failures cannot hide.

Today's `discoverByModule` (`packages/cli/src/autopilot/llm-discovery.ts:141`) stays in place as the default; the new path is opt-in via `--discovery-mode deep`.

## 2. Non-goals

- **Not removing the existing `discoverByModule` path.** It stays as the default (fast, cheap, conservative). Deep mode is opt-in.
- **Not a static AST scanner.** The user explicitly chose LLM-driven over static analysis (which would require per-framework AST visitors).
- **Not a runtime Playwright crawler.** Same reason — out of scope this iteration.
- **Not merging *into* existing contracts.** New proposals that collide with existing contracts are dropped, not merged.
- **Not changing Phase A (smoke) or Phase C (auto-fix).** Both stay verbatim.
- **Not changing the night-shift button flow** — deep mode is orthogonal to the auto-PR feature.

## 3. User-facing surface

### 3.1 CLI

```bash
# Existing behavior (default — unchanged):
contractqa autopilot --watch

# New: deep discovery mode (interaction-driven):
contractqa autopilot --discovery-mode deep
contractqa autopilot --watch --auto-pr --discovery-mode deep \
  --deep-concurrency 6 \
  --deep-max-contracts 500
```

Three additive flags:

| Flag | Default | Meaning |
|---|---|---|
| `--discovery-mode <modules\|deep>` | `modules` | `modules` = existing `discoverByModule`. `deep` = new `discoverByInteraction`. |
| `--deep-concurrency <N>` | `4` | Concurrent per-interaction LLM calls in Stage 2. |
| `--deep-max-contracts <N>` | `500` | Hard cap on contracts generated in a single run; stops cleanly when reached. |

When `--discovery-mode modules` (default), the other two flags are ignored.

### 3.2 Dashboard

A new **toggle** (not a button) appears in the launcher's "What to run" row, alongside the existing WATCH toggle:

```
[▶ Run autopilot] [🌙 夜班]  [○ WATCH re-run on file change]  [○ DEEP discover all interactions]
                                                                ↑ new
```

Hover title: `"Scan all UI/API surfaces, 1 contract per interaction. 5-15 min, ~$1-3 LLM."`

When toggled ON, all three primary buttons (Run autopilot / Watch / 夜班) send `&discoveryMode=deep` to the SSE stream. The stream route forwards it to `runAutopilot`.

### 3.3 Errors are persistent

The current logs panel keeps only the last 10 entries. With deep discovery generating many events over 5-15 minutes, an early error could scroll out before the user sees it.

**New: persistent errors panel.** A separate React state `errors[]` accumulates every `level: 'error'` log event. It renders as a fixed banner above the logs panel, with a "Clear" button. Lifetime: cleared only on (a) user clicks "Clear", (b) page reload, or (c) starting a fresh run via any of the three buttons (so a successful re-run wipes stale error noise). Never auto-trimmed by buffer size.

CLI surfaces errors via stderr `console.error` (already current behavior).

## 4. Architecture

```
runAutopilot ({ discoveryMode: 'modules' | 'deep' })
  ├─ Phase A (smoke) ─────────── unchanged
  ├─ Phase B
  │   ├─ if 'modules' (default) → discoverByModule           [existing]
  │   └─ if 'deep'              → discoverByInteraction      [NEW]
  └─ Phase C (fix) ────────────── unchanged
```

### 4.1 `discoverByInteraction` flow

```
Stage 1 — Surface Enumeration (1 large LLM call)
  └─ Input: project file tree + 5 entry files (next.config / app dir / router)
  └─ Output: Interaction[]  (typically 50-300 entries)
  └─ Input cap: 50,000 tokens

Stage 2 — Per-Interaction Contract Generation (N small LLM calls)
  └─ Per interaction: send metadata + ~80 surrounding lines of code
  └─ Output: ContractProposal[]  (0-3 per interaction, typically 1)
  └─ Input cap per call: 10,000 tokens
  └─ Concurrency: 4 (default, --deep-concurrency tunable)

Stage 3 — Incremental Merge
  └─ Build existing-contracts index (id + content hash)
  └─ For each new proposal: 3-layer dedup
  └─ Write survivors to qa/contracts/<module>/<id>.yml
  └─ Stop early if --deep-max-contracts reached
```

### 4.2 New files

| Path | Responsibility |
|---|---|
| `packages/cli/src/autopilot/interaction-discovery.ts` | All three stages: `enumerateSurface`, `generateContractFor`, `mergeContracts`, plus the orchestrator `discoverByInteraction` |
| `packages/cli/tests/interaction-discovery.test.ts` | Unit tests for each stage + the orchestrator (mocked LLM) |

### 4.3 Modified files

| Path | Change |
|---|---|
| `packages/cli/src/commands/autopilot.ts` | Add `discoveryMode?: 'modules' \| 'deep'` + `deepConcurrency?: number` + `deepMaxContracts?: number` to `AutopilotOptions`. Phase B dispatch chooses `discoverByModule` vs `discoverByInteraction`. |
| `packages/cli/bin/contractqa.ts` | Add 3 Commander options on `autopilot` command; pass through to `runAutopilot`. |
| `apps/dashboard/app/launcher/stream/route.ts` | Parse `discoveryMode` query param; forward to `runAutopilot`. |
| `apps/dashboard/app/launcher/page.tsx` | Add `deepMode` state + DEEP toggle next to WATCH; `startRun()` passes `discoveryMode` to URL. Add persistent `errors[]` state + rendering. |
| `apps/dashboard/app/launcher/launcher.module.css` | Add `.errorsBanner` rule (border, padding, clear button). Reuse `.toggle` for the new DEEP toggle. |

### 4.4 Unchanged (intentional)

- `packages/cli/src/autopilot/llm-discovery.ts` — the old `discoverByModule` stays. We don't share its module loop because the iteration shapes differ enough that sharing creates more abstraction than it saves.
- `packages/cli/src/autopilot/smoke-patterns.ts` — Phase A.
- `packages/orchestrator/*` — orchestrator unchanged.
- The `ContractProposal` shape from `llm-discovery.ts` is **reused** (not duplicated) by Stage 2.

## 5. Stage 1: Surface Enumeration

### 5.1 Input construction

Built by `interaction-discovery.ts`:

1. **File tree** (via `fs.readdir` recursive): full project tree, excluding:
   - `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `.cache`, `coverage`
   - `qa/` (autopilot's own output)
   - dotfiles at any level
   - Files larger than 100kB (likely lockfiles, generated)

2. **Entry files** (up to 5, full content): probe for these in order, include first 5 that exist:
   - `next.config.{js,ts,mjs}`
   - `app/layout.{tsx,jsx}`
   - `src/router.{tsx,ts}` / `src/main.{tsx,ts}`
   - `vite.config.{js,ts}`
   - `package.json` (always; for `scripts` + framework detection)

3. **Token budget**: cap at 50,000 tokens (5x the original v1 cap). If file tree + entry files exceed it, truncate the file tree (entry files are higher signal — keep them whole).

### 5.2 System prompt

```
You are an expert QA engineer reading a project's source layout to identify
every user-triggerable interaction. Output strictly a JSON array of Interaction
objects. No prose, no markdown fences.

Project framework hints: {framework}, {packageManager}, routes file at {router}.

For each interaction (button click, form submit, route handler, API endpoint,
external link), emit ONE Interaction:

  type Interaction = {
    id: string;             // deterministic. Format: "<type>-<module>-<kebab-name>".
                            // Examples: "btn-launcher-night-shift", "route-dashboard-runs-id",
                            //           "api-runs-patch", "form-auth-login".
    type: 'button' | 'form' | 'route' | 'api-endpoint' | 'link' | 'submit-handler';
    file: string;           // path relative to project root (use /, not \).
    name: string;           // human-readable name. "Night-shift button", "POST /api/runs".
    route?: string;         // for type ∈ {route, api-endpoint}: the URL path with placeholders.
    module: string;         // top-level grouping. Derived from file path.
                            // Examples: 'dashboard', 'launcher', 'api', 'cli', 'runner'.
    rationale: string;      // one sentence: why this interaction is testable.
  }

Rules:
1. Only list interactions the user can directly trigger. Skip pure presentation
   components (Card, Badge, layout).
2. Skip test files, .test.*, .spec.*, storybook (*.stories.*), mocks (__mocks__).
3. `id` MUST be deterministic and unique within this list. Re-running on
   unchanged source MUST produce the same `id` for the same interaction
   (this drives Stage 3 dedup).
4. If conditional rendering hides an interaction, still list it — coverage > certainty.
5. Strict JSON output: a single top-level array. No prose.
```

### 5.3 Output validation

Parse into Zod schema:

```ts
const InteractionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id must be kebab-case alphanumeric'),
  type: z.enum(['button', 'form', 'route', 'api-endpoint', 'link', 'submit-handler']),
  file: z.string(),
  name: z.string(),
  route: z.string().optional(),
  module: z.string(),
  rationale: z.string(),
});
const InteractionsSchema = z.array(InteractionSchema);
```

Parse failure → fall back to `discoverByModule`, emit error event (handled per §8 row 1).

## 6. Stage 2: Per-Interaction Contract Generation

### 6.1 Per-interaction input

For each interaction:

1. Read the source file at `interaction.file`.
2. Extract a window around any line that contains the interaction's `name` or `id` (best-effort string match). Default: 40 lines before + 40 lines after the **first** match. If no match, use first 80 lines of the file.
3. Build prompt:

```
Interaction:
  id: {id}
  type: {type}
  name: {name}
  route: {route ?? 'n/a'}
  module: {module}
  file: {file}
  rationale: {rationale}

Source context (around the interaction):
```{lang}
{80 lines of code}
```

Generate 1-3 ContractProposal objects testing user-visible invariants of this
interaction. If the interaction has no testable invariant beyond "it renders"
(e.g., a pure-navigation link), output an empty array `[]`.

Use the EXACT same ContractProposal shape and YAML contract shape as the
existing autopilot — see system prompt for the schema.
```

4. **Token cap per call**: 10,000 (5x the original v1 cap). Truncate the source window symmetrically if exceeded.

### 6.2 Reuse existing system prompt

The system prompt is the same one used by `discoverByModule` (`llm-discovery.ts:40-83`) — defines the `ContractProposal` shape and the YAML contract schema. **No new schema**.

### 6.3 Concurrency

Use a simple in-process worker pool:

```ts
async function pool<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>
): Promise<R[]>
```

Default limit: 4 (`--deep-concurrency`). Each worker pulls from a shared queue, runs `fn`, pushes result. AbortSignal forwarded to every in-flight call.

### 6.4 Error handling per interaction

If a single interaction's LLM call fails (after the existing `callWithBackoff` exhausts retries) OR returns invalid JSON → quarantine its raw response to `qa/contracts/_quarantine/<interaction.id>.txt`, emit `level: 'warn'` log, **continue with the rest**. One bad interaction does not stop discovery.

## 7. Stage 3: Incremental Merge

### 7.1 Build existing index

Before writing anything, read all existing contracts:

```ts
const existing = readAllExistingContracts(cwd); // walks qa/contracts/**/*.{yml,yaml}
// Returns: { byId: Map<string, ContractMeta>, byHash: Map<string, ContractMeta> }
```

Where:
```ts
interface ContractMeta {
  id: string;
  filePath: string;
  contentHash: string;  // sha256(JSON.stringify({actions, expected}))
}
```

### 7.2 Three-layer dedup

For each new `ContractProposal`:

**Helpers (both implemented in `interaction-discovery.ts`):**
- `parseContractId(yamlStr)`: runs `yaml.parse(yamlStr)` and returns the top-level `id` field. Throws if missing.
- `stableStringify(obj)`: deterministic JSON serialization with sorted keys at every depth. Required so `{actions: [...], expected: {...}}` produces the same hash regardless of key order.

**Layer 1 — ID collision:**
```
const newId = parseContractId(proposal.yaml);
if (existing.byId.has(newId)) → skip, emit info `[deep] skipped <id>: id collision`
```

**Layer 2 — Content hash:**
```
const newHash = sha256(stableStringify({actions, expected}));
if (existing.byHash.has(newHash)) → skip, emit info `[deep] skipped <id>: content duplicate of <existing-id>`
```

**Layer 3 — File-exists guard:**
```
const targetPath = `qa/contracts/${interaction.module}/${newId}.yml`;
if (await fs.exists(targetPath)) → skip, emit info `[deep] skipped <id>: file exists at ${targetPath}`
```

Layer 3 is the final safety net — protects user-written contracts that aren't in our existing index (e.g., user just added a file we haven't loaded yet).

### 7.3 Write surviving proposals

```ts
const yamlWithFrontmatter = `# generated-by: deep-discovery v1
# interaction: ${interaction.id} (${interaction.type})
# rationale: ${interaction.rationale}
${proposal.yaml}`;

await mkdir(dirname(targetPath), { recursive: true });
await writeFile(targetPath, yamlWithFrontmatter);
```

Generated files carry a `# generated-by:` header so future tooling (or human reviewers) can distinguish AI-generated from hand-written.

### 7.4 Max-contracts cap

Track a counter `generatedCount`. Before each write:

```
if (generatedCount >= opts.deepMaxContracts) {
  emit({ type: 'log', level: 'warn',
         message: `[deep] hit max-contracts cap (${opts.deepMaxContracts}), stopping early` });
  break;
}
```

The cap is a safety net against runaway LLM hallucinations or duplicated proposals slipping past Layer 1/2.

## 8. Error handling

| Scenario | Behavior |
|---|---|
| Stage 1 LLM call fails after 4 retries | Emit `level: 'error'` log `[deep] surface enumeration failed: <reason>; falling back to module discovery`. Then call `discoverByModule` as fallback. Phase B counters reflect the fallback path. |
| Stage 1 returns invalid JSON (Zod fail) | Same as above. The raw response is quarantined to `qa/contracts/_quarantine/_surface-enum.txt`. |
| Stage 1 returns valid JSON but 0 interactions | Emit `level: 'warn'` log `[deep] surface enumeration returned 0 interactions; falling back to module discovery`. Then fall back. |
| Single Stage 2 call fails after retries | Quarantine the failing proposal's raw response, emit `level: 'warn'` log `[deep] interaction <id> failed: <reason>; continuing`. Keep going. |
| Stage 2 returns invalid `ContractProposal` JSON | Same. |
| Stage 3 file write fails (permissions / disk full) | Emit `level: 'error'` log `[deep] write failed for <path>: <reason>`. Continue with next proposal. |
| Hit `--deep-max-contracts` cap | Emit `level: 'warn'` log `[deep] hit max-contracts cap; stopping early`. Already-written contracts are kept. |
| User SIGINT mid-run | `abortController.abort()` is forwarded to all in-flight Stage 2 calls; pool workers see `signal.aborted` on next dequeue and exit. Partial results are kept. |

**All error events MUST reach the user**:
- CLI: stderr `console.error` (existing pattern)
- Dashboard: emitted as SSE `log` events with `level: 'error'` → rendered in the new persistent errors banner (§3.3), not just the trimming logs panel.

## 9. Testing strategy

### 9.1 Unit tests (`packages/cli/tests/interaction-discovery.test.ts`)

Mock `LLMClient` throughout; no real LLM calls.

| Test | Asserts |
|---|---|
| `enumerateSurface` returns parsed interactions on valid LLM JSON | Schema validation works |
| `enumerateSurface` falls back on invalid JSON | Returns null, quarantine path written |
| `enumerateSurface` truncates file tree when over token cap | Resulting prompt ≤ 50k tokens |
| `generateContractFor` returns proposals on valid LLM response | Reuses existing ContractProposal schema |
| `generateContractFor` truncates source window when over 10k tokens | Symmetric trim |
| `mergeContracts` Layer 1 dedup (id collision) | Skips correctly |
| `mergeContracts` Layer 2 dedup (content hash) | Skips correctly |
| `mergeContracts` Layer 3 dedup (file exists) | Skips correctly |
| `mergeContracts` writes generated-by frontmatter | Header present |
| `mergeContracts` respects `deepMaxContracts` cap | Stops at cap with warn |
| Concurrency pool processes all items with limit | All items processed, no more than `limit` in-flight |
| Per-interaction failure quarantines + continues | Other interactions still complete |

### 9.2 Integration test

Create a tiny fixture project (`packages/cli/tests/fixtures/interaction-discovery-target/`):

```
fixture/
  package.json
  app/
    page.tsx        ← contains one <button onClick={...}>
    login/page.tsx  ← contains one <form>
  api/
    runs/route.ts   ← contains one POST handler
```

Run `discoverByInteraction({cwd: fixture, llmClient: mockLlm})` with a mocked LLM that:
- Stage 1: returns 3 interactions matching the fixture
- Stage 2: returns 1 proposal per interaction

Assert:
- 3 YAML files written to `qa/contracts/{app,api}/`
- Each has the `generated-by` frontmatter
- Re-running produces 0 new files (dedup works)

### 9.3 Not tested

- Real LLM calls (cost + nondeterminism).
- Real concurrency stress (covered by unit pool test with mocked items).
- Real `gh pr create` (this spec doesn't touch night-shift).

## 10. Cost & performance expectations

For a medium-sized project (~50-200 source files, ~100 interactions):

| Stage | Calls | Tokens (in+out) | Cost (Sonnet) |
|---|---|---|---|
| Stage 1 | 1 | ~50k in, ~10k out | ~$0.20 |
| Stage 2 | 100 (sequential equivalent) | ~10k in each, ~1k out | ~$1.00 total |
| Stage 3 | 0 | 0 | $0 |
| **Total** | **~101** | | **~$1-2** per discovery run |

At `--deep-concurrency 4`, wall-clock time: **5-15 minutes** depending on LLM latency.

Watch mode amplifies cost: each file save can re-trigger discovery. **Recommended pattern**: run deep mode **once** to seed contracts, then turn DEEP toggle OFF for subsequent watch iterations (which will use the cheap default mode for re-runs).

## 11. Risk register

| Risk | Mitigation |
|---|---|
| LLM hallucinates interactions that don't exist | 1:1 mapping is documented as "best-effort surface coverage"; user reviews generated contracts. `generated-by` frontmatter makes AI-generated contracts trivially greppable for review. |
| LLM gives non-deterministic ids on re-run → Layer 1 dedup fails | Layer 2 (content hash) catches semantic dupes. `id` format rule in the system prompt nudges determinism. |
| Cost runs away on huge projects | `--deep-max-contracts 500` hard cap + `--deep-concurrency 4` rate-limit. |
| Surface enum returns 0 interactions on a project that has them | Fall back to `discoverByModule` per §8. User sees an `error` event. |
| User has 200 hand-written contracts; deep discovery floods qa/ with 500 more | Layer 3 file-exists protects hand-written paths. Generated paths use `<id>.yml` so collision only happens on real id collision. |
| Generated contract YAML is invalid (LLM bug) | Existing `loadContractsFromDir` validation catches this when Phase B output is loaded into Phase A. Bad YAMLs are quarantined. |
| Watch mode + deep mode = budget blowout | Documented recommendation in §10. Future v1.1: detect deep+watch combination and warn before starting. |

## 12. Out of scope (explicit non-features)

- Static AST-based surface enumeration (decided against; LLM-driven is chosen).
- Runtime Playwright crawling.
- Auto-merging proposals with existing contracts (always skip on collision; user manually merges).
- Cross-language support beyond JavaScript/TypeScript projects (Python, Go, Rust out of scope).
- Telemetry on which generated contracts later catch real bugs (would inform quality but is a separate feature).
- A "review generated contracts" UI in the Dashboard (CLI users review YAML directly; v1.1 followup).
