# ContractQA Phase 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the `BackendAdapter` family by shipping `FirestoreBackendAdapter` (third member alongside Postgres + Mongo). Plus 3 Phase 10 follow-ups from opus review.

**Architecture:** Three parts.

- **Part A — `FirestoreBackendAdapter`.** Server-side Firestore adapter via `@google-cloud/firestore`. Named-queries-only with `where: [field, op, value]` triples, optional `orderBy` / `limit`. Tenant scoping enforced at construction: at least one `where` entry must filter on `tenantField` with `==` op. Supports both `$N` and `:name` placeholder styles (matches Phase 10 Mongo conventions). Unit tests via mocked client only — real-Firestore emulator integration is a Phase 12 candidate.
- **Part B — QA pass (3 tasks):**
  - B1: Mongo in-flight queries drain on close — track active operation count, `close()` awaits drain before `client.close()`.
  - B2: Mongo JSDoc polish — document close lifecycle + dual placeholder styles in `MongoNamedQuery.params`.
  - B3: `custom-cookie` detector adds `pages/api/` route variant.
- **Part C — Release v0.11.0.** Acceptance script, FINDINGS close-out, CHANGELOG, version bump.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. New dep: `@google-cloud/firestore ^7.x` (in `packages/adapters`).

---

## Required reading (before starting)

1. `packages/adapters/src/backend/mongo.ts` — the closest analog to copy from (Phase 8/10).
2. `packages/adapters/src/backend/postgres.ts` — for the construction-guard pattern (Phase 4/9).
3. `packages/core/src/types/adapter.ts` — `BackendAdapter` interface, `kind` union includes `'firestore'` already (no core change needed).
4. Opus Phase 10 review (this session): items #1 (in-flight drain), #2 (close JSDoc), #3 (params JSDoc), #4 (`pages/api/`).
5. `packages/adapters/src/public.ts` — public export surface, will add `FirestoreBackendAdapter`.

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict |
|---|---|
| Phase 11 anchor count | 1 (Firestore) + 3-task QA pass |
| Firestore client | `@google-cloud/firestore` (server-side Node SDK). Auth via env vars (Application Default Credentials) — adapter doesn't take creds inline. |
| Firestore "named query" shape | `{ collection, where: [[field, op, value], ...], orderBy?, limit?, params }`. `where` triples are required (must include tenant filter). |
| Tenant scoping enforcement | At construction, scan `where` array — at least one triple must be `[tenantField, '==', '<placeholder>']`. Rejects queries that omit the scope. |
| Placeholder syntax | Same as Mongo: both `$N` (positional) and `:name` (named). Reuse the same substitution logic. |
| Forbidden constructs | None at query-shape level (Firestore has no $where injection equivalent). Restrict to `operation: 'get'` only — no collection-group queries, no transactions, no batch writes. |
| Firestore testing | Mocked client only (Phase 11). Real emulator integration → Phase 12 candidate. |
| Mongo in-flight drain (B1) | Track `inFlight: number`; `close()` busy-waits for `inFlight === 0` before `client.close()`. Hard timeout: 5 seconds (then force-close). |
| pages/api/ variant (B3) | Match `(src/)?pages/api/<route>.<ext>` alongside the existing app router rule. |
| Version target | v0.11.0 |
| External repo PRs | Still NO |

---

## Non-goals (do not touch)

- B5 HTTP-API contract surface — still deferred.
- Firestore emulator integration test — Phase 12.
- Real `@google-cloud/firestore` connection in tests (mocked only).
- Persona dogfood agents, property/model gen, dashboard §15.3–§15.6, `tsc -b`, pnpm spawn helper.
- Publishing to npm.
- Dynamic `$session.userId` resolution.
- File-content `cookies()` body parsing for `custom-cookie` (still path-presence; Phase 12 candidate).

---

## File structure

