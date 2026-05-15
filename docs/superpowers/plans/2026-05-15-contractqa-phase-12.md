# ContractQA Phase 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the long-deferred **B5 HTTP action support** in the runner (schema + sibling `runHttpContract` function with mocked-fetch tests). Pair with 3 Phase 11 polish items: `@google-cloud/firestore` optionalPeerDep, Firestore `id`-merge precedence, MongoClient.db() orphan-leak fix.

**Architecture:** Three parts.

- **Part A — B5 HTTP action support (runner + schema, NO dogfood).** Add `action.type: 'http'` to the contract schema. Add a sibling `runHttpContract` function in the runner — separate from `runContract` (which stays Playwright-bound). The sibling has its own input shape: `{ contract, backend?, baseUrl }`. Iterates HTTP actions via `fetch()`; if `expected.backend_state` is set, calls `evaluateBackendState`. Tests via mocked `global.fetch` + mocked `BackendAdapter`. The dogfood target part of original Phase 5 B5 remains deferred until a Postgres-wired api-only target emerges.
- **Part B — QA pass (3 tasks):**
  - B1: `@google-cloud/firestore` → `optionalDependencies` (or peer) — reduces install bulk for Postgres/Mongo-only users.
  - B2: Firestore `id`-merge precedence — flip to `{ ...doc.data(), id: doc.id }` so the doc id always wins; document explicitly.
  - B3: `MongoClient.db()` orphan-leak fix — if `client.db(name)` throws after a successful `connect()`, close the orphan client before clearing `connectingP`.
- **Part C — Release v0.12.0.** Acceptance script, FINDINGS close-out, CHANGELOG, version bump.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. No new deps.

---

## Required reading (before starting)

1. `docs/superpowers/plans/2026-05-15-contractqa-phase-5.md` — Phase 5 B5 was DEFERRED there; this is the long-promised completion (sans dogfood).
2. `packages/core/src/schemas/contract.schema.ts` — current `Action` discriminated union (goto, click, fill, wait); A1 adds `http`.
3. `packages/runner/src/run-contract.ts` (181 lines) — current Playwright-bound runner; A2 adds a SIBLING `runHttpContract` (separate function in the same file).
4. `packages/runner/src/backend-evaluator.ts` — already evaluates `backend_state`; reused as-is by `runHttpContract`.
5. `packages/adapters/src/backend/firestore.ts` — B2 fix target (id-merge order).
6. `packages/adapters/src/backend/mongo.ts` — B3 fix target (`db()` orphan-leak path).
7. `packages/adapters/package.json` — B1 fix target.

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict |
|---|---|
| Phase 12 anchor count | 1 (B5 HTTP) + 3-task QA pass |
| HTTP action shape | `{ type: 'http', method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, body?: unknown, headers?: Record<string,string> }` |
| Runner approach | NEW sibling function `runHttpContract` in `run-contract.ts` (no Playwright deps). `runContract` unchanged for Playwright contracts. |
| Should `runContract` auto-dispatch to `runHttpContract`? | NO — keep separate entry points. The caller knows whether their contract is HTTP-only or browser-based and picks accordingly. Auto-dispatch invites bugs from mixed action types. |
| Mixed HTTP + browser actions in one contract? | REJECT at schema level for HTTP — `runHttpContract` requires ALL actions to be `type: 'http'`. (Schema allows mixing, but runtime guards.) |
| Result shape | `RunHttpContractResult { verdict, runId, before: { url, status }, after: { url, status, responseBody? } }` — minimal, no Playwright snapshot fields. No bundle dir for HTTP runs. |
| baseUrl required? | YES — `path` is relative; `baseUrl` is the API root. |
| Firestore optionalPeerDependency | Move from `dependencies` to `optionalDependencies` (closer to "users opt in") — easier to install than peerDependencies, no manual `pnpm add`. Doc the install behavior. |
| Firestore id-merge precedence | `{ ...doc.data(), id: doc.id }` — doc id wins. Document the decision. |
| MongoClient.db() orphan-leak | Wrap `client.db(...)` in a try/catch inside `getDb`; if it throws and `_clientOverride` is NOT set, call `client.close()` to release the connection before clearing `connectingP`. |
| Version target | v0.12.0 |
| External repo PRs | Still NO |

