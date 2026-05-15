# ContractQA Phase 13 Implementation Plan (v1.0.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `contractqa` from v0.12.0 to v1.0.0 — freeze public API surface, document semver policy, add `@contractqa/runner/http` Playwright-free subpath, reclassify Playwright as optional peer, ship Phase 12 leftover polish, and produce a passing `pnpm publish --dry-run` for all 9 publishable packages. **Real `pnpm publish` to npm is user-gated and OUT OF SCOPE.**

**Architecture:** Four parts.

- **Part A — Packaging primitives:** publishConfig + files + engines on 9 packages; new `@contractqa/runner/http` subpath; Playwright reclassified as optional peer; CLI Playwright runtime check immediately before `spawn` in `run.ts`.
- **Part B — Docs + stability:** create root `STABILITY.md`; trim `packages/adapters/STABILITY.md`; create 7 internal package READMEs with "internal" warnings; create CLI README; create adapters README; add `@experimental` JSDoc tags on `runHttpContract` + `FirestoreBackendAdapter`.
- **Part C — Phase 12 leftover polish:** Content-Type case-insensitive normalization in `runHttpContract`; `.strict()` on 4 non-http `Action` zod variants; `runHttpContract` JSDoc clarifying status semantics.
- **Part D — Release:** `scripts/phase13-acceptance.sh`; update root README with Install/quick-start; CHANGELOG v1.0.0 entry; lockstep version bump 9 packages 0.12.0 → 1.0.0 + third-party template; final acceptance.

**Tech Stack:** TypeScript 5.x, pnpm 9.x workspaces, Vitest 2.x, Node 18+ (consumer floor) / 20.18+ (contributor floor). No new runtime deps; reclassifies one existing dep.

---

## Required reading (before starting)

1. `docs/superpowers/specs/2026-05-15-contractqa-v1.0-prep-design.md` — the v3 spec (the source of truth for everything in this plan).
2. `docs/superpowers/plans/2026-05-15-contractqa-phase-12.md` — most recent prior plan; template for commit cadence + worktree pattern.
3. `packages/adapters/STABILITY.md` — current stability doc; B5 trims this (does not delete).
4. `packages/adapters/package.json` — the "already configured" model for publishConfig + files; A1 copies its shape to the 8 others.
5. `packages/runner/src/index.ts` — current runner barrel; statically re-exports `playwright-entry.ts`. A2 adds a new `/http` subpath that bypasses it.
6. `packages/runner/src/run-contract.ts` — contains `runHttpContract` (lines 187-…); A2 adds `@experimental` JSDoc here; C1/C3 modify the same function.
7. `packages/core/src/schemas/contract.schema.ts` — lines 34-37 hold the 4 non-http Action variants; C2 adds `.strict()` to each.
8. `packages/cli/src/commands/run.ts` — line 39 spawns Playwright via `child_process`; A3 inserts the Playwright check immediately before.
9. `CHANGELOG.md` — top entry is v0.12.0; D3 inserts v1.0.0 above it.
10. `README.md` (root) — D2 adds an Install section near the top.

---

## Scope decisions (CEO 鸭子 verdict, after 2 opus reviews)

| Decision | Verdict |
|---|---|
| v1.0 publish scope | All 9 publishable packages to npm (8 scoped `@contractqa/*` + `contractqa` CLI). Document CLI + adapters as "public-facing"; the 7 internal `@contractqa/*` are published but documented as internal. |
| `runHttpContract` / `FirestoreBackendAdapter` stability | Both `@experimental` at v1.0.0 — may change in minor. |
| Single phase or split? | **Single mega-phase** (Phase 13). Estimated 2-2.5h. |
| Real `pnpm publish` to npm | Out of scope — user-gated; this phase ends at clean dry-run + local `v1.0.0` annotated tag. |
| Playwright dep classification | Optional peer dep on `@contractqa/runner`: `peerDependencies` + `peerDependenciesMeta["@playwright/test"].optional = true`. |
| HTTP-only entry point | New `@contractqa/runner/http` subpath. New file `packages/runner/src/http.ts` re-exports only `runHttpContract` + types. Root barrel unchanged (still statically loads `playwright-entry.ts`). |
| CLI Playwright check placement | In `packages/cli/src/commands/run.ts`, immediately before `spawn('pnpm', ['exec', 'playwright', 'test', ...])` at line ~39. `run` is the only browser-required command; `doctor`/`init`/`invariants-gen`/`scan` do not spawn or import Playwright. |
| Engines floor | `>=18` on all 9 publishable packages (consumer floor); root `package.json` retains `>=20.18` (contributor floor). Intentional asymmetry, documented in CHANGELOG. |
| STABILITY structure | Root `STABILITY.md` (new — generic policy + public/internal classification); `packages/adapters/STABILITY.md` (trimmed — keeps adapter-specific change log only, links to root). No per-package STABILITY for the 7 internal packages — covered by root + README warning. |
| Internal package READMEs | Create new READMEs for the 7 internal packages (none currently exist). Each gets the standard "internal — use CLI/adapters instead" warning block. |
| Public-facing READMEs | Create `packages/cli/README.md` (real install + usage) and `packages/adapters/README.md` (install + link to STABILITY). |
| External repo PRs | Still NO (standing decision from Phase 5 onward). |

---

## Non-goals (do not touch in Phase 13)

- Real `pnpm publish` to the npm registry — user-gated.
- Real-Firestore-emulator integration test — kept deferred; Firestore stays `@experimental`.
- HTTP dogfood target — kept deferred; HTTP runner stays `@experimental`.
- `tsc -b` project references, persona dogfood agents, dashboard §15.3–§15.6, property/model-based test gen, pnpm-version-aware spawn helper.
- File-content `cookies()` parsing for `custom-cookie`.
- Dynamic `$session.userId` resolution.
- Cleanup of `.claire/` debris at repo root.
- Restructuring `runContract` or removing `playwright-entry.ts` from the runner root barrel — keep current behavior; `/http` is the additive opt-out for HTTP-only consumers.

---

## File structure

**Created (10 files):**
- `packages/runner/src/http.ts` — re-exports `runHttpContract` + types (Task A2)
- `packages/runner/tests/http-subpath.test.ts` — smoke test for `/http` resolution + type-only import (Task A2)
- `packages/cli/tests/check-playwright.test.ts` — DI'd test of the Playwright resolution check (Task A3)
- `packages/core/tests/strict-action-variants.test.ts` — unknown-key rejection across 4 Action variants (Task C2)
- `STABILITY.md` (repo root) — generic stability policy + public/internal classification (Task B4)
- `packages/cli/README.md` — user-facing install + quick start (Task B2)
- `packages/adapters/README.md` — install + link to STABILITY (Task B3)
- `packages/{core,runner,oracle,evidence,probes,orchestrator,repro}/README.md` — 7 internal package READMEs with "internal" warning (Task B1)
- `scripts/phase13-acceptance.sh` — release-lane validation script (Task D1)

**Modified (24 files, give or take):**
- 8 `packages/*/package.json` (publishConfig + files + engines added; CLI + 7 internal) (Task A1)
- `packages/adapters/package.json` — engines added (Task A1)
- `packages/runner/package.json` — `exports./http` added; Playwright reclassified to peer (Task A2)
- `packages/cli/src/commands/run.ts` — Playwright check before spawn (Task A3)
- `packages/adapters/STABILITY.md` — trimmed; header link added (Task B5)
- `packages/runner/src/run-contract.ts` — `@experimental` JSDoc on `runHttpContract` (Task B6); Content-Type lowercase (Task C1); JSDoc clarification on status (Task C3)
- `packages/adapters/src/backend/firestore.ts` — `@experimental` JSDoc on class/constructor/`query` (Task B6)
- `packages/core/src/schemas/contract.schema.ts` — `.strict()` on 4 non-http Action variants (Task C2)
- 9 `packages/*/package.json` — version 0.12.0 → 1.0.0 (Task D4)
- `packages/adapters/templates/third-party/package.json` — `@contractqa/adapters` version bump 0.12.0 → 1.0.0 (Task D4)
- `README.md` (root) — add Install + Quick start (Task D2)
- `CHANGELOG.md` — prepend v1.0.0 entry (Task D3)