**New (Part A):**
- `packages/adapters/src/backend/firestore.ts` — `FirestoreBackendAdapter` class + types
- `packages/adapters/tests/firestore-readonly.test.ts` — construction-time guards
- `packages/adapters/tests/firestore-query.test.ts` — query path via mocked client

**Modified (Part A):**
- `packages/adapters/package.json` — add `@google-cloud/firestore` to dependencies
- `packages/adapters/src/public.ts` — export `FirestoreBackendAdapter`
- `packages/adapters/STABILITY.md` — v0.11.0 entry
- `packages/adapters/tests/public-surface.test.ts` — add `FirestoreBackendAdapter` to expected set

**Modified (Part B):**
- `packages/adapters/src/backend/mongo.ts` — B1 in-flight drain + B2 JSDoc
- `packages/adapters/tests/mongo-lifecycle.test.ts` — B1 in-flight-on-close test
- `packages/cli/src/init/detect-framework.ts` — B3 pages/api/ variant
- `packages/cli/tests/detect-framework.test.ts` — B3 pages-router test

**New (Part C):**
- `scripts/phase11-acceptance.sh`

**Modified (Part C):**
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, 9 `packages/*/package.json`, third-party template peer

---

## Dependency graph

```
Part A (Firestore) ────┐
                       ├──► Part C (release)
Part B (QA)        ────┘
```

Worktree: `.claude/worktrees/phase11-exec`.

---

# Part A: FirestoreBackendAdapter

**Acceptance gate A:** Construction-time guards reject queries missing tenant scope. Mocked-client query path returns the expected rows. Public API exports `FirestoreBackendAdapter` from `@contractqa/adapters`. Unit tests green.

---

### Task A1: Add `@google-cloud/firestore` dep + FirestoreBackendAdapter skeleton + construction guards

**Files:**
- Add dep: `packages/adapters/package.json`
- Create: `packages/adapters/src/backend/firestore.ts`
- Create: `packages/adapters/tests/firestore-readonly.test.ts`

- [ ] **Step 1: Add `@google-cloud/firestore`**

```bash
pnpm --filter @contractqa/adapters add @google-cloud/firestore
```

Verify in `packages/adapters/package.json`.

- [ ] **Step 2: Write failing tests for construction guards**

```ts
// packages/adapters/tests/firestore-readonly.test.ts
import { describe, it, expect } from 'vitest';
import { FirestoreBackendAdapter } from '../src/backend/firestore.js';

const baseOpts = {
  projectId: 'test-project',
  tenantField: 'user_id',
};

describe('FirestoreBackendAdapter — construction guards', () => {
  it('accepts a valid query with tenant where-clause', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        ok: {
          description: 'rooms by owner',
          collection: 'rooms',
          where: [['user_id', '==', '$1']],
          params: { user_id: '$1' },
        },
      },
    })).not.toThrow();
  });

  it('accepts :name-style placeholder in tenant where', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        ok: {
          description: 'rooms by owner',
          collection: 'rooms',
          where: [['user_id', '==', ':user_id']],
          params: { user_id: ':user_id' },
        },
      },
    })).not.toThrow();
  });

  it('rejects a query missing the tenant field in params', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'no tenant',
          collection: 'rooms',
          where: [['status', '==', 'active']],
          params: {},
        },
      },
    })).toThrow(/tenant/i);
  });

  it('rejects a query that declares tenant in params but does not include it in where', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'unscoped',
          collection: 'rooms',
          where: [['status', '==', 'active']],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/tenant.*where|where.*tenant|scope/i);
  });

  it('rejects tenant scoped with a non-equality operator', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'wrong op for tenant',
          collection: 'rooms',
          where: [['user_id', '!=', '$1']],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/tenant.*==|equality/i);
  });

  it('rejects unsupported operator in where', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'unknown op',
          collection: 'rooms',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: [['user_id', 'bogus' as any, '$1']],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/unsupported operator/i);
  });
});
```

- [ ] **Step 3: Verify FAIL**