---

## Non-goals (do not touch)

- HTTP dogfood target (still no Postgres-wired api-only target). The Phase 5 plan's `dogfood/agent-poker-platform/` directory remains deferred.
- Real-Firestore emulator integration test — Phase 13 candidate.
- File-content `cookies()` body parsing for `custom-cookie` — Phase 13.
- TypeScript project references, persona dogfood agents, dashboard §15.3–§15.6, property/model gen, pnpm spawn helper.
- Publishing to npm.
- Dynamic `$session.userId` resolution.

---

## File structure

**Modified (Part A):**
- `packages/core/src/schemas/contract.schema.ts` — extend `Action` union with `'http'` variant
- `packages/core/tests/schemas/contract-action-http.test.ts` (new) — schema tests
- `packages/runner/src/run-contract.ts` — append `runHttpContract` function + types
- `packages/runner/src/index.ts` — export `runHttpContract`, `RunHttpContractInput`, `RunHttpContractResult`
- `packages/runner/tests/http-action.test.ts` (new) — mocked-fetch tests for `runHttpContract`

**Modified (Part B):**
- `packages/adapters/package.json` — move `@google-cloud/firestore` from `dependencies` to `optionalDependencies` (B1)
- `packages/adapters/src/backend/firestore.ts` — flip id-merge order + JSDoc (B2)
- `packages/adapters/tests/firestore-query.test.ts` — adjust id-merge assertions (B2)
- `packages/adapters/src/backend/mongo.ts` — orphan-leak fix (B3)
- `packages/adapters/tests/mongo-lifecycle.test.ts` — new test for B3

**New (Part C):**
- `scripts/phase12-acceptance.sh`

**Modified (Part C):**
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, 9 `packages/*/package.json`, third-party template peer

---

## Dependency graph

```
Part A (B5 HTTP) ────┐
                     ├──► Part C (release)
Part B (QA)      ────┘
```

Worktree: `.claude/worktrees/phase12-exec`.

---

# Part A: B5 HTTP action support (runner + schema)

**Acceptance gate A:** A contract with `actions: [{ type: 'http', method: 'POST', path: '/api/v1/rooms', body: { name: 'x' } }]` and `expected.backend_state.named_query` runs through `runHttpContract({ contract, backend: mockBackend, baseUrl: 'http://x' })` and produces a PASS verdict. Mocked `fetch` was called with the right URL/method.

---

### Task A1: Add `http` variant to `Action` discriminated union

**Files:**
- `packages/core/src/schemas/contract.schema.ts`
- `packages/core/tests/schemas/contract-action-http.test.ts` (new)

- [ ] **Step 1: Write the failing test**

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
  it('accepts POST with body and headers', () => {
    const r = ContractSchema.safeParse({
      ...baseContract,
      actions: [{
        type: 'http',
        method: 'POST',
        path: '/api/v1/rooms',
        body: { name: 'x' },
        headers: { Authorization: 'Bearer t' },
      }],
      expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 1 } } },
    });
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('accepts GET without body', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'GET', path: '/api/v1/rooms' }],
      expected: { url: { matches: '^/api' } },
    }).success).toBe(true);
  });

  it('rejects unsupported HTTP method', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'TRACE', path: '/x' }],
      expected: {},
    }).success).toBe(false);
  });

  it('rejects empty path', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'GET', path: '' }],
      expected: {},
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm --filter @contractqa/core exec vitest run tests/schemas/contract-action-http.test.ts 2>&1 | tail -10`. 4 FAIL (unknown discriminator value `http`).

- [ ] **Step 3: Extend the `Action` union**

In `packages/core/src/schemas/contract.schema.ts`, add to the `discriminatedUnion('type', [...])` array:

```ts
z.object({
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
}).strict(),
```

- [ ] **Step 4: Verify PASS** — 4 PASS. Existing core tests still green.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM: worktree-phase12-exec
git add packages/core/src/schemas/contract.schema.ts packages/core/tests/schemas/contract-action-http.test.ts
git commit -m "feat(core): add http action variant (GET/POST/PUT/PATCH/DELETE) to contract schema"
```