**No tag created in worktree.** Tag is applied after FF-merge to `main`, outside the worktree.

---

## Dependency graph

```
Part A (Packaging primitives) ─┐
                                │
Part B (Docs + stability)    ──┼── Part D (Release: acceptance, README, CHANGELOG, version bump)
                                │
Part C (Phase 12 polish)     ──┘
```

A/B/C are independent; D depends on all three. Within each part, tasks are mostly independent (different files), so the implementer can choose any order — but the listed order minimizes context switches.

**Worktree:** `.claude/worktrees/phase13-exec` (created via `EnterWorktree` before execution).

---

# Part A — Packaging primitives

**Acceptance gate A:** All 9 publishable packages have `publishConfig.access: "public"`, `files` whitelist, and `engines.node >= 18`. `@contractqa/runner` has `./http` export; `@playwright/test` is in `peerDependencies` with `optional: true`. `packages/cli/src/commands/run.ts` calls a Playwright check before `spawn`. `pnpm -r build && pnpm -r typecheck && pnpm -r test` all pass.

---

### Task A1: Add publishConfig + files + engines to 9 packages

**Files:**
- Modify: `packages/cli/package.json`, `packages/core/package.json`, `packages/runner/package.json`, `packages/oracle/package.json`, `packages/evidence/package.json`, `packages/probes/package.json`, `packages/orchestrator/package.json`, `packages/repro/package.json` (8 packages — adds publishConfig + files + engines)
- Modify: `packages/adapters/package.json` (only adds engines)