```bash
pnpm --filter @contractqa/adapters exec vitest run tests/firestore-readonly.test.ts 2>&1 | tail -10
```

All FAIL (module not found).

- [ ] **Step 4: Implement `firestore.ts`**

```ts
// packages/adapters/src/backend/firestore.ts
import { Firestore, type Settings } from '@google-cloud/firestore';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

export type FirestoreOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

const SUPPORTED_OPS: readonly FirestoreOperator[] = [
  '==', '!=', '<', '<=', '>', '>=', 'array-contains', 'array-contains-any', 'in', 'not-in',
];

export type WhereTriple = readonly [field: string, op: FirestoreOperator, value: unknown];

export interface FirestoreNamedQuery {
  description: string;
  collection: string;
  /** Required. Each triple is `[field, op, value]`. Values use `$N` or `:name` placeholders. */
  where: WhereTriple[];
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  /** MUST include the tenantField; tenant must appear in `where` with `==` op. */
  params: Record<string, string>;
}

export interface FirestoreBackendAdapterOptions {
  projectId: string;
  tenantField: string;
  namedQueries: Record<string, FirestoreNamedQuery>;
  /** Inject a pre-built Firestore client for tests. */
  _clientOverride?: Firestore;
  /** Extra settings for the underlying Firestore client. */
  settings?: Settings;
}

/**
 * @stable since v0.11.0. Read-only Firestore-backed BackendAdapter.
 *
 * Enforces design-doc §7.6.3 safety rails:
 *  - Named queries only (no raw `.where()` chains from contracts).
 *  - Read-only (`get()` only — no `add`, `set`, `update`, `delete`, `batch`, `transaction`).
 *  - Tenant field must appear in `where` with `==` operator (construction-time check).
 *  - Supported operators: ==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in.
 */
export class FirestoreBackendAdapter implements BackendAdapter {
  readonly kind = 'firestore' as const;
  private client: Firestore | null = null;
  private opts: FirestoreBackendAdapterOptions;
  private closed = false;

  constructor(opts: FirestoreBackendAdapterOptions) {
    for (const [name, q] of Object.entries(opts.namedQueries)) {
      if (!(opts.tenantField in q.params)) {
        throw new Error(`named query "${name}": params is missing the tenant field "${opts.tenantField}"`);
      }
      // Validate operators
      for (const [, op] of q.where) {
        if (!SUPPORTED_OPS.includes(op as FirestoreOperator)) {
          throw new Error(`named query "${name}": unsupported operator "${op}"`);
        }
      }
      // Tenant scope: at least one `where` must be `[tenantField, '==', <placeholder>]`
      const tenantPlaceholder = q.params[opts.tenantField];
      const hasTenantWhere = q.where.some(([f, op, v]) =>
        f === opts.tenantField && op === '==' && v === tenantPlaceholder,
      );
      if (!hasTenantWhere) {
        // Differentiate: was the tenant field there at all? (Maybe with wrong op.)
        const tenantAnywhere = q.where.some(([f]) => f === opts.tenantField);
        if (tenantAnywhere) {
          throw new Error(`named query "${name}": tenant field "${opts.tenantField}" must use '==' operator for scope (equality required)`);
        }
        throw new Error(`named query "${name}": tenant field "${opts.tenantField}" must appear in where (scope missing)`);
      }
    }
    this.opts = opts;
  }

  describe(): SchemaDescriptor {
    return {
      tenantField: this.opts.tenantField,
      namedQueries: Object.entries(this.opts.namedQueries).map(([name, q]) => ({
        name,
        description: q.description,
        params: Object.keys(q.params).reduce<Record<string, string>>((acc, k) => {
          acc[k] = q.params[k]!;
          return acc;
        }, {}),
      })),
    };
  }

  async query(namedQuery: string, params: Record<string, unknown>): Promise<unknown[]> {
    if (this.closed) throw new Error('FirestoreBackendAdapter is closed');
    const q = this.opts.namedQueries[namedQuery];
    if (!q) throw new Error(`unknown named query: ${namedQuery}`);

    const substitute = (val: unknown): unknown => {
      if (typeof val === 'string') {
        if (/^\$\d+$/.test(val)) {
          const idx = Number.parseInt(val.slice(1), 10) - 1;
          const paramName = Object.keys(q.params)[idx];
          if (!paramName) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
          return params[paramName];
        }
        if (/^:[a-zA-Z_][a-zA-Z0-9_]*$/.test(val)) {
          const name = val.slice(1);
          if (!(name in params)) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
          return params[name];
        }
      }
      return val;
    };

    const fs = await this.getClient();
    let query = fs.collection(q.collection) as FirebaseFirestore.Query;
    for (const [field, op, value] of q.where) {
      query = query.where(field, op, substitute(value));
    }
    if (q.orderBy) {
      query = query.orderBy(q.orderBy.field, q.orderBy.direction ?? 'asc');
    }
    if (q.limit !== undefined) {
      query = query.limit(q.limit);
    }
    const snap = await query.get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.client && !this.opts._clientOverride) {
      // @google-cloud/firestore has terminate() to close all open streams.
      await this.client.terminate();
    }
    this.client = null;
  }

  private async getClient(): Promise<Firestore> {
    if (!this.client) {
      this.client = this.opts._clientOverride ?? new Firestore({
        projectId: this.opts.projectId,
        ...this.opts.settings,
      });
    }
    return this.client;
  }
}
```