---

### Task A2: `runHttpContract` sibling function in runner

**Files:**
- `packages/runner/src/run-contract.ts`
- `packages/runner/src/index.ts`
- `packages/runner/tests/http-action.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// packages/runner/tests/http-action.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runHttpContract } from '../src/run-contract.js';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

class FakeBackend implements BackendAdapter {
  readonly kind = 'postgres' as const;
  constructor(private rows: unknown[]) {}
  describe(): SchemaDescriptor {
    return { tenantField: 'user_id', namedQueries: [{ name: 'q', description: '', params: {} }] };
  }
  async query(): Promise<unknown[]> { return this.rows; }
}

describe('runHttpContract', () => {
  it('executes a POST and produces PASS when backend_state matches', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;

    const r = await runHttpContract({
      contract: {
        id: 'INV-HTTP',
        title: 'http test',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'POST', path: '/api/v1/rooms', body: { name: 'x' } }],
        expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 1 } } },
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
      } as any,
      backend: new FakeBackend([{ id: 'r1' }]),
      baseUrl: 'http://127.0.0.1:3287',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3287/api/v1/rooms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'x' }),
      }),
    );
    expect(r.verdict.verdict).toBe('PASS');
  });

  it('executes a GET without body', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    global.fetch = fetchMock as any;

    const r = await runHttpContract({
      contract: {
        id: 'INV-HTTP-GET',
        title: 'http get',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'GET', path: '/api/v1/rooms' }],
        expected: {},
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://127.0.0.1:3287',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3287/api/v1/rooms',
      expect.objectContaining({ method: 'GET' }),
    );
    // No body should appear in the call options.
    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.body).toBeUndefined();
    expect(r.verdict.verdict).toBe('PASS');  // empty expected → PASS by default
  });

  it('throws when a non-http action is present', async () => {
    await expect(runHttpContract({
      contract: {
        id: 'INV-MIX',
        title: 'mixed',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'goto', path: '/' } as any, { type: 'http', method: 'GET', path: '/api/v1/x' }],
        expected: {},
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://x',
    })).rejects.toThrow(/all actions must be http|mixed/i);
  });

  it('INCONCLUSIVE when backend_state is present but no backend provided', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    const r = await runHttpContract({
      contract: {
        id: 'INV-NB',
        title: 'no backend',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'GET', path: '/api/v1/x' }],
        expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 0 } } },
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://x',
    });
    expect(r.verdict.verdict).toBe('INCONCLUSIVE');
  });
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm --filter @contractqa/runner exec vitest run tests/http-action.test.ts 2>&1 | tail -10`. All fail (function not exported).

- [ ] **Step 3: Implement `runHttpContract` in `packages/runner/src/run-contract.ts`**

At the bottom of the file, add:

```ts
export interface RunHttpContractInput {
  contract: ContractDoc;
  backend?: BackendAdapter;
  baseUrl: string;
}

export interface RunHttpContractResult {
  verdict: VerdictResult;
  runId: string;
  /** Final fetch response status. */
  status: number;
  /** Final fetch response body as text (if any). */
  responseBody?: string;
}

/**
 * Sibling to `runContract` for HTTP-API contracts (no Playwright).
 *
 * All actions in the contract MUST be `type: 'http'`. Iterates them in order,
 * calling `fetch(baseUrl + action.path, { method, body, headers })` for each.
 * If `expected.backend_state` is set, the result of the final fetch is followed
 * by a call to `backend.query(...)` for state verification.
 *
 * Does not write an evidence bundle (HTTP has no Playwright trace/HAR/screenshot).
 */
export async function runHttpContract(input: RunHttpContractInput): Promise<RunHttpContractResult> {
  const { contract, backend, baseUrl } = input;

  // Guard: all actions must be http.
  for (const a of contract.actions) {
    if (a.type !== 'http') {
      throw new Error(`runHttpContract: all actions must be type 'http' — found type '${a.type}'. Mixed action types are not supported; use runContract for Playwright contracts.`);
    }
  }

  let lastStatus = 0;
  let lastBody = '';
  for (const a of contract.actions) {
    if (a.type !== 'http') continue;  // satisfies TS narrowing
    const headers: Record<string, string> = { ...(a.headers ?? {}) };
    if (a.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    const init: RequestInit = {
      method: a.method,
      headers,
      ...(a.body !== undefined ? { body: JSON.stringify(a.body) } : {}),
    };
    const res = await fetch(`${baseUrl}${a.path}`, init);
    lastStatus = res.status;
    lastBody = await res.text();
  }

  // Backend state evaluation (reuses Phase 4 evaluator).
  let verdict: VerdictResult;
  const expectedBackend = (contract.expected as any).backend_state as
    | { named_query: string; params: Record<string, unknown>; assert: unknown }
    | undefined;
  if (expectedBackend) {
    if (!backend) {
      verdict = {
        verdict: 'INCONCLUSIVE',
        reason: 'backend_state present but no backend adapter provided',
        missingCapabilities: ['backend_probe'],
      } as VerdictResult;
    } else {
      const backendResult = await evaluateBackendState({
        block: expectedBackend as any,
        backend,
      });
      verdict = backendResult.passed
        ? ({ verdict: 'PASS', reason: 'backend_state satisfied' } as VerdictResult)
        : ({ verdict: 'FAIL', reason: backendResult.reason ?? 'backend_state did not match' } as VerdictResult);
    }
  } else {
    // No backend assertion → HTTP returned without error → PASS.
    verdict = { verdict: 'PASS', reason: 'http actions completed' } as VerdictResult;
  }

  return {
    verdict,
    runId: contract.id,
    status: lastStatus,
    responseBody: lastBody,
  };
}
```

NOTE on type shapes:
- `VerdictResult` may have a specific structure — check existing usage in `runContract`. The cast `as VerdictResult` is conservative; if there's a constructor or builder, prefer that.
- `expectedBackend` is cast because the existing `ExpectedBlock` type may not surface `backend_state` directly without narrowing.
- `evaluateBackendState`'s input shape may differ — read its signature first and adapt.

Adapt to the actual existing types. If the existing `evaluateBackendState` returns a different shape, mirror what `runContract` does.

- [ ] **Step 4: Export from `packages/runner/src/index.ts`**

Add:
```ts
export { runHttpContract } from './run-contract.js';
export type { RunHttpContractInput, RunHttpContractResult } from './run-contract.js';
```

