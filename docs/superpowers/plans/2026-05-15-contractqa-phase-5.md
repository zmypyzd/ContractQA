# ContractQA Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 4's `PostgresBackendAdapter` actually consumable end-to-end by adding HTTP-API contract support to the runner and shipping the api-only `agent-poker-platform` dogfood target. Plus close 7 final-review follow-ups from Phase 4 + bring docs back in sync.

**Architecture:** Two parts plus a release sub-part.

- **Part A — B5: HTTP-API contract surface.** Add `action.kind: 'http'` to the contract schema; add an HTTP execution path to `runContract` that's siblings (not replacement) to the existing Playwright path; create `dogfood/agent-poker-platform/` (no-suffix, api-only) with `INV-B1` exercising `POST /api/v1/tables` → `tablesByOwner` named-query rowCount=1 via `PostgresBackendAdapter`.
- **Part B — QA pass: 7 final-review follow-ups + README sync.** Bundle the deferred items from Phase 4's final code review into one focused part: writable-CTE deepening, README Phase 3/4 status drift, scoped workspace package detection, `findPnpmPkgDir` multi-version test, `runNpmInstallScript` missing-install-script UX hint, sniffer/buffer review verification, symlink walk safety in `detectFrameworkInRepo`.
- **Part C — Release:** Acceptance script gains a B5 section; CHANGELOG; v0.5.0 bump; tag.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest, `pg` (already shipped in v0.4.0), Docker Compose (`fixtures/supabase-stack/` reused for B5's Postgres backend).

---

## Required reading (before starting)

1. `docs/superpowers/plans/2026-05-15-contractqa-phase-4.md` — "Out of Phase 4" + the executed Part B (B1-B4). B5 is the natural continuation; the schema/adapter/runner work it builds on is already in place.
2. `dogfood/FINDINGS.md` — "Findings STILL DEFERRED to Phase 5" lists the candidate pool. This plan picks B5 + the 7 final-review follow-ups; the rest stay deferred.
3. Phase 4 final-review subagent output (captured in session transcript) — the 7 follow-ups in Part B trace back to Critical/Important/Minor issues from that review.
4. `packages/runner/src/run-contract.ts` — Phase 4 added `backend?:` and `evaluateBackendState`; B5 adds the HTTP-action sibling to the existing Playwright-page execution.
5. `packages/adapters/src/backend/postgres.ts` — read-only DSN guard already present from Phase 4 (commit `286f520` adds writable-CTE rejection). B5 consumes this; Q5 deepens the CTE detection.

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict | Source |
|---|---|---|
| Phase 5 anchor count | 1 (B5) + a "QA pass" mini-part | User explicitly chose "B5 + QA pass only" over Hybrid-auth scanner / Persona dogfood agents / Mongo+Firestore. |
| HTTP action shape | New `action.kind: 'http'` discriminated variant in the existing `Action` union | Schema-side addition; matches the `goto`/`click`/`fill`/`wait` pattern. Backwards compatible. |
| Runner HTTP execution | Sibling code path to Playwright; `runContract` accepts EITHER a `page` OR HTTP-only mode | Don't restructure the runner; add a `runHttpContract` (or branch inside `runContract`) that's invoked when no `page` is supplied. |
| agent-poker-platform target requires Docker Postgres | Use existing `fixtures/supabase-stack/` Postgres for the dogfood test (port 54322) | Reuses Phase 3 infra; no new fixture. |
| Writable-CTE deepening | Add a CTE-body regex check, NOT a full SQL parser | Per Phase 4 final review: "operator-trusted" model already documented; a quick CTE-body grep covers obvious cases without taking on a parser dependency. |
| README sync | Add Phase 3 + Phase 4 status sections + clean stale "out of Phase 2" paragraph | Final review I3. |
| Mongo / Firestore BackendAdapter | DEFERRED to Phase 6+ | Not picked. Pattern exists; future plans copy from Postgres. |
| Version target | v0.5.0 | All workspace packages bump together; tag annotated like v0.4.0. |

---

## Non-goals (do not touch)

- Mongo / Firestore / custom `BackendAdapter` implementations.
- Hybrid-auth scanner (`scan --detect-auth`).
- Persona dogfood agents.
- Dashboard §15.3–§15.6.
- Property/model-based test generation.
- TypeScript project references via `tsc -b`.
- pnpm-version-aware spawn helper.
- Publishing to npm — `pnpm publish` is user-gated.
- Refactoring `runContract` beyond the minimum needed for HTTP support.

---

## Dependency graph

```
Part A (B5: HTTP) ────┐
                      ├──► Part C (acceptance + release)
Part B (QA pass)  ────┘
```

Parts A and B are independent. Suggested worktree layout (matches Phase 4):
- `.claude/worktrees/phase5-exec`

---

# Part A: B5 — HTTP-API contract surface

**Acceptance gate A:** `dogfood/agent-poker-platform/dogfood.test.ts` drives an INV against the api-only `agent-poker-platform` repo via `PostgresBackendAdapter`. Action `kind: 'http'` performs the POST; `backend_state.named_query` then queries the Postgres backend; verdict is PASS. Test runs from `pnpm --filter @contractqa/dogfood test` and the new acceptance script section.

---

### Task A1: Add `kind: 'http'` to action schema

**Files:**
- Modify: `packages/core/src/schemas/contract.schema.ts` — extend the `Action` discriminated union.
- Test: `packages/core/tests/schemas/contract-action-http.test.ts` (create).

- [ ] **Step 1: Inspect the current `Action` shape**

```bash
grep -A 8 "const Action" packages/core/src/schemas/contract.schema.ts
```

Today: `goto | click | fill | wait`, all using `type:` discriminator. NOTE: the field is `type`, not `kind` — adapt the plan's wording.

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/tests/schemas/contract-action-http.test.ts
import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../../src/schemas/contract.schema.js';

const baseContract = {
  id: 'INV-HTTP',
  title: 'HTTP action shape',
  area: 'backend',
  severity: 'P1' as const,
};

describe('contract schema — http action', () => {
  it('accepts a POST action with body', () => {
    const r = ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'POST', path: '/api/v1/tables', body: { name: 'x' } }],
      expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 1 } } },
    });
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('accepts a GET action without body', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'GET', path: '/api/v1/tables' }],
      expected: { url: { matches: '^/api' } },
    }).success).toBe(true);
  });

  it('rejects http action with unsupported method', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'TRACE', path: '/x' }],
      expected: {},
    }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Verify FAIL** — `pnpm --filter @contractqa/core exec vitest run tests/schemas/contract-action-http.test.ts` — 3 FAIL (unknown discriminator value `http`).