NOTE on `FirebaseFirestore.Query`: the `@google-cloud/firestore` package exports types via the `FirebaseFirestore` namespace. If the import shape differs (e.g., direct `Query` export), adapt.

- [ ] **Step 5: Verify PASS**

```bash
pnpm --filter @contractqa/adapters exec vitest run tests/firestore-readonly.test.ts 2>&1 | tail -10
pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -8
```

All 6 firestore-readonly tests + all existing adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git status                          # check pnpm-lock.yaml changed
git add packages/adapters/package.json packages/adapters/src/backend/firestore.ts packages/adapters/tests/firestore-readonly.test.ts pnpm-lock.yaml
git commit -m "feat(adapters): FirestoreBackendAdapter — construction guards (tenant scope/ops)"
```

---

### Task A2: Firestore query path tests via mocked client

**File:** `packages/adapters/tests/firestore-query.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { FirestoreBackendAdapter } from '../src/backend/firestore.js';

function mockFirestore(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const get = vi.fn(async () => ({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  }));
  // Chainable query mock: where/orderBy/limit all return the same chain object.
  const chain: any = { get };
  const where = vi.fn(() => chain);
  const orderBy = vi.fn(() => chain);
  const limit = vi.fn(() => chain);
  chain.where = where;
  chain.orderBy = orderBy;
  chain.limit = limit;
  const collection = vi.fn(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { collection, _spies: { where, orderBy, limit, get } } as any;
}

describe('FirestoreBackendAdapter — query path', () => {
  it('find substitutes $N placeholder and returns docs with id merged', async () => {
    const fs = mockFirestore([{ id: 'r1', data: { user_id: 'u-1', status: 'active' } }]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms',
          collection: 'rooms',
          where: [['user_id', '==', '$1']],
          params: { user_id: '$1' },
        },
      },
      _clientOverride: fs,
    });
    const r = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(r).toEqual([{ id: 'r1', user_id: 'u-1', status: 'active' }]);
    expect(fs._spies.where).toHaveBeenCalledWith('user_id', '==', 'u-1');
  });

  it('substitutes :name-style placeholder', async () => {
    const fs = mockFirestore([]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: {
          description: '',
          collection: 'rooms',
          where: [['user_id', '==', ':user_id']],
          params: { user_id: ':user_id' },
        },
      },
      _clientOverride: fs,
    });
    await adapter.query('q', { user_id: 'u-1' });
    expect(fs._spies.where).toHaveBeenCalledWith('user_id', '==', 'u-1');
  });

  it('applies orderBy + limit when present', async () => {
    const fs = mockFirestore([]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: {
          description: '',
          collection: 'rooms',
          where: [['user_id', '==', '$1']],
          orderBy: { field: 'created_at', direction: 'desc' },
          limit: 10,
          params: { user_id: '$1' },
        },
      },
      _clientOverride: fs,
    });
    await adapter.query('q', { user_id: 'u-1' });
    expect(fs._spies.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(fs._spies.limit).toHaveBeenCalledWith(10);
  });

  it('throws on unknown named query', async () => {
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        ok: { description: '', collection: 'r', where: [['user_id', '==', '$1']], params: { user_id: '$1' } },
      },
      _clientOverride: mockFirestore([]),
    });
    await expect(adapter.query('missing', { user_id: 'u' })).rejects.toThrow(/unknown named query/);
  });

  it('post-close query throws', async () => {
    const fs = mockFirestore([]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: { description: '', collection: 'r', where: [['user_id', '==', '$1']], params: { user_id: '$1' } },
      },
      _clientOverride: fs,
    });
    await adapter.query('q', { user_id: 'u' });
    await adapter.close();
    await expect(adapter.query('q', { user_id: 'u' })).rejects.toThrow(/closed/i);
  });
});
```

- [ ] **Step 2: Verify PASS**

```bash
pnpm --filter @contractqa/adapters exec vitest run tests/firestore-query.test.ts 2>&1 | tail -10
```

5 PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/tests/firestore-query.test.ts
git commit -m "test(adapters): FirestoreBackendAdapter query path via mocked client"
```