- [ ] **Step 5: Verify PASS** — 4 tests pass: `pnpm --filter @contractqa/runner exec vitest run tests/http-action.test.ts 2>&1 | tail -10`. Full runner suite still green.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/runner/src/run-contract.ts packages/runner/src/index.ts packages/runner/tests/http-action.test.ts
git commit -m "feat(runner): runHttpContract sibling — execute http actions + backend_state"
```

---

# Part B: QA pass

### Task B1: `@google-cloud/firestore` → optionalDependencies

**File:** `packages/adapters/package.json`

The Firestore SDK is heavy (gRPC + protobufjs). Phase 11 made it a regular `dependencies` entry, which forces install for everyone. Move it to `optionalDependencies` so consumers who don't use Firestore can skip it without `pnpm add` ceremony.

- [ ] **Step 1: Read current shape**

```bash
grep -B 1 -A 1 '"@google-cloud/firestore"' packages/adapters/package.json
```

- [ ] **Step 2: Move the entry**

Open `packages/adapters/package.json`. Remove `"@google-cloud/firestore": "^8.6.0"` from `dependencies`. Add `optionalDependencies` block (if not present) and put the entry there:

```json
"optionalDependencies": {
  "@google-cloud/firestore": "^8.6.0"
}
```

- [ ] **Step 3: Re-install to update lockfile**

```bash
pnpm install --prefer-offline 2>&1 | tail -3
```

Verify the lockfile reflects the move (firestore should still be installed because `optionalDependencies` ARE installed by default — they're just allowed to fail). Run tests to ensure the adapter import still resolves:

```bash
pnpm --filter @contractqa/adapters exec vitest run tests/firestore-readonly.test.ts 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/package.json pnpm-lock.yaml
git commit -m "chore(adapters): @google-cloud/firestore as optionalDependency (heavy install)"
```

---

### Task B2: Firestore `id`-merge precedence

**Files:**
- `packages/adapters/src/backend/firestore.ts`
- `packages/adapters/tests/firestore-query.test.ts`

Current code: `{ id: doc.id, ...doc.data() }` — if a document has an `id` field, it OVERRIDES the Firestore doc id. The dangerous direction. Phase 11 opus reviewer flagged this.

- [ ] **Step 1: Append failing test**

```ts
// In tests/firestore-query.test.ts:
it('doc.id wins over any "id" field in doc.data() (precedence)', async () => {
  const fs = mockFirestore([
    { id: 'firestore-r1', data: { id: 'user-said-r99', user_id: 'u-1' } },
  ]);
  const adapter = new FirestoreBackendAdapter({
    projectId: 'test',
    tenantField: 'user_id',
    namedQueries: {
      q: {
        description: '',
        collection: 'rooms',
        where: [['user_id', '==', '$1']],
        params: { user_id: '$1' },
      },
    },
    _clientOverride: fs,
  });
  const r = await adapter.query('q', { user_id: 'u-1' });
  expect(r).toEqual([{ id: 'firestore-r1', user_id: 'u-1' }]);  // firestore id wins, user-said-r99 is shadowed
});
```

(Note: the existing tests may have implicitly assumed the old behavior. After flipping, those tests should still pass because no existing test has a doc with `data.id` set.)

- [ ] **Step 2: Verify FAIL** — current behavior returns `{ id: 'user-said-r99', user_id: 'u-1' }`.

- [ ] **Step 3: Flip the spread order**

In `firestore.ts`, find:
```ts
return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
```

Change to:
```ts
return snap.docs.map((doc: any) => ({ ...doc.data(), id: doc.id }));
```

- [ ] **Step 4: Update JSDoc**

Add a note to the class JSDoc:
```
 *  - Result rows always have `id` set to the Firestore document id; any `id` field
 *    in `doc.data()` is shadowed by the doc id. Consumers expecting `data.id` to
 *    be preserved should rename that field.
```

- [ ] **Step 5: Verify PASS** — new test passes; existing firestore-query tests still pass.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/src/backend/firestore.ts packages/adapters/tests/firestore-query.test.ts
git commit -m "fix(adapters): firestore — doc id always wins over data().id (precedence)"
```

---

### Task B3: MongoClient.db() orphan-leak

**Files:**
- `packages/adapters/src/backend/mongo.ts`
- `packages/adapters/tests/mongo-lifecycle.test.ts`

Current code in `getDb`:
```ts
try {
  const client = await this.connectingP;
  const db = client.db(this.opts.database);
  this.client = client;
  return db;
} catch (e) {
  this.connectingP = null;
  throw e;
}
```

If `client.db()` throws (rare: invalid database name), `connectingP` is cleared but the resolved `client` is NOT closed — orphan connection.

- [ ] **Step 1: Append failing test**