- [ ] **Step 1: Verify starting state**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM: worktree branch, NOT main
grep -L '"publishConfig"' packages/*/package.json
# Expect: 8 paths (everything except adapters)
grep -L '"engines"' packages/*/package.json
# Expect: 9 paths (all 9 publishable; root has engines but root is not in packages/)
```

- [ ] **Step 2: Edit 8 non-adapters package.json (CLI + 7 internal)**

For each of `cli`, `core`, `runner`, `oracle`, `evidence`, `probes`, `orchestrator`, `repro`, insert the three fields BEFORE the closing `}` of the package.json. Pattern (using `runner` as example — the others are similar but their `exports` field differs):

```json
{
  "name": "@contractqa/runner",
  "version": "0.12.0",
  "type": "module",
  ...,
  "publishConfig": {
    "access": "public"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": { ... },
  ...
}
```

Order within the JSON object: put `publishConfig`, `files`, `engines` together as a block, conventionally placed AFTER the main/exports/bin fields and BEFORE `scripts`. Match adapters' existing order if uncertain.

**For the CLI (`packages/cli/package.json`)**: same three fields, but `files: ["dist", "README.md"]` is sufficient — npm auto-includes `bin` targets.

- [ ] **Step 3: Edit adapters — engines only**

`packages/adapters/package.json` already has `publishConfig` and `files`. Add only:

```json
  "engines": {
    "node": ">=18"
  },
```

Place between `files` and `publishConfig` or wherever logical. Match existing style.

- [ ] **Step 4: Verify**

```bash
grep -c '"publishConfig"' packages/*/package.json
# Expect: 9 lines, each with ":1"
grep -c '"engines"' packages/*/package.json
# Expect: 9 lines, each with ":1"
grep -l '"node": ">=18"' packages/*/package.json | wc -l
# Expect: 9
```

Build + typecheck must still pass:
```bash
pnpm -r build 2>&1 | tail -5
pnpm -r typecheck 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/*/package.json
git commit -m "chore(packaging): add publishConfig + files + engines to 9 publishable packages"
```

---

### Task A2: Add `/http` subpath to runner + reclassify Playwright as optional peer

**Files:**
- Create: `packages/runner/src/http.ts`
- Create: `packages/runner/tests/http-subpath.test.ts`
- Modify: `packages/runner/package.json`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runner/tests/http-subpath.test.ts
import { describe, it, expect } from 'vitest';

describe('@contractqa/runner/http subpath', () => {
  it('re-exports runHttpContract (function)', async () => {
    const mod = await import('../src/http.js');
    expect(typeof mod.runHttpContract).toBe('function');
  });

  it('module text contains no static @playwright import', async () => {
    // Static-source assertion: runner/src/http.ts must not import @playwright.
    // We import the file content via fs to assert at test-time that no future
    // edit re-introduces a Playwright import on the HTTP path.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(resolve(here, '../src/http.ts'), 'utf8');
    expect(src).not.toMatch(/@playwright/);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @contractqa/runner exec vitest run tests/http-subpath.test.ts 2>&1 | tail -5
# Expect: 2 FAIL (Cannot find module '../src/http.js')
```

- [ ] **Step 3: Create `packages/runner/src/http.ts`**

```ts
/**
 * `@contractqa/runner/http` — Playwright-free entry point for HTTP-only contracts.
 *
 * HTTP consumers should import from this subpath rather than the runner root:
 *
 *   import { runHttpContract } from '@contractqa/runner/http';
 *
 * The root barrel (`@contractqa/runner`) statically re-exports `playwright-entry.ts`,
 * which value-imports `@playwright/test`. Loading the root barrel without
 * `@playwright/test` installed will throw at module init.
 *
 * This subpath only re-exports `runHttpContract` and its types from `./run-contract.js`.
 * `run-contract.ts` has zero `@playwright` imports (verified at v1.0.0).
 */
export { runHttpContract } from './run-contract.js';
export type {
  RunHttpContractInput,
  RunHttpContractResult,
} from './run-contract.js';
```

- [ ] **Step 4: Update `packages/runner/package.json` exports**

Find the `exports` block (currently has `.` and `./reporter`). Add `./http`:

```json
"exports": {
  ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
  "./reporter": { "import": "./dist/reporter.js", "types": "./dist/reporter.d.ts" },
  "./http": { "import": "./dist/http.js", "types": "./dist/http.d.ts" }
},
```

- [ ] **Step 5: Reclassify Playwright**

In the same `packages/runner/package.json`, remove `@playwright/test` from `dependencies` and add:

```json
"peerDependencies": {
  "@playwright/test": "^1.49.0"
},
"peerDependenciesMeta": {
  "@playwright/test": { "optional": true }
},
"devDependencies": {
  "@playwright/test": "^1.49.0",
  "typescript": "^5.7.2",
  "vitest": "^2.1.8"
}
```

Note: keep `@playwright/test` in `devDependencies` too — the runner's OWN tests need it, and pnpm needs it locally for the workspace build.

- [ ] **Step 6: Re-install + build + run new tests**

```bash
pnpm install --prefer-offline 2>&1 | tail -3
pnpm --filter @contractqa/runner build 2>&1 | tail -3
pnpm --filter @contractqa/runner exec vitest run tests/http-subpath.test.ts 2>&1 | tail -5
# Expect: 2 PASS
# Also run full runner suite to ensure nothing regressed:
pnpm --filter @contractqa/runner exec vitest run 2>&1 | tail -10
# Expect: full pass
```

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/runner/src/http.ts packages/runner/tests/http-subpath.test.ts packages/runner/package.json pnpm-lock.yaml
git commit -m "feat(runner): add /http subpath (Playwright-free) + optional Playwright peer"
```

---

### Task A3: CLI Playwright runtime check in `run.ts` before spawn

**Files:**
- Modify: `packages/cli/src/commands/run.ts`
- Create: `packages/cli/tests/check-playwright.test.ts`

The check uses `createRequire(import.meta.url).resolve()` (ESM-compatible). To keep it testable, expose a pure function `checkPlaywright(resolver?)` that takes an optional resolver; `runContracts` calls it without args (using the real resolver). The test injects a fake resolver.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/check-playwright.test.ts
import { describe, it, expect } from 'vitest';
import { checkPlaywright } from '../src/commands/run.js';

describe('checkPlaywright', () => {
  it('returns ok=true when resolver succeeds', () => {
    const result = checkPlaywright({
      resolve: (id: string) => `/fake/path/${id}/index.js`,
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with install hint when resolver throws', () => {
    const result = checkPlaywright({
      resolve: () => { throw new Error('Cannot find module'); },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('@playwright/test is not installed');
    expect(result.error).toContain('npm install @playwright/test');
    expect(result.error).toContain('playwright install');
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter contractqa exec vitest run tests/check-playwright.test.ts 2>&1 | tail -5
# Expect: 2 FAIL (checkPlaywright is not exported)
```

- [ ] **Step 3: Implement `checkPlaywright` and call it from `runContracts`**

Edit `packages/cli/src/commands/run.ts`. Replace the existing content with (preserving `selectChangedContracts`):

```ts
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ContractDoc } from '@contractqa/core';

const PATH_AREA_MAP: Array<{ pattern: RegExp; area: string }> = [
  { pattern: /(^|\/)auth/i, area: 'auth' },
  { pattern: /lobby/i, area: 'lobby' },
  { pattern: /billing|stripe|subscription/i, area: 'billing' },
  { pattern: /admin/i, area: 'admin' },
  { pattern: /route|middleware/i, area: 'routes' },
];

export function selectChangedContracts(
  contracts: ContractDoc[],
  changedFiles: string[],
): ContractDoc[] {
  if (changedFiles.length === 0) return contracts;
  const areas = new Set<string>();
  for (const f of changedFiles) {
    for (const m of PATH_AREA_MAP) if (m.pattern.test(f)) areas.add(m.area);
  }
  if (areas.size === 0) return contracts;
  return contracts.filter((c) => areas.has(c.area));
}

export interface PlaywrightResolver {
  resolve(id: string): string;
}

const defaultPlaywrightResolver: PlaywrightResolver = createRequire(import.meta.url);

/**
 * Verify `@playwright/test` is installed and resolvable.
 *
 * `runContracts` calls this immediately before spawning Playwright. Returns
 * `{ ok: false, error: '...' }` with a one-line install hint if missing;
 * `runContracts` then surfaces the error and returns exit code 1 instead of
 * letting the `spawn` fail with a confusing "playwright: command not found".
 *
 * Pure function — accepts an optional resolver for test injection.
 */
export function checkPlaywright(
  resolver: PlaywrightResolver = defaultPlaywrightResolver,
): { ok: true } | { ok: false; error: string } {
  try {
    resolver.resolve('@playwright/test');
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        '@playwright/test is not installed.\n' +
        'Install it with:  npm install @playwright/test && npx playwright install chromium',
    };
  }
}

export async function runContracts(opts: {
  contractsDir: string;
  artifactsRoot: string;
  changedFiles?: string[];
  baseUrl?: string;
}): Promise<{ exitCode: number }> {
  const check = checkPlaywright();
  if (!check.ok) {
    console.error(check.error);
    return { exitCode: 1 };
  }

  const env = {
    ...process.env,
    CONTRACTQA_CONTRACTS_DIR: opts.contractsDir,
    CONTRACTQA_ARTIFACTS_ROOT: opts.artifactsRoot,
    CONTRACTQA_CHANGED_FILES: opts.changedFiles?.join(',') ?? '',
    ...(opts.baseUrl ? { CONTRACTQA_BASE_URL: opts.baseUrl } : {}),
  };
  return new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['exec', 'playwright', 'test', '--config=playwright.config.ts'],
      { env, stdio: 'inherit' },
    );
    child.on('exit', (code) => resolve({ exitCode: code ?? 1 }));
  });
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter contractqa build 2>&1 | tail -3
pnpm --filter contractqa exec vitest run tests/check-playwright.test.ts 2>&1 | tail -5
# Expect: 2 PASS
# Run full CLI suite to ensure no regression:
pnpm --filter contractqa exec vitest run 2>&1 | tail -10
# Expect: full pass
```

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/cli/src/commands/run.ts packages/cli/tests/check-playwright.test.ts
git commit -m "feat(cli): check @playwright/test before spawning playwright in run.ts"
```

---

# Part B — Docs + stability

**Acceptance gate B:** Root `STABILITY.md` exists with the 8 sections (overview, public packages, internal packages, stability tags, deprecation window, what counts as a break, what does NOT, reporting). `packages/adapters/STABILITY.md` is trimmed (only adapter-specific content remains, header links to root). 7 internal packages each have a `README.md` with the internal warning block. CLI and adapters READMEs created. `runHttpContract` and `FirestoreBackendAdapter` class/constructor/query carry `@experimental` JSDoc tags.

---

### Task B1: Create 7 internal package READMEs

**Files (all created):**
- `packages/core/README.md`
- `packages/runner/README.md`
- `packages/oracle/README.md`
- `packages/evidence/README.md`
- `packages/probes/README.md`
- `packages/orchestrator/README.md`
- `packages/repro/README.md`

- [ ] **Step 1: Generate one per package**

Each README has the same shape (1-line "what this is" customised per-package). Template:

```markdown
# @contractqa/<PKG>

> **⚠️ Internal package.** Please install [`contractqa`](https://www.npmjs.com/package/contractqa) (the CLI) or [`@contractqa/adapters`](https://www.npmjs.com/package/@contractqa/adapters) instead.
>
> Anything in this package's root entry is implementation detail and may change in any minor release without notice. See the repo-level [`STABILITY.md`](https://github.com/zmy/contractqa/blob/main/STABILITY.md) for the semver-protected public surface.

<one-line description>

This package is a workspace dependency of the `contractqa` CLI and is published only because npm requires resolvable runtime dependencies. Direct consumers should not import from it.
```

Per-package one-liner (the `<one-line description>` slot):

| Package | One-liner |
|---|---|
| `core` | Contract schema (zod) and core types — `ContractDoc`, `AuthAdapter`, `AppAdapter`, `BackendAdapter`, `VerdictResult`. |
| `runner` | Contract runner — `runContract` (Playwright) and `runHttpContract` (HTTP-only, see `/http` subpath). Also provides Playwright config helpers and the `ContractQAReporter`. |
| `oracle` | State-diff oracle that produces the 4-state verdict (`PASS`/`FAIL`/`FLAKY`/`INCONCLUSIVE`) from before/after browser snapshots. |
| `evidence` | Evidence bundle writer — trace.zip, HAR, snapshots, manifest. S3/MinIO upload. |
| `probes` | Browser state snapshot probes — DOM, cookies, localStorage, redaction. |
| `orchestrator` | Claude Code shadow-fix orchestrator — drives the auto-repair loop in an isolated git worktree. |
| `repro` | Minimal Playwright repro generator + 2/3 stability gate. |

- [ ] **Step 2: Verify**

```bash
for p in core runner oracle evidence probes orchestrator repro; do
  test -f "packages/$p/README.md" && echo "OK: $p" || echo "MISSING: $p"
done
# Expect: 7 OK lines
grep -l "Internal package" packages/{core,runner,oracle,evidence,probes,orchestrator,repro}/README.md | wc -l
# Expect: 7
```

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/{core,runner,oracle,evidence,probes,orchestrator,repro}/README.md
git commit -m "docs: README with internal-warning block for 7 internal packages"
```

---

### Task B2: Create CLI README

**File (created):** `packages/cli/README.md`

- [ ] **Step 1: Write the README**

```markdown
# contractqa

> Product-invariant QA platform — verifies behavioural contracts (not just screenshots), captures evidence on failure, and hands minimal repros to Claude Code for auto-fix.

Install:

\`\`\`bash
npm install contractqa @contractqa/adapters
# Browser-flow users also need Playwright:
npm install @playwright/test
npx playwright install chromium
\`\`\`

See the repo [README](https://github.com/zmy/contractqa) for the full architecture and the [STABILITY.md](https://github.com/zmy/contractqa/blob/main/STABILITY.md) policy for the semver-protected surface.

## CLI commands

- `contractqa init` — scaffold contracts directory and Playwright config.
- `contractqa doctor` — diagnose target-repo preconditions (native deps, env vars, ports).
- `contractqa scan` — read-only survey of the target repo (frameworks, auth providers).
- `contractqa invariants-gen` — auto-generate `INVARIANTS.md` from contract YAML.
- `contractqa run` — run contracts via Playwright. **Requires `@playwright/test`** — fails fast with an install hint if missing.

For programmatic use, the HTTP-only path:

\`\`\`ts
import { runHttpContract } from '@contractqa/runner/http';  // @experimental — Playwright-free
\`\`\`

The Playwright-based runner lives at the root export of `@contractqa/runner` and requires `@playwright/test` to be installed.

## License

See repo LICENSE.
```

- [ ] **Step 2: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/cli/README.md
git commit -m "docs(cli): user-facing README with install + command list"
```

---

### Task B3: Create adapters README

**File (created):** `packages/adapters/README.md`

- [ ] **Step 1: Write the README**

```markdown
# @contractqa/adapters

> AuthAdapter and BackendAdapter implementations for the [contractqa](https://www.npmjs.com/package/contractqa) platform.

Install:

\`\`\`bash
npm install @contractqa/adapters
\`\`\`

## Public surface

Import only from `@contractqa/adapters/public`:

\`\`\`ts
import { SupabaseAuthAdapter, NextAuthAdapter, composeAuth } from '@contractqa/adapters/public';
import { PostgresBackendAdapter, MongoBackendAdapter, FirestoreBackendAdapter } from '@contractqa/adapters/public';
import type { AuthAdapter, BackendAdapter } from '@contractqa/adapters/public';
\`\`\`

Importing from the root entry (`@contractqa/adapters`) or any deep path is **internal** and may change without notice. See [STABILITY.md](./STABILITY.md) (adapter-specific notes) and the repo [STABILITY.md](https://github.com/zmy/contractqa/blob/main/STABILITY.md) (repo-wide policy).

## What ships at v1.0.0

| Adapter | Stability |
|---|---|
| `SupabaseAuthAdapter` | `@stable` |
| `NextAuthAdapter` | `@stable` |
| `Auth0Adapter` | `@stable` |
| `ClerkAdapter` | `@stable` |
| `CustomCookieAuthAdapter` | `@stable` |
| `composeAuth` | `@stable` |
| `PostgresBackendAdapter` | `@stable` |
| `MongoBackendAdapter` | `@stable` |
| `FirestoreBackendAdapter` | `@experimental` (mocked-only tests; real-emulator integration deferred to a future release) |

## Optional dependency

`@google-cloud/firestore` is an `optionalDependency`. It auto-installs by default. If your platform doesn't have prebuilt binaries (or you don't use Firestore), the install is allowed to fail and `FirestoreBackendAdapter` will throw at construction.

## License

See repo LICENSE.
```

- [ ] **Step 2: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/README.md
git commit -m "docs(adapters): README with public surface + adapter stability table"
```

---

### Task B4: Create root STABILITY.md

**File (created):** `STABILITY.md` (repo root)

- [ ] **Step 1: Write the doc**

```markdown
# ContractQA stability policy

> v1.0.0 semver surface and stability tags. This document is the canonical
> policy for the whole monorepo; adapter-specific change history lives in
> [`packages/adapters/STABILITY.md`](./packages/adapters/STABILITY.md).

## Overview

ContractQA reached v1.0.0 after twelve consecutive minor releases (v0.5.0 → v0.12.0) shipped with zero breaking changes since v0.4.0. From v1.0.0 onward, the public surface is frozen under semver:

- **Patch (1.x.y):** bug fixes; no type-signature change on the public surface.
- **Minor (1.x.0):** additive — new exports, new optional fields, new methods.
- **Major (2.0.0):** removals, renames, narrowings, runtime-behaviour changes that would break a consumer following the public docs.

## Public packages

Two packages are part of the public, semver-protected surface:

- **`contractqa`** (the CLI) — command names, flag names, and stdout contract.
- **`@contractqa/adapters/public`** — only the subpath export `./public` is public. The root entry (`@contractqa/adapters`) is internal.

A third runtime entry point is public but `@experimental` at v1.0.0:

- **`@contractqa/runner/http`** — the HTTP-only subpath for `runHttpContract`. The function signature may change in any minor release; promotions and removals will be called out in the changelog.

## Internal packages

The following packages are **published** so that npm can resolve the CLI's runtime dependencies, but their root entries are NOT semver-protected and may change in any minor release:

- `@contractqa/core`
- `@contractqa/runner` (the root barrel; the `/http` subpath is public-experimental as noted above)
- `@contractqa/oracle`
- `@contractqa/evidence`
- `@contractqa/probes`
- `@contractqa/orchestrator`
- `@contractqa/repro`

If your code imports directly from any of these packages' root entries, you are using an internal surface. Switch to `contractqa` (CLI) or `@contractqa/adapters/public` if you need stability guarantees.

## Stability tags

JSDoc tags on exports document their level:

- `@stable` — semver-protected (default for any documented public export).
- `@experimental` — may change in any minor release. v1.0.0 experimental list: `runHttpContract` (`@contractqa/runner/http`), `FirestoreBackendAdapter` (`@contractqa/adapters/public`).
- `@deprecated` — kept for at least one full minor cycle after announcement; removed only in the next major.

## Deprecation window

Stable exports flagged for removal must:

1. Carry an `@deprecated` JSDoc tag in the minor release that announces removal.
2. Remain available for at least one full minor cycle (≈ six weeks or one anchor release, whichever is longer).
3. Be removed only in the next major release.

## What counts as a break

- Renaming a stable export.
- Removing a stable export without going through the deprecation window.
- Narrowing a stable type (e.g. `string` → `'a' | 'b'`).
- Changing the runtime behaviour of a public function in a way that violates its documented contract.
- Changing the signature of `runContract`, `runHttpContract` once `@experimental` is removed, or any public adapter method (`loginAs`, `isAuthenticated`, `currentUser`, `query`, etc.).
- Changing which cookies / localStorage keys a public AuthAdapter writes.

## What does NOT count as a break

- Adding new exports.
- Adding optional fields to existing public interfaces.
- Widening a public type (e.g. `'a' | 'b'` → `string`).
- Changes inside `dogfood/`, `fixtures/`, or any path not re-exported from a public surface.
- Tightening internal error messages.
- Performance improvements that don't observably change return values.
- Any change to an `@experimental` export.
- Any change to an internal package's root entry.

## Reporting a break

Open an issue tagged `breaking-change` with the version pair and a minimal repro. We aim to either revert, patch, or document the rationale + migration path within one week.

## Engines

All publishable packages declare `engines.node >= 18` as the consumer floor. The monorepo root declares `>=20.18` as the contributor floor (newer Node features used in tests/scripts). Both are intentional.
```

- [ ] **Step 2: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add STABILITY.md
git commit -m "docs: root STABILITY.md (v1.0 semver policy + public/internal classification)"
```

---

### Task B5: Trim adapters/STABILITY.md

**File:** `packages/adapters/STABILITY.md` — remove 5 generic subsections, add header link.

- [ ] **Step 1: Edit the file**

At the top of `packages/adapters/STABILITY.md`, immediately after the H1 line, insert:

```markdown
> This document covers adapter-specific stability notes. See the repo-wide [`STABILITY.md`](../../STABILITY.md) for the generic policy (deprecation window, what counts as a break, reporting).
```

Then DELETE the five sections (and their content) — these are now covered by the root doc:

1. The `## Deprecation window` section.
2. The `## What counts as a break` section.
3. The `## What does NOT count as a break` section.
4. The `## Reporting a break` section.
5. The `## How to consume` section.

KEEP these adapter-specific sections:
- `## Versioned change log` (and its `### v0.4.0 — composeAuth routing` subsection)
- `## Stable since v0.8.0`
- `## Stable since v0.11.0`
- `## Public surface` paragraph (the `@contractqa/adapters/public` adapter-specific contract — still relevant)

- [ ] **Step 2: Verify**

```bash
# These section headings should NOT appear:
for h in "## Deprecation window" "## What counts as a break" "## What does NOT count as a break" "## Reporting a break" "## How to consume"; do
  if grep -F "$h" packages/adapters/STABILITY.md; then
    echo "FAIL: '$h' still present"
    exit 1
  fi
done
echo "OK: 5 generic sections removed"

# These should still appear:
for h in "## Versioned change log" "## Stable since v0.8.0" "## Stable since v0.11.0" "## Public surface"; do
  grep -F "$h" packages/adapters/STABILITY.md >/dev/null || { echo "FAIL: '$h' missing"; exit 1; }
done
echo "OK: 4 adapter-specific sections preserved"

# Header link present:
grep -q "../../STABILITY.md" packages/adapters/STABILITY.md && echo "OK: header link present"
```

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/STABILITY.md
git commit -m "docs(adapters): trim STABILITY.md — generic policy moved to root, header links to it"
```

---

### Task B6: `@experimental` JSDoc tags on runHttpContract + FirestoreBackendAdapter

**Files:**
- Modify: `packages/runner/src/run-contract.ts`
- Modify: `packages/adapters/src/backend/firestore.ts`

- [ ] **Step 1: Tag `runHttpContract` JSDoc**

In `packages/runner/src/run-contract.ts`, locate the JSDoc block immediately before `export async function runHttpContract(...)`. The current block starts with `/**` and contains the description. Add `@experimental` as the FIRST line of the body:

```ts
/**
 * @experimental
 *
 * Sibling to `runContract` for HTTP-API contracts (no Playwright).
 *
 * ... existing description ...
 */
export async function runHttpContract(...) { ... }
```

- [ ] **Step 2: Tag `FirestoreBackendAdapter`**

In `packages/adapters/src/backend/firestore.ts`, find the `FirestoreBackendAdapter` class JSDoc (the block immediately before `export class FirestoreBackendAdapter`). Add `@experimental` as the first line:

```ts
/**
 * @experimental
 *
 * Read-only Firestore BackendAdapter.
 *
 * ... existing description ...
 */
export class FirestoreBackendAdapter implements BackendAdapter {
```

Also add `@experimental` to the JSDoc of:
- The constructor (`constructor(opts: FirestoreBackendAdapterOpts)`)
- The `query()` method

If those don't have JSDoc blocks yet, add minimal ones:

```ts
  /** @experimental — see class-level note. */
  constructor(opts: FirestoreBackendAdapterOpts) { ... }

  /** @experimental — see class-level note. */
  async query(name: string, params: Record<string, unknown>): Promise<unknown[]> { ... }
```

- [ ] **Step 3: Verify**

```bash
grep -c "@experimental" packages/runner/src/run-contract.ts
# Expect: 1
grep -c "@experimental" packages/adapters/src/backend/firestore.ts
# Expect: 3 (class, constructor, query)

# Build + typecheck (JSDoc tags don't affect runtime, but typecheck verifies syntax):
pnpm --filter @contractqa/runner build 2>&1 | tail -3
pnpm --filter @contractqa/adapters build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/runner/src/run-contract.ts packages/adapters/src/backend/firestore.ts
git commit -m "docs: @experimental JSDoc on runHttpContract + FirestoreBackendAdapter"
```

---

# Part C — Phase 12 leftover polish

**Acceptance gate C:** Content-Type header check in `runHttpContract` is case-insensitive (`Content-Type`, `content-type`, `CONTENT-TYPE`, `Content-type` all treated the same). The 4 non-http Action zod variants (`goto`, `click`, `fill`, `wait`) reject unknown keys. `runHttpContract` JSDoc explicitly states the HTTP status is informational.

---

### Task C1: Content-Type case-insensitive normalization in runHttpContract

**Files:**
- Modify: `packages/runner/src/run-contract.ts` (the header normalization block ~ lines 229-232)
- Modify: `packages/runner/tests/http-action.test.ts` (add cases)

- [ ] **Step 1: Append failing test**

Append to `packages/runner/tests/http-action.test.ts`:

```ts
it('does not re-apply application/json default when header is "Content-Type" (any case)', async () => {
  for (const headerName of ['Content-Type', 'content-type', 'CONTENT-TYPE', 'Content-type']) {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    await runHttpContract({
      contract: {
        id: 'INV-CT',
        title: 'ct case',
        area: 'backend',
        severity: 'P1',
        actions: [{
          type: 'http',
          method: 'POST',
          path: '/api/x',
          body: { x: 1 },
          headers: { [headerName]: 'application/xml' },
        }],
        expected: {},
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://x',
    });

    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    // The user's explicit Content-Type must be preserved — default 'application/json' must NOT clobber it.
    const ctVals = Object.entries(headers)
      .filter(([k]) => k.toLowerCase() === 'content-type')
      .map(([, v]) => v);
    expect(ctVals).toContain('application/xml');
    expect(ctVals).not.toContain('application/json');
  }
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @contractqa/runner exec vitest run tests/http-action.test.ts -t "Content-Type" 2>&1 | tail -10
# Expect: FAIL for 'CONTENT-TYPE' and 'Content-type' cases (the current code only checks
# 'Content-Type' and 'content-type' exactly).
```

- [ ] **Step 3: Lowercase headers in `runHttpContract`**

In `packages/runner/src/run-contract.ts`, find the block (currently around lines 229-232):

```ts
const headers: Record<string, string> = { ...(a.headers ?? {}) };
if (a.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
  headers['Content-Type'] = 'application/json';
}
```

Replace with:

```ts
// Normalize incoming header names to lowercase so the default Content-Type
// check below is case-insensitive (HTTP headers are case-insensitive by RFC).
const headers: Record<string, string> = {};
for (const [k, v] of Object.entries(a.headers ?? {})) {
  headers[k.toLowerCase()] = v;
}
if (a.body !== undefined && headers['content-type'] === undefined) {
  headers['content-type'] = 'application/json';
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @contractqa/runner exec vitest run tests/http-action.test.ts 2>&1 | tail -10
# Expect: full pass (the new test + existing tests).
```

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/runner/src/run-contract.ts packages/runner/tests/http-action.test.ts
git commit -m "fix(runner): runHttpContract — case-insensitive Content-Type default check"
```

---

### Task C2: `.strict()` on 4 non-http Action zod variants

**Files:**
- Modify: `packages/core/src/schemas/contract.schema.ts` (lines 34-37)
- Create: `packages/core/tests/strict-action-variants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/strict-action-variants.test.ts
import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../src/schemas/contract.schema.js';

const base = {
  id: 'INV', title: 't', area: 'a', severity: 'P1' as const,
  expected: {}, risk_tags: [], preconditions: {},
  verification: { wait_ms: 0, retries: 0, evidence_required: [] },
};

describe('Action variants reject unknown keys (.strict())', () => {
  it('goto rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'goto', path: '/', foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('click rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'click', target: { role: 'button' }, foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('fill rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'fill', target: { role: 'textbox' }, value: 'x', foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('wait rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'wait', ms: 100, foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('http rejects unknown key (regression — already strict in Phase 12)', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'http', method: 'GET', path: '/x', foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('goto still accepts valid shape', () => {
    expect(ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'goto', path: '/' }],
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @contractqa/core exec vitest run tests/strict-action-variants.test.ts 2>&1 | tail -10
# Expect: 4 FAIL (goto/click/fill/wait don't reject unknown keys yet);
# 1 PASS (http already has .strict()); 1 PASS (valid goto still accepted).
```

- [ ] **Step 3: Add `.strict()` to lines 34-37 of `contract.schema.ts`**

Current code:
```ts
z.object({ type: z.literal('goto'), path: z.string(), locale: z.string().optional() }),
z.object({ type: z.literal('click'), target: Target }),
z.object({ type: z.literal('fill'), target: Target, value: z.string() }),
z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }),
```

Append `.strict()` to each (mirroring the existing `http` variant at line ~44):

```ts
z.object({ type: z.literal('goto'), path: z.string(), locale: z.string().optional() }).strict(),
z.object({ type: z.literal('click'), target: Target }).strict(),
z.object({ type: z.literal('fill'), target: Target, value: z.string() }).strict(),
z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }).strict(),
```

Note: do NOT add `.strict()` to the `Target` z.object (it's a helper inside `click`/`fill`, and `target.first`, `target.within` etc. are intentionally extensible). Only the outermost Action variant gets strict.

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @contractqa/core exec vitest run tests/strict-action-variants.test.ts 2>&1 | tail -10
# Expect: all 6 PASS.
# Also run the full core suite to ensure no regression in existing tests:
pnpm --filter @contractqa/core exec vitest run 2>&1 | tail -10
# Expect: full pass.
```

If any existing test fails (because it passed an unknown key to one of these variants), update the test to remove the unknown key — that's the point of `.strict()`.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/core/src/schemas/contract.schema.ts packages/core/tests/strict-action-variants.test.ts
git commit -m "fix(core): .strict() on goto/click/fill/wait Action variants (parity with http)"
```

---

### Task C3: `runHttpContract` JSDoc — clarify status is informational

**File:** `packages/runner/src/run-contract.ts`

- [ ] **Step 1: Extend `runHttpContract` JSDoc**

Locate the JSDoc block immediately before `export async function runHttpContract(...)`. After the existing description and the `@experimental` tag (added in Task B6), append a clarifying paragraph:

```ts
/**
 * @experimental
 *
 * Sibling to `runContract` for HTTP-API contracts (no Playwright).
 *
 * All actions in the contract MUST be `type: 'http'`. Iterates them in order,
 * calling `fetch(baseUrl + action.path, { method, body, headers })` for each.
 * If `expected.backend_state` is set, the result of the final fetch is followed
 * by a call to `backend.query(...)` for state verification.
 *
 * **The HTTP response status is informational only.** The verdict is driven by
 * the post-call `backend_state` checks against the `BackendAdapter`. A 4xx/5xx
 * response does NOT automatically produce a FAIL; the contract author can assert
 * on the response state via `backend_state` if they care. (This is by design:
 * many contracts test that a write was rejected with a 4xx AND that no row was
 * persisted — those checks live in `backend_state`.)
 *
 * Does not write an evidence bundle (HTTP has no Playwright trace/HAR/screenshot).
 */
export async function runHttpContract(...) { ... }
```

- [ ] **Step 2: Verify build + grep**

```bash
pnpm --filter @contractqa/runner build 2>&1 | tail -3
grep -c "HTTP response status is informational" packages/runner/src/run-contract.ts
# Expect: 1
```

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/runner/src/run-contract.ts
git commit -m "docs(runner): runHttpContract JSDoc — status is informational, verdict from backend_state"
```

---

# Part D — Release

**Acceptance gate D:** `scripts/phase13-acceptance.sh` exists and exits 0. Root README has Install section. CHANGELOG top entry is `## v1.0.0 — <today>`. All 9 publishable packages report `"version": "1.0.0"`. Third-party template references `@contractqa/adapters@^1.0.0`.

---

### Task D1: Create `scripts/phase13-acceptance.sh`

**File (created):** `scripts/phase13-acceptance.sh`

- [ ] **Step 1: Write the script**

Use the exact content from the spec §13.2. Verbatim:

```bash
#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

cd "$(git rev-parse --show-toplevel)"

pnpm -r build
pnpm -r typecheck
MONGOMS_SKIP=1 pnpm -r test

# Version uniformity across all 9 publishable packages — extract top-level
# .version via node to avoid grep matching nested "version" fields.
unique=$(
  for f in packages/*/package.json; do
    node -e "const v=require('./$f').version; if(!v){console.error('missing version: $f'); process.exit(1);} console.log(v)"
  done | sort -u | wc -l | tr -d ' '
)
if [[ "$unique" != "1" ]]; then
  echo "FAIL: publishable packages not at same version"
  for f in packages/*/package.json; do
    printf "  %-40s %s\n" "$f" "$(node -e "console.log(require('./$f').version)")"
  done
  exit 1
fi

# Use ephemeral working dirs (mktemp -d) — no stale leftovers between runs.
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
dryrun_dir="$work_dir/dryrun"
cli_pack_dir="$work_dir/cli-pack"
runner_pack_dir="$work_dir/runner-pack"
mkdir -p "$dryrun_dir" "$cli_pack_dir" "$runner_pack_dir"

# Dry-run all 9 publishable packages (8 scoped + 1 CLI). Capture stdout to
# verify pnpm rewrites workspace:* to real semver ranges (Risk #1 in §15).
for pkg in core probes oracle evidence orchestrator repro runner adapters; do
  echo "=== @contractqa/$pkg dry-run ==="
  pnpm --filter "@contractqa/$pkg" publish --dry-run --no-git-checks \
    | tee "$dryrun_dir/$pkg.log"
done
echo "=== contractqa dry-run ==="
pnpm --filter contractqa publish --dry-run --no-git-checks \
  | tee "$dryrun_dir/contractqa.log"

# CLI has the most internal workspace deps — its dry-run output must show
# pnpm-rewritten versions, not literal "workspace:" specs.
if grep -E '"@contractqa/[^"]+":\s*"workspace:' "$dryrun_dir/contractqa.log"; then
  echo "FAIL: dry-run output still contains literal 'workspace:*' — pnpm rewrite did not run"
  exit 1
fi

# CLI tarball spot-check.
pnpm --filter contractqa pack --pack-destination "$cli_pack_dir"
cli_tarballs=( "$cli_pack_dir"/*.tgz )
if [[ ${#cli_tarballs[@]} -eq 0 ]]; then
  echo "FAIL: no CLI tarball produced"
  exit 1
fi
cli_tarball="${cli_tarballs[0]}"
tar -tzf "$cli_tarball" | grep -q "^package/dist/bin/contractqa.js" \
  || { echo "FAIL: CLI bin missing from tarball"; exit 1; }
if tar -tzf "$cli_tarball" | grep -E "^package/(src/|tests/|node_modules/)" >/dev/null; then
  echo "FAIL: tarball contains source/tests/node_modules"
  exit 1
fi

# Runner tarball — must contain dist/http.js (the new /http subpath
# introduced in v1.0.0 for Playwright-free HTTP consumers).
pnpm --filter @contractqa/runner pack --pack-destination "$runner_pack_dir"
runner_tarballs=( "$runner_pack_dir"/*.tgz )
if [[ ${#runner_tarballs[@]} -eq 0 ]]; then
  echo "FAIL: no runner tarball produced"
  exit 1
fi
runner_tarball="${runner_tarballs[0]}"
tar -tzf "$runner_tarball" | grep -q "^package/dist/http.js" \
  || { echo "FAIL: runner tarball missing dist/http.js (new /http subpath)"; exit 1; }

echo "OK"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x scripts/phase13-acceptance.sh
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add scripts/phase13-acceptance.sh
git commit -m "chore: scripts/phase13-acceptance.sh — Phase 13 / v1.0 release lane"
```

---

### Task D2: Update root README — Install + Quick start

**File:** `README.md` (repo root)

- [ ] **Step 1: Read current top of README**

```bash
head -20 README.md
```

The current README has H1 `# ContractQA Agent`, a 3-line blockquote, then `## What this is`. Insert the new sections AFTER the blockquote and BEFORE `## What this is`.

- [ ] **Step 2: Insert Install + Quick start sections**

Insert this block between line ~5 (end of blockquote) and `## What this is`:

```markdown
## Install

```bash
npm install contractqa @contractqa/adapters
# Browser-flow users also need:
npm install @playwright/test
npx playwright install chromium
```

See [STABILITY.md](./STABILITY.md) for the semver surface and stability policy.

## Quick start

```ts
// Browser flow (requires @playwright/test)
import { runContract } from '@contractqa/runner';
import { compileContract } from '@contractqa/core';

// HTTP flow (no browser required — must use /http subpath)
import { runHttpContract } from '@contractqa/runner/http';  // @experimental
```

```

(The triple-backticks in this plan are intentional code fences; when materialising into the README, drop any extra escaping.)

- [ ] **Step 3: Verify**

```bash
grep -q "^## Install$" README.md && echo "OK: Install header"
grep -q "^## Quick start$" README.md && echo "OK: Quick start header"
grep -q "@contractqa/runner/http" README.md && echo "OK: /http subpath mentioned"
grep -q "STABILITY.md" README.md && echo "OK: STABILITY link"
```

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add README.md
git commit -m "docs(readme): add Install + Quick start (with /http subpath) + STABILITY link"
```

---

### Task D3: CHANGELOG v1.0.0 entry

**File:** `CHANGELOG.md`

- [ ] **Step 1: Insert the new entry**

Prepend to `CHANGELOG.md` immediately after the `# Changelog` heading and the "All notable changes to ContractQA are documented here." line, BEFORE the existing `## v0.12.0` entry. The implementer fills in `<TODAY>` with the current date (YYYY-MM-DD format):

```markdown
## v1.0.0 — <TODAY> (Phase 13)

This is contractqa's 1.0 release. Twelve consecutive minor releases
(v0.5.0 → v0.12.0) shipped without a breaking change since v0.4.0; this is
Phase 13, the v1.0.0 milestone — the public API is now frozen under semver.

### What's stable at 1.0

- `contractqa` CLI commands and flags
- `@contractqa/adapters/public` — the three-member BackendAdapter family
  (Postgres, Mongo, Firestore — Firestore is `@experimental`, see below),
  all AuthAdapters, `composeAuth`
- The contract schema (action types except http, oracle rules, evidence bundle
  layout)
- `runContract` (Playwright)

### What's experimental at 1.0

- `runHttpContract` (no real dogfood target yet) — exposed via the new
  `@contractqa/runner/http` subpath
- `FirestoreBackendAdapter` (mocked-only tests; real-emulator integration deferred)

### Added

- `@contractqa/runner/http` subpath — Playwright-free entry point for
  HTTP-only consumers. New file `packages/runner/src/http.ts` re-exports
  `runHttpContract` and its associated types.
- Root `STABILITY.md`
- `engines.node >= 18` on all 9 publishable packages
- `publishConfig.access: "public"` + `files` whitelist on the 8 packages
  that didn't already have them
- CLI runtime check for `@playwright/test` — fail-fast with install hint if
  missing. Placed immediately before the `pnpm exec playwright test` spawn
  in `packages/cli/src/commands/run.ts`. `run` is the only browser-required
  command at v1.0; `doctor`/`init`/`invariants-gen`/`scan` do not spawn or
  import Playwright.
- `.strict()` enforcement on 4 non-http Action schema variants
  (`goto`/`click`/`fill`/`wait`)
- Content-Type case-insensitive normalization in `runHttpContract`
- `@experimental` JSDoc tags on `runHttpContract` and `FirestoreBackendAdapter`
- `README.md` for each of the 9 publishable packages (the 7 internal packages
  carry an "internal" warning block; CLI and adapters have user-facing READMEs)

### Changed (non-breaking)

- `@playwright/test` reclassified from `dependencies` to optional
  `peerDependencies` in `@contractqa/runner`. **HTTP-only consumers must
  import from `@contractqa/runner/http`** to actually skip the Playwright
  install — the runner root barrel still loads `playwright-entry.ts` at
  module init. Browser-using consumers run
  `npm install @playwright/test && npx playwright install chromium` once.
- TypeScript users importing `ContractQAReporter` or `ReporterOptions` from
  `@contractqa/runner` root must still have `@playwright/test` installed for
  TS type resolution (its `reporter.ts` imports types from
  `@playwright/test/reporter`). This is a type-only requirement, unchanged
  from v0.12.0; documented here for completeness.
- `packages/adapters/STABILITY.md` trimmed; common policy moved to root doc.
  Adapter-specific sections (`composeAuth` routing log, per-adapter "Stable
  since" timelines, Mongo/Firestore-specific rules) remain.
- `runHttpContract` Content-Type header check is now case-insensitive
  (`Content-Type`, `content-type`, `CONTENT-TYPE`, `Content-type` all
  treated the same). Default `application/json` no longer clobbers a
  user-supplied header in unusual cases.

### Notes

`pnpm publish` to the npm registry is user-gated; this release is tagged
locally and the publish step is taken outside CI by the maintainer. The
`scripts/phase13-acceptance.sh` script validates that `pnpm publish
--dry-run` passes for all 9 publishable packages.
```

- [ ] **Step 2: Verify**

```bash
head -10 CHANGELOG.md | grep -q "## v1.0.0" && echo "OK: v1.0.0 is the top entry"
grep -q "@contractqa/runner/http" CHANGELOG.md && echo "OK: /http subpath mentioned"
grep -q "case-insensitive" CHANGELOG.md && echo "OK: Content-Type fix mentioned"
```

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add CHANGELOG.md
git commit -m "docs: CHANGELOG v1.0.0 entry — public API freeze + /http subpath + polish"
```

---

### Task D4: Lockstep version bump 0.12.0 → 1.0.0

**Files:**
- Modify: 9 `packages/*/package.json`
- Modify: `packages/adapters/templates/third-party/package.json` (depends on `@contractqa/adapters@^0.12.0`)

- [ ] **Step 1: Bump all 9 publishable packages**

```bash
for f in packages/*/package.json; do
  # macOS sed needs '' after -i for in-place. The pattern matches only the top-level
  # version line (it's the first occurrence in the file and at indent 2).
  sed -i '' 's/"version": "0.12.0"/"version": "1.0.0"/' "$f"
done

# Verify all 9 are at 1.0.0:
for f in packages/*/package.json; do
  printf "%-40s %s\n" "$f" "$(node -e "console.log(require('./$f').version)")"
done
# Expect: all 9 show 1.0.0
```

- [ ] **Step 2: Bump third-party template's adapter dep**

```bash
sed -i '' 's/"@contractqa\/adapters": "\^0.12.0"/"@contractqa\/adapters": "^1.0.0"/' \
  packages/adapters/templates/third-party/package.json
grep '"@contractqa/adapters"' packages/adapters/templates/third-party/package.json
# Expect: ^1.0.0
```

- [ ] **Step 3: Re-install to update lockfile**

```bash
pnpm install --prefer-offline 2>&1 | tail -3
# Lockfile should pick up new internal versions. Confirm:
git diff pnpm-lock.yaml | head -30
```

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/*/package.json packages/adapters/templates/third-party/package.json pnpm-lock.yaml
git commit -m "chore: bump all 9 publishable packages to v1.0.0 (lockstep)"
```

---

### Task D5: Run acceptance script + verify all gates

- [ ] **Step 1: Run the acceptance script**

```bash
bash scripts/phase13-acceptance.sh 2>&1 | tail -30
# Expect: final line is "OK"; no FAIL above it.
```

If FAIL: read the FAIL line, fix the underlying issue in the appropriate package.json / tarball / dry-run output, recommit, re-run.

- [ ] **Step 2: Run the full test suite one more time**

```bash
MONGOMS_SKIP=1 pnpm -r test 2>&1 | tail -10
# Expect: full pass across all packages.
```

- [ ] **Step 3: Sanity check version + tag absence**

```bash
git log --oneline -15
git tag --list | sort -V | tail -5
# Expect: latest tag is still v0.12.0 (this phase doesn't tag in the worktree).

# All 9 at 1.0.0:
for f in packages/*/package.json; do
  node -e "console.log('$f: ' + require('./$f').version)"
done
```

- [ ] **Step 4: NO COMMIT here**

The acceptance script run is verification, not a code change. Nothing new to commit.

---

## Self-review notes

**Spec coverage** — each spec deliverable is implemented:

| Spec § | Deliverable | Task |
|---|---|---|
| §3.1 | publishConfig + files + engines on 9 packages | A1 |
| §3.2 | `/http` subpath + Playwright peer reclassification | A2 |
| §3.3 | CLI runtime Playwright check before spawn | A3 |
| §3.4 | 7 internal package README warnings | B1 |
| §3.5 | Root `STABILITY.md` | B4 |
| §3.6 | Trim `adapters/STABILITY.md` | B5 |
| §3.7 | `@experimental` JSDoc on `runHttpContract` + `FirestoreBackendAdapter` | B6 |
| §3.8 | Phase 12 polish (Content-Type, `.strict()`, runHttpContract JSDoc) | C1 + C2 + C3 |
| §3.9 | Lockstep version bump | D4 |
| §3.10 | CHANGELOG v1.0.0 entry | D3 |
| §3.11 | Update root README | D2 |
| §3.12 | `scripts/phase13-acceptance.sh` | D1 |
| §13.2 | Acceptance script body | D1 (verbatim from spec) |
| §14 (acceptance criteria) | All gates verified | D5 |

**Spec gap surfaced during plan-writing:** the 9 publishable packages currently have NO README files. The spec said "Add an 'internal package' warning block to the README of the 7 internal packages" assuming READMEs exist; in fact they need to be created. Plan adds Task B1/B2/B3 to create them — without these, the `files: ["dist", "README.md"]` whitelist would include a non-existent file. Implementation matches the spec's intent (advertise public surface to consumers; warn internal-package importers).

**Type consistency:**
- `checkPlaywright` returns `{ ok: true } | { ok: false; error: string }`. Used in `runContracts` and tested via the same shape.
- `PlaywrightResolver` interface has one method `resolve(id: string): string`. `createRequire(import.meta.url)` matches this interface (its `.resolve` returns string).
- `RunHttpContractInput` and `RunHttpContractResult` are unchanged from Phase 12.

**Risks the plan addresses:**

1. **README files don't exist for the 9 publishable packages.** `files: ["dist", "README.md"]` references a missing file. Plan creates all 9 (Tasks B1/B2/B3). Acceptance script would catch this via tarball spot-check, but creating proactively is cleaner.
2. **`Target` z.object inside `click`/`fill` should NOT be `.strict()`.** Adding `.strict()` to `Target` would break `target.first`/`target.within`/`target.text` etc. Plan explicitly says do not strict Target — only the outer Action variants.
3. **JSDoc `@experimental` tags interact with TypeScript compilation.** They're comments, so they don't affect compilation. Verified via build.
4. **The 7 internal packages currently have no README; `files: ["dist", "README.md"]` references a missing file.** Plan creates them.

**Risks the plan does NOT fully address (caveats):**

1. **The `/http` subpath smoke test uses `readFile` on `../src/http.ts` to assert no `@playwright` import.** This is a source-level check, not a resolved-module check. If a transitive dep imports Playwright (it shouldn't, per the spec's verification), the test wouldn't catch it. A more thorough test would actually import in a child Node process with `@playwright/test` un-resolvable — but that's more complex. Plan accepts the source-level check.

2. **`createRequire(import.meta.url).resolve('@playwright/test')` may succeed in dev (workspace has Playwright installed) but fail in a published consumer's env.** This is the EXPECTED behaviour — the test injects a fake resolver to simulate the failure case. The integration is implicitly verified by the dry-run + tarball checks.

3. **`pnpm publish --dry-run` doesn't validate that the resulting tarball ACTUALLY installs.** A consumer-side install smoke test (e.g., `pnpm pack` → install in a sibling tmp dir → import) would be more thorough but out of scope. Plan trusts the dry-run + tarball file-list checks.

**Commit count estimate:** 14 commits.

A1, A2, A3 (3) + B1, B2, B3, B4, B5, B6 (6) + C1, C2, C3 (3) + D1, D2, D3, D4 (4) = **16 commits**. D5 is a verification, no commit.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-contractqa-phase-13.md`.

Two execution options:

**1. Subagent-Driven (recommended for Phase 13)** — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Fresh subagent per task (or per part), two-stage review between major parts. Best for the 16-commit scope.

**2. Inline Execution** — REQUIRED SUB-SKILL: `superpowers:executing-plans`. Batch execution with checkpoints; faster but more prone to context drift across 16 commits.

Suggested next step:
1. `EnterWorktree(branch: phase-13-exec)` to isolate.
2. Bundle parts into 1-2 sonnet dispatches (A+B+C as bundle 1; D as bundle 2, since D depends on A/B/C completing).
3. Opus final review of the cumulative diff against the spec + plan.
4. FF-merge to `main` + annotated tag `v1.0.0` (outside the worktree).

Estimated total: 2–2.5 hours, conservatively 3h if opus surfaces non-trivial follow-ups.