- [ ] **Step 4: Extend the Action union**

```ts
// packages/core/src/schemas/contract.schema.ts — add to Action union
z.object({
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
}).strict(),
```

- [ ] **Step 5: Verify PASS** — 3 PASS + existing core tests stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/contract.schema.ts packages/core/tests/schemas/contract-action-http.test.ts
git commit -m "feat(core): add http action variant (GET/POST/PUT/PATCH/DELETE) to contract schema"
```

---

### Task A2: Runner HTTP execution path

**Files:**
- Modify: `packages/runner/src/run-contract.ts` — add a sibling HTTP execution path.
- Test: `packages/runner/tests/http-action.test.ts` (create).

**Goal:** Today `runContract` requires a Playwright `page`. For HTTP-only contracts (no DOM, no browser), the page parameter is irrelevant. Add a branch: when `contract.actions[0].type === 'http'`, perform `fetch()` instead of Playwright navigation; skip browser-snapshot blocks in `expected` (they should also be absent for HTTP contracts — validated by zod elsewhere or just no-op'd).

- [ ] **Step 1: Inspect current `runContract` action dispatch**

```bash
grep -n "action.type\|actions\[" packages/runner/src/run-contract.ts | head
```

Find where actions are executed. Plan to add a dispatch on `action.type === 'http'`.

- [ ] **Step 2: Failing test**

```ts
// packages/runner/tests/http-action.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runContract } from '../src/run-contract.js';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