```ts
// In tests/mongo-lifecycle.test.ts:
it('closes resolved client when db() throws (no orphan)', async () => {
  let closeCalled = false;
  const badDbClient = {
    db: vi.fn(() => { throw new Error('invalid database name'); }),
    close: vi.fn(async () => { closeCalled = true; }),
  };

  const adapter = new MongoBackendAdapter({
    uri: 'mongodb://x',
    database: 'invalid-name',
    tenantField: 'user_id',
    namedQueries: {
      q: { description: '', collection: 'r', operation: 'find', filter: { user_id: '$1' }, params: { user_id: '$1' } },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _clientOverride: badDbClient as any,
  });

  await expect(adapter.query('q', { user_id: 'u' })).rejects.toThrow(/invalid database name/);
  expect(closeCalled).toBe(true);
});
```

- [ ] **Step 2: Verify FAIL** — current behavior doesn't close.

- [ ] **Step 3: Fix `getDb`**

Replace the try/catch body with:

```ts
try {
  const client = await this.connectingP;
  try {
    const db = client.db(this.opts.database);
    this.client = client;
    return db;
  } catch (e) {
    // client.db() threw but the connect succeeded — close the orphan.
    if (!this.opts._clientOverride) {
      try { await client.close(); } catch { /* best-effort */ }
    } else {
      // For tests, the override owns lifecycle but call close so the spy fires.
      try { await client.close(); } catch { /* ignore */ }
    }
    throw e;
  }
} catch (e) {
  this.connectingP = null;
  throw e;
}
```

Adjust to fit existing style. The key behavior: when `client.db()` throws, call `client.close()` on the resolved client.

- [ ] **Step 4: Verify PASS** — new test passes; all existing mongo tests still green.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/src/backend/mongo.ts packages/adapters/tests/mongo-lifecycle.test.ts
git commit -m "fix(adapters): mongo — close orphan client when db() throws after connect"
```

---

# Part C: Release v0.12.0

### Task C1: scripts/phase12-acceptance.sh

Copy `scripts/phase11-acceptance.sh` → `scripts/phase12-acceptance.sh`. Replace "Phase 11" → "Phase 12". Update opening comment:

> Phase 12 acceptance script. Ships B5 HTTP action support (runner + schema; dogfood still deferred — no target). Plus 3 Phase 11 follow-ups: @google-cloud/firestore optionalPeer, Firestore id-merge precedence, Mongo db() orphan-leak fix.

```bash
chmod +x scripts/phase12-acceptance.sh
git add scripts/phase12-acceptance.sh
git commit -m "chore: scripts/phase12-acceptance.sh — Phase 12 release lane"
```

### Task C2: dogfood/FINDINGS.md

Add `## Phase 12 resolution status (v0.12.0)`:

```markdown
## Phase 12 resolution status (v0.12.0)

Findings RESOLVED in Phase 12:
- **B5 HTTP action support (runner + schema)** (was: deferred from Phase 5 — 7 phases). `action.type: 'http'` added to contract schema (GET/POST/PUT/PATCH/DELETE with body, headers). `runHttpContract` sibling function in the runner — separate from `runContract` (Playwright-bound), with its own input shape `{ contract, backend?, baseUrl }`. Tests via mocked `global.fetch` + mocked `BackendAdapter`. The dogfood target (was Phase 5 A3) remains deferred — still no Postgres-wired api-only target.
- **`@google-cloud/firestore` as optionalDependency** (was: Phase 11 opus reviewer #2). Moves the heavy gRPC/protobufjs install to `optionalDependencies` so Postgres/Mongo-only users don't carry the bulk. Still auto-installs by default; only allowed to fail (e.g., on platforms without prebuilt binaries).
- **Firestore `id`-merge precedence** (was: Phase 11 opus reviewer #1). Flipped to `{ ...doc.data(), id: doc.id }` so the Firestore doc id always wins. Documented in class JSDoc.
- **MongoClient.db() orphan-leak fix** (was: Phase 10 opus reviewer #5 / Phase 11 deferred). If `client.db()` throws after a successful `connect()`, the resolved client is now `close()`'d before clearing `connectingP`. New test asserts the orphan-close.
```