---

### Task A3: Public exports + STABILITY + public-surface test

**Files:**
- `packages/adapters/src/public.ts`
- `packages/adapters/STABILITY.md`
- `packages/adapters/tests/public-surface.test.ts`

- [ ] **Step 1: Add to public.ts**

After the `MongoBackendAdapter` export:
```ts
export { FirestoreBackendAdapter } from './backend/firestore.js';
```

(If the file uses grouped exports, update both spots.)

- [ ] **Step 2: Update STABILITY.md**

Append:
```markdown
## Stable since v0.11.0

- `FirestoreBackendAdapter` — read-only Firestore `BackendAdapter`. Server-side via `@google-cloud/firestore`. Construction-time guards: named-queries-only with `where: [field, op, value]` triples, tenant field must appear in `where` with `==` op, supported operators whitelist (==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in). Supports both `$N` and `:name` placeholder styles (parity with `MongoBackendAdapter`). Completes the `BackendAdapter` family (Postgres + Mongo + Firestore).
```

- [ ] **Step 3: Update public-surface test**

Read `tests/public-surface.test.ts` to find the expected-export set. Add `FirestoreBackendAdapter` to the expected list so the strict exhaustive guard stays green.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/public.ts packages/adapters/STABILITY.md packages/adapters/tests/public-surface.test.ts
git commit -m "feat(adapters): export FirestoreBackendAdapter from public surface"
```

---

# Part B: QA pass

### Task B1: Mongo in-flight queries drain on close

**Files:**
- `packages/adapters/src/backend/mongo.ts`
- `packages/adapters/tests/mongo-lifecycle.test.ts`

Currently `close()` only waits for in-flight `connectingP`, not in-flight `query()`. Phase 10 opus reviewer flagged the race: a `query()` already past `getDb()` runs against a `client` that `close()` then tears down.

- [ ] **Step 1: Append failing test**

```ts
// In tests/mongo-lifecycle.test.ts:
it('close() waits for in-flight queries to drain before closing client', async () => {
  let resolveToArray: (rows: unknown[]) => void = () => {};
  const slowToArray = vi.fn(() => new Promise<unknown[]>((res) => { resolveToArray = res; }));
  const client = {
    db: vi.fn(() => ({
      collection: vi.fn(() => ({
        find: vi.fn(() => ({ toArray: slowToArray })),
      })),
    })),
    close: vi.fn(async () => {}),
  };
  const adapter = new MongoBackendAdapter({
    uri: 'mongodb://x',
    database: 'test',
    tenantField: 'user_id',
    namedQueries: {
      q: { description: '', collection: 'r', operation: 'find', filter: { user_id: '$1' }, params: { user_id: '$1' } },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _clientOverride: client as any,
  });

  // Start query, but don't await yet.
  const queryP = adapter.query('q', { user_id: 'u' });
  // Concurrent close — should wait for query to finish.
  const closeP = adapter.close();

  // Let microtasks settle so close() observes the in-flight query.
  await new Promise((r) => setTimeout(r, 10));
  expect(client.close).not.toHaveBeenCalled(); // close hasn't actually run yet

  // Resolve the query.
  resolveToArray([{ ok: true }]);
  const rows = await queryP;
  expect(rows).toEqual([{ ok: true }]);
  await closeP;
  expect(client.close).toHaveBeenCalled(); // now closed
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Add `inFlight` counter + drain logic**

In `MongoBackendAdapter`:
```ts
private inFlight = 0;
```

Wrap `query()` body in increment/decrement:
```ts
async query(namedQuery: string, params: Record<string, unknown>): Promise<unknown[]> {
  this.inFlight++;
  try {
    // ...existing body...
  } finally {
    this.inFlight--;
  }
}
```

Modify `close()`:
```ts
async close(): Promise<void> {
  this.closed = true;
  if (this.connectingP) {
    try { await this.connectingP; } catch { /* ignore */ }
  }
  // Drain in-flight queries (up to 5s hard timeout).
  const deadline = Date.now() + 5_000;
  while (this.inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (this.client) {
    await this.client.close();
    this.client = null;
    this.connectingP = null;
  }
}
```

- [ ] **Step 4: Verify PASS** — new test passes; existing lifecycle tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/backend/mongo.ts packages/adapters/tests/mongo-lifecycle.test.ts
git commit -m "fix(adapters): mongo — close() drains in-flight queries before closing client"
```

---

### Task B2: Mongo JSDoc polish

**File:** `packages/adapters/src/backend/mongo.ts`

- [ ] **Step 1: Update `MongoNamedQuery.params` JSDoc**

Replace:
```ts
/** Params mapping; MUST include the tenantField. Values use `$1`-style placeholders. */
params: Record<string, string>;
```

With:
```ts
/**
 * Params mapping; MUST include the tenantField. Values use placeholder syntax:
 *  - `$N` (positional, e.g. `$1`, `$2`) — resolved by declaration order in this map
 *  - `:name` (named, e.g. `:user_id`) — resolved by name lookup at query time
 * Both styles can coexist within a single named query.
 */
params: Record<string, string>;
```

- [ ] **Step 2: Add a `close()` lifecycle JSDoc**

Above `async close(): Promise<void>`:

```ts
/**
 * Close the adapter. Sets a `closed` flag (post-close `query()` calls throw),
 * awaits any in-flight `connect()` promise, then drains in-flight `query()`
 * calls (up to 5s hard timeout) before terminating the underlying `MongoClient`.
 *
 * Concurrent `query()` and `close()`:
 *  - query already past `getDb()` → drained (its `toArray()` runs to completion)
 *  - query starting after `close()` flag set → throws `'is closed'`
 *
 * Idempotent — calling `close()` twice is safe.
 */
async close(): Promise<void> { /* ... */ }
```

- [ ] **Step 3: Verify** — no test changes, just docs. `pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -5`.

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/src/backend/mongo.ts
git commit -m "docs(adapters): mongo — placeholder styles + close lifecycle JSDoc"
```

---

### Task B3: custom-cookie detector adds pages/api/ variant

**Files:**
- `packages/cli/src/init/detect-framework.ts`
- `packages/cli/tests/detect-framework.test.ts`

- [ ] **Step 1: Append failing test**

```ts
it('flags custom-cookie when bcrypt + pages/api route handler both present', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*', bcrypt: '^5.0.0' } },
    files: ['package.json', 'pages/api/login.ts'],
  });
  expect(r.authSignals).toContain('custom-cookie');
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Extend the regex in the `custom-cookie` AUTH_RULE**

Current rule body:
```ts
return files.some((f) =>
  /^(src\/)?middleware\.(ts|tsx|js|jsx|mjs)$/.test(f) ||
  /^(src\/)?app\/api\/.+\.(ts|tsx|js|jsx|mjs)$/.test(f)
);
```

Add a third regex for pages-router:
```ts
return files.some((f) =>
  /^(src\/)?middleware\.(ts|tsx|js|jsx|mjs)$/.test(f) ||
  /^(src\/)?app\/api\/.+\.(ts|tsx|js|jsx|mjs)$/.test(f) ||
  /^(src\/)?pages\/api\/.+\.(ts|tsx|js|jsx|mjs)$/.test(f)
);
```

- [ ] **Step 4: Verify PASS** — new test passes; existing 6+ custom-cookie tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework.test.ts
git commit -m "feat(scan): custom-cookie detector — also recognize pages/api/ routes"
```

---

# Part C: Release v0.11.0

### Task C1: scripts/phase11-acceptance.sh

Copy `scripts/phase10-acceptance.sh` → `scripts/phase11-acceptance.sh`. Replace "Phase 10" → "Phase 11". Update opening comment.

```bash
chmod +x scripts/phase11-acceptance.sh
git add scripts/phase11-acceptance.sh
git commit -m "chore: scripts/phase11-acceptance.sh — Phase 11 release lane"
```

### Task C2: dogfood/FINDINGS.md

Add `## Phase 11 resolution status (v0.11.0)`:

```markdown
## Phase 11 resolution status (v0.11.0)

Findings RESOLVED in Phase 11:
- **FirestoreBackendAdapter** (was: deferred from Phase 4+). Completes the `BackendAdapter` family (Postgres + Mongo + Firestore). Read-only via `@google-cloud/firestore`; named queries with `where: [field, op, value]` triples; tenant scoping enforced at construction (tenant field must appear in `where` with `==` op); operator allowlist. Supports `$N` and `:name` placeholder styles (parity with Mongo). Unit tests via mocked client; real-Firestore emulator integration → Phase 12.
- **Mongo close() drains in-flight queries** (was: Phase 10 opus reviewer #1). Tracks `inFlight` count; `close()` waits up to 5s for active queries to finish before terminating client. Prevents Phase 10's documented race where `close()` could tear down a client mid-query.
- **Mongo JSDoc polish** (was: Phase 10 opus reviewer #2 + #3). `MongoNamedQuery.params` documents both `$N` and `:name` placeholder styles; `close()` documents the close lifecycle (closed flag → drain connectingP → drain inFlight → terminate).
- **custom-cookie pages-router variant** (was: Phase 10 opus reviewer #4). Detector now recognizes `pages/api/<route>.<ext>` alongside `app/api/<route>/route.ts` for older Next.js layouts.
```

Rename "Findings STILL DEFERRED to Phase 11:" → "Findings STILL DEFERRED to Phase 12:". Drop resolved items. New Phase 12 candidates:
- Real-Firestore emulator integration test (`@firebase/rules-unit-testing` or similar).
- File-content `cookies()` body parsing for `custom-cookie`.
- `client.db()` orphan-leak path (low probability; Phase 10 opus #5).

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 11 deliverables; reroll deferred list to Phase 12"
```

### Task C3: CHANGELOG + version bump → v0.11.0

Insert v0.11.0 section in `CHANGELOG.md` BEFORE v0.10.0:

```markdown
## v0.11.0 — 2026-05-15 (Phase 11)

Phase 11 completes the `BackendAdapter` family by shipping `FirestoreBackendAdapter` (third member alongside Postgres + Mongo). Plus 3 Phase 10 lifecycle/UX follow-ups.

### Added

- **`FirestoreBackendAdapter`** (`@stable since v0.11.0`). Read-only Firestore adapter via `@google-cloud/firestore`. Construction-time guards: named queries with `where: [field, op, value]` triples, tenant field must appear in `where` with `==` op, supported operators whitelist (==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in), optional `orderBy` / `limit`. Supports both `$N` and `:name` placeholder styles (parity with Mongo). Unit tests via mocked client; real-Firestore emulator integration → Phase 12. New dep: `@google-cloud/firestore ^7.x`. Completes the `BackendAdapter` family (kind union `'postgres' | 'mongo' | 'firestore' | 'custom'` now has 3 of 4 shipped).
- **`custom-cookie` detector recognizes pages-router routes.** Adds `(src/)?pages/api/<route>.<ext>` to the auth-file regex list, alongside `middleware.ts` and `app/api/<route>/route.ts`.

### Changed

- **No breaking changes.**
- `MongoBackendAdapter.close()` now drains in-flight queries (up to 5s timeout) before terminating the client. Prevents the documented race where a `query()` mid-call could run against a client `close()` was tearing down.
- `MongoNamedQuery.params` JSDoc documents both `$N` and `:name` placeholder styles.
- `MongoBackendAdapter.close()` JSDoc documents the close lifecycle (closed flag → drain connectingP → drain inFlight → terminate, idempotent).

### Still deferred (Phase 12 candidates)

- Real-Firestore emulator integration test.
- Firestore: more operators (e.g., not-yet-supported ones if added by Firebase).
- File-content `cookies()` body parsing for `custom-cookie`.
- `MongoClient.db()` orphan-leak path (low probability).
- HTTP-API contract surface (B5) — still no Postgres-wired target.
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
  sed -i '' 's/"version": "0.10.0"/"version": "0.11.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.10.0"/"@contractqa\/adapters": "^0.11.0"/' packages/adapters/templates/third-party/package.json
grep '"version"' packages/*/package.json
```

Commit:
```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.11.0 + CHANGELOG (Phase 11 — Firestore + Mongo lifecycle drain)"
```

DO NOT tag.

---

## Self-review notes

1. **Spec coverage:** A1 (Firestore guards) + A2 (query path) + A3 (exports) + B1 (in-flight drain) + B2 (JSDoc) + B3 (pages-router) + C1/C2/C3 (release). 9 commits total.
2. **Type consistency:** `WhereTriple` is a 3-tuple; `FirestoreOperator` is a string-literal union. No core changes needed.
3. **Risk:** A1's tenant guard requires the placeholder to match exactly. If users write `where: [['user_id', '==', 'literal-value']]` they bypass the placeholder check entirely. The construction check `v === tenantPlaceholder` (where `tenantPlaceholder` is e.g. `'$1'`) ensures they didn't substitute the value at construction time. Document this gotcha in JSDoc if needed.
4. **Risk:** B1's 5s drain timeout is arbitrary. If a query hangs forever, `close()` will force-close after 5s; in-flight `toArray()` will reject when the client closes. Acceptable: documented as a hard timeout.
5. **Risk:** A1's `@google-cloud/firestore` dep pulls in `grpc-js`, `google-auth-library`, etc. — heavyweight. Users who don't use Firestore still pay the install cost. Phase 12 candidate: make it an optional peer dep.

---

## Execution Handoff

Plan complete. Save state if needed; resume via `/resume-session-handoff`.

Execution: `superpowers:subagent-driven-development` with `.claude/worktrees/phase11-exec`.

Estimated size: ~9 tasks, ~1.5 hour focused session.