class FakeBackend implements BackendAdapter {
  readonly kind = 'postgres' as const;
  constructor(private rows: unknown[]) {}
  describe(): SchemaDescriptor { return { tenantField: 'user_id', namedQueries: [{ name: 'q', description: '', params: {} }] }; }
  async query(): Promise<unknown> { return this.rows; }
}

describe('runContract — http action', () => {
  it('executes http POST and reaches backend_state PASS', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;

    const r = await runContract({
      contract: {
        id: 'INV-HTTP',
        title: 'http test',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'POST', path: '/api/v1/tables', body: { name: 'x' } }],
        expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 1 } } },
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
      } as any,
      // No page provided — runContract should pick HTTP path
      backend: new FakeBackend([{ id: 'tbl' }]),
      baseUrl: 'http://127.0.0.1:3287',
    } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3287/api/v1/tables',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(r.verdict.verdict).toBe('PASS');
  });
});
```

- [ ] **Step 3: Verify FAIL** — `pnpm --filter @contractqa/runner exec vitest run tests/http-action.test.ts`.

- [ ] **Step 4: Implement HTTP branch in runContract**

Add at the top of `runContract`:
```ts
const firstAction = input.contract.actions[0];
if (firstAction?.type === 'http') {
  return runHttpContract(input);
}
```

Add a new `runHttpContract` function that:
1. Iterates `actions` (all must be `type: 'http'`; throws if mixed).
2. For each action: `await fetch(\`${input.baseUrl}${a.path}\`, { method: a.method, headers: a.headers, body: a.body ? JSON.stringify(a.body) : undefined })`.
3. Captures the LAST response status into a synthetic "after" snapshot.
4. Calls `evaluateBackendState` if `expected.backend_state` is set.
5. Returns a `RunContractResult`-shaped object with `verdict` set per backend evaluation.

The HTTP path skips Playwright bundle writing (no trace, no HAR). `bundleDir` returns `null` unless explicitly provided. (Phase 5 follow-up could be a "minimal HTTP bundle"; out of scope here.)

Add `baseUrl?: string` to `RunContractInput` (used by both Playwright path via `stripBaseUrl` and HTTP path; default to `''` if omitted).

- [ ] **Step 5: Verify PASS + existing runner tests stay green** — `pnpm --filter @contractqa/runner exec vitest run`.

- [ ] **Step 6: Commit**

```bash
git add packages/runner/src/run-contract.ts packages/runner/tests/http-action.test.ts
git commit -m "feat(runner): http action execution path (sibling to Playwright)"
```

---

### Task A3: agent-poker-platform dogfood target

**Files:**
- Create: `dogfood/agent-poker-platform/contracts/INV-B1.yml`
- Create: `dogfood/agent-poker-platform/dogfood.test.ts`
- Create: `dogfood/agent-poker-platform/FINDINGS.md`
- Create: `dogfood/agent-poker-platform/noise-profile.yml`

**Goal:** End-to-end exercise of B5 against the real api-only `agent-poker-platform` repo at `/Users/zmy/intership/4/agent-poker-platform`. Repo verified to exist; only `apps/api`; uses `pnpm --filter api run dev` like the gpt variant.

- [ ] **Step 1: Verify target repo state**

```bash
ls /Users/zmy/intership/4/agent-poker-platform/apps  # should print: api
grep '"dev"' /Users/zmy/intership/4/agent-poker-platform/apps/api/package.json
```

If layout differs from expectation, STOP and report.

- [ ] **Step 2: Confirm Postgres availability**

```bash
ls fixtures/supabase-stack/scripts/up.sh
```

The dogfood test will use the Phase 3 supabase-stack Postgres (port 54322) via `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` (or whatever Supabase CLI reports — check via `supabase status -o env` after `up.sh`).

- [ ] **Step 3: Write the contract**

```yaml
# dogfood/agent-poker-platform/contracts/INV-B1.yml
id: INV-B1
title: 'POST /api/v1/tables creates a table visible via tablesByOwner named-query'
area: backend
severity: P1
risk_tags: [backend, http]
actions:
  - type: http
    method: POST
    path: /api/v1/tables
    body:
      name: dogfood-test
expected:
  backend_state:
    named_query: tablesByOwner
    params:
      user_id: $session.userId   # Phase 5 follow-up: real session-userId resolution; for now pass a known seeded test-user
    assert:
      rowCount: 1
```

NOTE: `$session.userId` resolution is NOT shipped. For Phase 5, hardcode a seeded user_id (e.g., `'test-user-1'`) and document this as a Phase 6 follow-up: dynamic session-context substitution.

- [ ] **Step 4: Write the dogfood test**

```ts
// dogfood/agent-poker-platform/dogfood.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDir, runContract } from '@contractqa/runner';
import { PostgresBackendAdapter } from '@contractqa/adapters/public';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TARGET_REPO = '/Users/zmy/intership/4/agent-poker-platform';
const API_PORT = Number(process.env.DOGFOOD_BAREAPI_PORT ?? '3687');
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const POSTGRES_DSN = process.env.DOGFOOD_POSTGRES_DSN
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let api: ChildProcess | undefined;

beforeAll(async () => {
  api = spawn('pnpm', ['--filter', 'api', 'run', 'dev'], {
    cwd: TARGET_REPO,
    env: { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1', NODE_ENV: 'test', DATABASE_URL: POSTGRES_DSN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stderr?.on('data', (d) => process.stderr.write(`[bare-api] ${d}`));
  await pollHealth(`${API_BASE}/health`, 60_000);
}, 90_000);

afterAll(async () => {
  if (api && !api.killed) {
    api.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 300));
    if (!api.killed) api.kill('SIGKILL');
  }
});

describe('ContractQA dogfood — agent-poker-platform (api-only, L2)', () => {
  it('INV-B1: POST /api/v1/tables makes table visible via tablesByOwner', async () => {
    const contracts = await loadContractsFromDir(path.join(__dir, 'contracts'));
    const inv = contracts.find((c) => c.id === 'INV-B1');
    expect(inv).toBeTruthy();

    const backend = new PostgresBackendAdapter({
      dsn: POSTGRES_DSN,
      tenantField: 'user_id',
      namedQueries: {
        tablesByOwner: {
          description: 'tables owned by a user',
          sql: 'SELECT id FROM tables WHERE owner_user_id = $1',
          params: { user_id: '$1' },
        },
      },
    });

    try {
      const result = await runContract({
        contract: inv!,
        backend,
        baseUrl: API_BASE,
      } as any);
      expect(result.verdict.verdict).toBe('PASS');
    } finally {
      await backend.close();
    }
  });
});

async function pollHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`health never ready at ${url}`);
}
```

NOTE: this test requires (a) the agent-poker-platform repo to be installed (`pnpm install` in that repo), (b) the supabase-stack Postgres running, (c) a `tables` table with `owner_user_id` column (assumed exists; STOP and report if not — schema migration is out of B5 scope). The test is gated behind `DOGFOOD_POSTGRES_DSN` env var or skipped via vitest's `describe.skipIf` if not provided. Adapt the test to skip cleanly if the prerequisites aren't met.

- [ ] **Step 5: Write FINDINGS.md + noise-profile.yml**

```markdown
# dogfood/agent-poker-platform/FINDINGS.md

L2 dogfood for the api-only `agent-poker-platform` (no suffix). Exercises
Phase 4's `PostgresBackendAdapter` + Phase 5's `action.kind: 'http'` runner
support. Findings will accumulate here as contracts are added.
```

```yaml
# dogfood/agent-poker-platform/noise-profile.yml
# (minimal — HTTP contracts don't need DOM noise filtering)
```

- [ ] **Step 6: Commit**

```bash
git add dogfood/agent-poker-platform/
git commit -m "feat(dogfood): agent-poker-platform L2 target (api-only, BackendAdapter+http)"
```

---

# Part B: QA pass — final-review follow-ups + README sync

**Acceptance gate B:** All 7 final-review follow-ups closed (or explicitly deferred with rationale); README has Phase 3 + Phase 4 status sections; no stale references to "Phase 3+ candidates" for things that shipped.

---

### Task B1: README Phase 3 + Phase 4 status sections

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README around line 30-60 (the Phase 1/2 status sections).**

- [ ] **Step 2: Add Phase 3 status section after Phase 2's, before "Quick start"**

```markdown
## Phase 3 status (CLI onboarding + real-cloud Supabase + public adapter API)

- [x] `contractqa init` auto-detects framework (no `--provider` flag needed)
- [x] `contractqa scan` writes `qa/SCAN_REPORT.md`
- [x] `contractqa doctor --fix=<list>` remediates native-deps / env-stub / port-collision
- [x] `SupabaseAuthAdapter` v2 with default `loginAs`
- [x] Vendored Supabase fixture (CLI-based as of v0.3.1)
- [x] `@contractqa/adapters/public` semver-stable surface + STABILITY.md + third-party template

## Phase 4 status (doctor hardening + BackendAdapter L2 + monorepo + composeAuth)

- [x] `contractqa doctor --fix=native-deps` walks workspace packages; pnpm 10 rebuild path
- [x] Boot probe → ABI mismatch hint synthesis
- [x] `PostgresBackendAdapter` real impl (read-only DSN, mandatory tenant scope, named queries only)
- [x] `backend_state` block in contract schema; runner `evaluateBackendState`
- [x] Monorepo-aware `init` and `scan` (walks apps/*, packages/*, web, frontend, client, site)
- [x] `composeAuth` per-responsibility routing (currentUser → user-store; expectFullyLoggedOut → all + AND)
```

- [ ] **Step 3: Update the "Out of Phase 2" paragraph to reflect what shipped**

Replace:
```
Out of Phase 2 (Phase 3+): `BackendAdapter` for HTTP-API contracts,
framework-aware `contractqa init` / `scan`, persona dogfood agents,
property/model-based generation, dashboard §15.3–§15.6, real-Supabase
/ real-NextAuth fixtures, public adapter API. See
[`dogfood/FINDINGS.md`](dogfood/FINDINGS.md) for the complete list.
```

With:
```
Out of Phase 4 (Phase 5+): HTTP-API contract surface for api-only repos
(B5 — Phase 5 anchor), Mongo / Firestore BackendAdapter, hybrid-auth
scanner, persona dogfood agents, property/model-based generation,
dashboard §15.3–§15.6, TypeScript project references. See
[`dogfood/FINDINGS.md`](dogfood/FINDINGS.md) for the complete list.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(README): add Phase 3 + Phase 4 status sections; refresh deferred list"
```

---

### Task B2: detectFrameworkInRepo — scoped pkg + symlink walk + multi-version test

**Files:**
- Modify: `packages/cli/src/init/detect-framework.ts`
- Modify: `packages/cli/tests/detect-framework-monorepo.test.ts` (add tests)

- [ ] **Step 1: Append failing tests**

```ts
// In detect-framework-monorepo.test.ts
it('walks scoped workspace packages (apps/@scope/pkg)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-scoped-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  await mkdir(path.join(root, 'apps/@org/web'), { recursive: true });
  await writeFile(path.join(root, 'apps/@org/web/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
  await writeFile(path.join(root, 'apps/@org/web/vite.config.ts'), '');
  const r = await detectFrameworkInRepo(root);
  expect(r.candidates.find((c) => c.subdir === 'apps/@org/web')).toBeDefined();
});

it('skips symlinked subdirs to avoid descending into pnpm injection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-symlink-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }));
  await mkdir(path.join(root, 'apps'), { recursive: true });
  await mkdir(path.join(root, 'real-pkg'), { recursive: true });
  await writeFile(path.join(root, 'real-pkg/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
  await writeFile(path.join(root, 'real-pkg/vite.config.ts'), '');
  await symlink(path.join(root, 'real-pkg'), path.join(root, 'apps/linked'));
  const r = await detectFrameworkInRepo(root);
  expect(r.candidates.find((c) => c.subdir === 'apps/linked')).toBeUndefined();
});
```

(Add `import { symlink } from 'node:fs/promises'`.)

- [ ] **Step 2: Update `detectFrameworkInRepo` walker**

In the `apps`/`packages` deep-walk:
- For each subdir entry, after `readdir`, if it starts with `@`, walk one MORE level (treat `@scope/pkg`).
- For each candidate path, check `lstat(...).isSymbolicLink()` before descending; skip symlinks.

```ts
import { lstat } from 'node:fs/promises';

// In the apps/packages loop, replace:
const subs = await readdir(hintPath);
for (const s of subs) {
  const subPath = path.join(hintPath, s);
  if ((await lstat(subPath)).isSymbolicLink()) continue;
  if (s.startsWith('@')) {
    // Scoped: walk one more level
    const scopedSubs = await readdir(subPath);
    for (const ss of scopedSubs) {
      const scopedPath = path.join(subPath, ss);
      if ((await lstat(scopedPath)).isSymbolicLink()) continue;
      const r = await tryDir(scopedPath, `${hint}/${s}/${ss}`);
      if (r) candidates.push(r);
    }
  } else {
    const r = await tryDir(subPath, `${hint}/${s}`);
    if (r) candidates.push(r);
  }
}
```

- [ ] **Step 3: Verify both new tests pass + existing PASS** — `pnpm --filter contractqa exec vitest run tests/detect-framework-monorepo.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework-monorepo.test.ts
git commit -m "feat(init): walk scoped packages (apps/@org/pkg); skip symlinks"
```

---

### Task B3: doctor — missing-install-script UX hint + multi-version test

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts`
- Add: `packages/cli/tests/doctor-multi-version.test.ts`

- [ ] **Step 1: Test for findPnpmPkgDir multi-version selection**

```ts
// packages/cli/tests/doctor-multi-version.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

describe('doctor — pnpm dedup edge cases', () => {
  it('picks one of multiple .pnpm versions deterministically (sorted)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-multiver-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { 'better-sqlite3': '^11.0.0' },
    }));
    // Create two .pnpm-mirrored versions
    for (const v of ['9.6.0', '11.10.0']) {
      const dir = path.join(root, 'node_modules/.pnpm', `better-sqlite3@${v}/node_modules/better-sqlite3`);
      await mkdir(dir, { recursive: true });
      // Create a fake package.json so npm doesn't crash; install script stub
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({
        name: 'better-sqlite3', version: v, scripts: {}, // intentionally no install script
      }));
    }
    const r = await doctor({ targetRoot: root, skipBootProbe: true, fix: ['native-deps'] });
    const fix = r.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    // Should attempt rebuild on one of them (alphabetic sort picks 11.10.0 since '1'<'9' in ASCII)
    expect(fix!.detail).toMatch(/better-sqlite3/);
  });
});
```

- [ ] **Step 2: Improve `runNpmInstallScript` UX hint**

```ts
// packages/cli/src/commands/doctor.ts — in runNpmInstallScript on close
child.on('close', (code) => {
  if (code === 0) {
    resolve({ ok: true, detail: 'npm run install OK' });
    return;
  }
  const trimmed = stderr.slice(0, 200).replace(/\s+/g, ' ').trim();
  const hint = /Missing script: install/i.test(trimmed)
    ? ' (package has no install script — try `pnpm rebuild <pkg>` or `npm rebuild <pkg>`)'
    : '';
  resolve({ ok: false, detail: trimmed + hint });
});
```

- [ ] **Step 3: Verify** — multi-version test PASSes; existing doctor tests stay green.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/tests/doctor-multi-version.test.ts
git commit -m "feat(doctor): missing-install-script UX hint; multi-version pnpm test"
```