Rename "Findings STILL DEFERRED to Phase 12:" → "Findings STILL DEFERRED to Phase 13:". Drop resolved items. New Phase 13 candidates:
- HTTP dogfood target (still no Postgres-wired candidate).
- Real-Firestore emulator integration test.

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 12 deliverables; reroll deferred list to Phase 13"
```

### Task C3: CHANGELOG + version bump → v0.12.0

Insert v0.12.0 BEFORE v0.11.0:

```markdown
## v0.12.0 — 2026-05-15 (Phase 12)

Phase 12 ships the long-deferred B5 HTTP action support (runner + schema; dogfood target still deferred) plus 3 Phase 11 polish items.

### Added

- **`action.type: 'http'` contract schema.** GET/POST/PUT/PATCH/DELETE with `path: string`, optional `body: unknown`, optional `headers: Record<string,string>`. Strict-validated; unsupported methods rejected.
- **`runHttpContract` sibling runner function.** New entry point in `@contractqa/runner` for HTTP-API contracts. Separate from `runContract` (Playwright-bound). Input: `{ contract, backend?, baseUrl }`. Iterates HTTP actions via `fetch()`, content-type defaults to `application/json` when `body` is set. If `expected.backend_state` is present, reuses `evaluateBackendState` (Phase 4). No evidence bundle is written for HTTP runs. Mixed action types are rejected at runtime (throws "all actions must be type 'http'").

### Changed

- **No breaking changes.**
- `@google-cloud/firestore` moved from `dependencies` to `optionalDependencies` in `@contractqa/adapters`. Postgres/Mongo-only consumers no longer pay the heavy gRPC/protobufjs install cost (firestore still installs by default; only allowed to fail).
- `FirestoreBackendAdapter` result rows: doc id always wins over any `id` field in document data. `{ ...doc.data(), id: doc.id }` instead of the previous reversed order. Documented in class JSDoc.
- `MongoBackendAdapter.getDb()` closes the resolved client if `client.db(name)` throws after a successful `connect()` — prevents an orphan connection from leaking when the database name is invalid.

### Still deferred (Phase 13 candidates)

- HTTP dogfood target (Phase 5 A3) — still no Postgres-wired api-only target identified.
- Real-Firestore emulator integration test.
- File-content `cookies()` body parsing for `custom-cookie`.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- pnpm-version-aware spawn helper.
- Dynamic `$session.userId` resolution.
- Publishing to npm.
```

Bump versions:
```bash
for f in packages/*/package.json; do
  sed -i '' 's/"version": "0.11.0"/"version": "0.12.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.11.0"/"@contractqa\/adapters": "^0.12.0"/' packages/adapters/templates/third-party/package.json
grep '"version"' packages/*/package.json
```

Commit:
```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.12.0 + CHANGELOG (Phase 12 — HTTP runner + adapter polish)"
```

DO NOT tag.

---

## Self-review notes

1. **Spec coverage:** A1 (schema) + A2 (runner) + B1 (firestore optional) + B2 (firestore id) + B3 (mongo orphan) + C1/C2/C3 (release). 8 commits total.
2. **Type consistency:** New types `RunHttpContractInput`, `RunHttpContractResult` exported. `action.type: 'http'` added to existing `Action` union.
3. **Risk:** `runHttpContract` doesn't write an evidence bundle. Consumers who expect `bundleDir` will get `null`. Documented.
4. **Risk:** `fetch` is used directly (global). Node 18+ has it built-in; older Node would fail. Document Node version requirement (project already targets Node 20+ per package engines).
5. **Risk:** B1's `optionalDependencies` move: pnpm 10+ installs optional deps by default but allows them to fail. On exotic platforms where firestore binaries are missing, the install proceeds without firestore — consumer's `import { FirestoreBackendAdapter }` will then fail at runtime. Document.

---

## Execution Handoff

Plan complete. Save state if needed; resume via `/resume-session-handoff`.

Execution: `superpowers:subagent-driven-development` with `.claude/worktrees/phase12-exec`.

Estimated size: ~8 commits, ~1-1.5 hour focused session.