---

### Task B4: PostgresBackendAdapter — writable-CTE deepening (regex on body)

**Files:**
- Modify: `packages/adapters/src/backend/postgres.ts`
- Add cases to: `packages/adapters/tests/postgres-readonly.test.ts`

- [ ] **Step 1: Test for nested writable CTE**

```ts
// In postgres-readonly.test.ts — append:
it('rejects nested writable CTE (WITH a AS (..), b AS (DELETE ...))', () => {
  expect(() => new PostgresBackendAdapter({
    dsn: 'postgres://x',
    tenantField: 'user_id',
    namedQueries: { bad: { description: '', sql: 'WITH a AS (SELECT 1), b AS (DELETE FROM x RETURNING 1) SELECT * FROM b', params: {} } },
  })).toThrow(/writable CTEs|DML\/DDL/);
});

it('rejects WITH RECURSIVE that contains a write', () => {
  expect(() => new PostgresBackendAdapter({
    dsn: 'postgres://x',
    tenantField: 'user_id',
    namedQueries: { bad: { description: '', sql: 'WITH RECURSIVE r AS (UPDATE x SET a = 1 RETURNING *) SELECT * FROM r', params: {} } },
  })).toThrow();
});
```

- [ ] **Step 2: Verify** — existing FORBIDDEN_DML_DDL regex from v0.4.0's `286f520` already covers these cases (the regex is body-wide via `\b`-anchored token matching). If both tests already pass, no impl change needed — this task documents the depth of coverage. If they fail, tighten the regex.

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/tests/postgres-readonly.test.ts
git commit -m "test(adapters): coverage for nested writable CTEs"
```

---

### Task B5: Bounded sniffer / buffer review — verification only

**Files:**
- Add: `packages/cli/tests/lib/host-probe-bounded.test.ts`

**Goal:** Phase 4 commit `286f520` already capped `allStderr` to 64 KB and bounded `extractAbiHint` regex to `[^]{0,512}`. This task adds explicit tests asserting both bounds hold under adversarial input.

- [ ] **Step 1: Test**

```ts
// packages/cli/tests/lib/host-probe-bounded.test.ts
import { describe, it, expect } from 'vitest';
import { extractAbiHint } from '../../src/lib/host-probe.js';

describe('host-probe — bounded extraction', () => {
  it('extractAbiHint terminates promptly on adversarial stderr (no catastrophic backtrack)', () => {
    const start = Date.now();
    const big = 'NODE_MODULE_VERSION 115.' + 'x'.repeat(100_000); // no `requires` token follows
    const r = extractAbiHint(big);
    const elapsed = Date.now() - start;
    expect(r).toBeNull();
    expect(elapsed).toBeLessThan(100); // bounded regex shouldn't take long
  });

  it('extractAbiHint still finds the hint when within 512-char window', () => {
    const stderr = 'NODE_MODULE_VERSION 115.\n  noise\n  more noise\nrequires NODE_MODULE_VERSION 127';
    expect(extractAbiHint(stderr)).toEqual({ built: '115', runtime: '127' });
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter contractqa exec vitest run tests/lib/host-probe-bounded.test.ts`. Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/lib/host-probe-bounded.test.ts
git commit -m "test(doctor): bounded extractAbiHint resists catastrophic backtracking"
```

---

# Part C: Release

### Task C1: Phase 5 acceptance script

**Files:**
- Create: `scripts/phase5-acceptance.sh`

- [ ] **Step 1: Copy from `scripts/phase4-acceptance.sh`, add a B5 section**

```bash
# After Part D in phase4-acceptance.sh's structure, before --real-cloud branch:

if [ -d /Users/zmy/intership/4/agent-poker-platform/node_modules ] && [ -n "${DOGFOOD_POSTGRES_DSN:-}" ]; then
  echo "--- Part A: agent-poker-platform L2 dogfood (B5)"
  pnpm --filter @contractqa/dogfood exec vitest run agent-poker-platform/dogfood.test.ts 2>&1 | tail -5
else
  echo "--- Part A: agent-poker-platform L2 — skipped (set DOGFOOD_POSTGRES_DSN + pnpm install in target)"
fi
```

- [ ] **Step 2: Commit**

```bash
chmod +x scripts/phase5-acceptance.sh
git add scripts/phase5-acceptance.sh
git commit -m "chore: scripts/phase5-acceptance.sh — Part A B5 + reuse Phase 4 sections"
```

---

### Task C2: FINDINGS update

**Files:**
- Modify: `dogfood/FINDINGS.md`

- [ ] Move the following from "STILL DEFERRED to Phase 5" to a new "Phase 5 resolution status (v0.5.0)" section: HTTP-API contract surface (resolved by B5 + agent-poker-platform target). Refresh the deferred list to omit B5 + the 7 final-review follow-ups.

- [ ] Commit:
```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): close Phase 5 anchor (B5 HTTP-API surface)"
```

---

### Task C3: CHANGELOG + version bump → v0.5.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: every `packages/*/package.json` `version` field
- Modify: `packages/adapters/templates/third-party/package.json` (bump `@contractqa/adapters` peer to `^0.5.0`)

- [ ] **Step 1: Add v0.5.0 section to CHANGELOG.md (mirrors v0.4.0 structure: Added / Changed / Still deferred).**

- [ ] **Step 2: Bump versions**

```bash
for f in packages/*/package.json; do sed -i '' 's/"version": "0.4.0"/"version": "0.5.0"/' "$f"; done
sed -i '' 's/"@contractqa\/adapters": "\^0.4.0"/"@contractqa\/adapters": "^0.5.0"/' packages/adapters/templates/third-party/package.json
```

- [ ] **Step 3: Commit + tag**

```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.5.0 + CHANGELOG (Phase 5 — B5 + QA pass)"
git tag -a v0.5.0 -m "Phase 5 — HTTP-API contract surface (B5) + final-review QA pass"
```

---

## Self-review notes

1. **Spec coverage:** B5 is split into A1 (schema) + A2 (runner) + A3 (dogfood). The 7 final-review follow-ups: B1 README, B2 scoped+symlink+multi-version (3 of 7), B3 missing-install-script + multi-version test (2 of 7 — overlaps slightly with B2), B4 writable-CTE coverage, B5 bounded sniffer test. Mapping check: I3 (README) → B1 ✓; M2 (symlink) → B2 ✓; A2 review I2 (multi-version) → B2/B3 ✓; A2 review I1 (missing install script) → B3 ✓; final review C1 (writable CTE) → B4 (verification) ✓; final review I1 (bounded sniffer) → B5 ✓; final review M1 (dead code) → DEFERRED to Phase 6.
2. **Placeholder scan:** `$session.userId` resolution in INV-B1 is documented as deferred to Phase 6 (dynamic session-context substitution). Hardcode `'test-user-1'` for now.
3. **Type consistency:** Action shape uses `type: 'http'` (not `kind`) to match the existing union discriminator. RunContractInput `baseUrl?: string` is new.
4. **Risk:** B5 depends on the `tables` table existing in the Postgres backend with `owner_user_id` column. If the agent-poker-platform repo doesn't seed this on `pnpm dev`, the test will fail. STOP and report rather than papering over.

---

## Execution Handoff

Plan complete. Save state via `/save-session-handoff`; resume in a fresh session via `/resume-session-handoff` for execution.

Two execution options at resume time:

**1. Subagent-Driven (recommended)** — Same pattern as Phase 4. Fresh subagent per task; combined spec/quality review per task; fix-then-merge.

**2. Inline Execution** — Smaller scope than Phase 4; could fit in one focused session if subagent dispatches are skipped for purely mechanical tasks.

Estimated size: ~10 tasks (~half of Phase 4), shippable in a single focused 1-2 hour session.
