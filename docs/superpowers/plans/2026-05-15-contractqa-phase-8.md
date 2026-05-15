# ContractQA Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `MongoBackendAdapter` — second member of the `BackendAdapter` family — following the Postgres adapter pattern from Phase 4. Plus close 2 Phase 7 carry-over items: dashboard Next.js 15 `params` typing + a heuristic `custom-cookie` auth detector. Release v0.8.0.

**Architecture:** Three parts.

- **Part A — `MongoBackendAdapter`.** Real Node.js driver (`mongodb`) with read-only guards (named-queries-only, forbidden-operators allowlist, mandatory tenant scope). Tests via **mocked client only** (no `mongodb-memory-server`, no docker fixture — integration testing is a Phase 9 candidate). The existing `BackendAdapter` interface already lists `'mongo'` in its `kind` union (core/src/types/adapter.ts:48), so no core changes needed.
- **Part B — QA pass (2 tasks).** Dashboard Next.js 15 `params: Promise<{id}>` migration (`app/issues/[id]/page.tsx`); add a `custom-cookie` heuristic auth detector (`bcryptjs` OR `bcrypt` + Next.js `cookies()` evidence).
- **Part C — Release v0.8.0.** Acceptance script, FINDINGS close-out, CHANGELOG, version bump.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. New runtime dep: `mongodb ^6.x` (in `packages/adapters`).

---

## Required reading (before starting)

1. `packages/adapters/src/backend/postgres.ts` — 93-line reference impl. Mirror the structure: `interface NamedQuery`, options interface, READ_VERBS regex equivalent, FORBIDDEN regex equivalent, `class implements BackendAdapter` with `kind: 'mongo'`.
2. `packages/adapters/tests/postgres-readonly.test.ts` — 80-line test reference. Mirror the construction-time guard tests; mongo's tests use mocked `MongoClient`.
3. `packages/core/src/types/adapter.ts` — `BackendAdapter` interface (kind, describe, query). No edit needed — Mongo kind is already declared.
4. `packages/adapters/src/public.ts` — public exports surface. Add `MongoBackendAdapter` alongside `PostgresBackendAdapter`.
5. `packages/cli/src/init/detect-framework.ts` — `AUTH_RULES` array. B2 adds a new rule for `custom-cookie`.
6. `apps/dashboard/app/issues/[id]/page.tsx:11` — current `params: { id: string }` typing. Next 15 requires `params: Promise<{ id: string }>`.

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict |
|---|---|
| Phase 8 anchor count | 1 (Mongo) + small QA pass (2 tasks) |
| Mongo testing strategy | **Unit tests only via mocked MongoClient.** Integration tests against real Mongo → Phase 9 (would need docker fixture or `mongodb-memory-server` infra). |
| Mongo "named query" shape | `{ collection, operation: 'find' \| 'aggregate', filter?, pipeline?, params }`. Forbidden operators rejected at construction: `$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$listLocalSessions`. |
| Mongo tenant guard | Same shape as Postgres: every named query must include `tenantField` in its `params`. |
| `custom-cookie` detector heuristic | Match when deps include `bcryptjs` OR `bcrypt`. (`cookies()` usage requires file-content parsing — out of scope; deps-co-occurrence is a reasonable first-cut.) |
| Dashboard `params` fix | Type-only change in `page.tsx`; await the promise before use. No app-level refactor. |
| Version target | v0.8.0 |
| External repo PRs | Still NO |

---

## Non-goals (do not touch)

- B5 HTTP-API contract surface — still deferred (no Postgres-wired target).
- Firestore `BackendAdapter` — Phase 9+.
- `mongodb-memory-server` integration tests — Phase 9.
- TypeScript project references (`tsc -b`).
- Persona dogfood agents, property/model-based test gen, dashboard §15.3–§15.6.
- File-content parsing for auth detection (still path-presence + deps-only).
- Real-Mongo dogfood target.
- Publishing to npm.
- Refactoring `composeAuth` snippet rendering in scan.ts beyond what current API requires.

---

## File structure

**New (Part A):**
- `packages/adapters/src/backend/mongo.ts` — `MongoBackendAdapter` class + types
- `packages/adapters/tests/mongo-readonly.test.ts` — construction-time guards via mocked client
- `packages/adapters/tests/mongo-query.test.ts` — query path via mocked client

**Modified (Part A):**
- `packages/adapters/package.json` — add `mongodb ^6.0.0` dep
- `packages/adapters/src/public.ts` — export `MongoBackendAdapter`
- `packages/adapters/STABILITY.md` — `MongoBackendAdapter` annotated `@stable since v0.8.0`
- `pnpm-lock.yaml` — auto-updated by pnpm

**Modified (Part B):**
- `apps/dashboard/app/issues/[id]/page.tsx` — `params: Promise<{ id: string }>` + `const { id } = await params`
- `packages/cli/src/init/detect-framework.ts` — add `custom-cookie` AUTH_RULE
- `packages/cli/tests/detect-framework.test.ts` — new test asserting `bcryptjs` triggers `custom-cookie`

**Modified (Part C):**
- `scripts/phase8-acceptance.sh` (new — copy from phase7)
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, 9 `packages/*/package.json`, third-party template peer

---

## Dependency graph

```
Part A (MongoBackendAdapter) ────┐
                                 ├──► Part C (release)
Part B (QA)                  ────┘
```

Suggested worktree: `.claude/worktrees/phase8-exec`.

---

# Part A: MongoBackendAdapter

**Acceptance gate A:** All construction-time guards reject invalid named queries (forbidden operators, missing tenant, non-read operations). `query()` path produces a flat array result via mocked client. Public API exports `MongoBackendAdapter` from `@contractqa/adapters`. Unit tests green.

---

### Task A1: Add `mongodb` dep + `MongoBackendAdapter` skeleton + construction guards

**Files:**
- Add dep to `packages/adapters/package.json`
- Create: `packages/adapters/src/backend/mongo.ts`
- Create: `packages/adapters/tests/mongo-readonly.test.ts`

- [ ] **Step 1: Add `mongodb` dep**

```bash
pnpm --filter @contractqa/adapters add mongodb
```

Verify in `packages/adapters/package.json` that `mongodb` (probably `^6.x`) is now under `dependencies`.

- [ ] **Step 2: Write failing tests (construction-time guards)**

```ts
// packages/adapters/tests/mongo-readonly.test.ts
import { describe, it, expect } from 'vitest';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

const baseOpts = {
  uri: 'mongodb://localhost:27017',
  database: 'test',
  tenantField: 'user_id',
};

describe('MongoBackendAdapter — construction guards', () => {
  it('accepts a valid find named query with tenant param', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        ok: {
          description: 'list rooms',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
    })).not.toThrow();
  });

  it('rejects a find query missing the tenant field in params', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'no tenant',
          collection: 'rooms',
          operation: 'find',
          filter: {},
          params: {},
        },
      },
    })).toThrow(/tenant/i);
  });

  it('rejects $where operator (JS injection)', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'js injection',
          collection: 'rooms',
          operation: 'find',
          filter: { $where: 'this.user_id == "x"' },
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden operator|\$where/i);
  });

  it('rejects $function operator', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'js function',
          collection: 'rooms',
          operation: 'find',
          filter: { $expr: { $function: { body: 'function() {}', args: [], lang: 'js' } } },
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden operator|\$function/i);
  });

  it('rejects aggregate pipeline with $out stage', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: '$out write',
          collection: 'rooms',
          operation: 'aggregate',
          pipeline: [{ $match: { user_id: '$1' } }, { $out: 'rooms_copy' }],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden|\$out/i);
  });

  it('rejects aggregate pipeline with $merge stage', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: '$merge write',
          collection: 'rooms',
          operation: 'aggregate',
          pipeline: [{ $merge: { into: 'rooms_copy' } }],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden|\$merge/i);
  });

  it('rejects operation type other than find / aggregate', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'wrong op',
          collection: 'rooms',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          operation: 'insert' as any,
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/operation/i);
  });
});
```

- [ ] **Step 3: Verify FAIL** — `pnpm --filter @contractqa/adapters exec vitest run tests/mongo-readonly.test.ts` — all FAIL (module doesn't exist yet).

- [ ] **Step 4: Implement `mongo.ts`**

```ts
// packages/adapters/src/backend/mongo.ts
import { MongoClient, type Db } from 'mongodb';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

export interface MongoNamedQuery {
  description: string;
  collection: string;
  operation: 'find' | 'aggregate';
  /** For operation='find'. */
  filter?: Record<string, unknown>;
  /** For operation='aggregate'. Array of stages. */
  pipeline?: Array<Record<string, unknown>>;
  /** Params mapping; MUST include the tenantField. Values use `$1`-style placeholders. */
  params: Record<string, string>;
}

export interface MongoBackendAdapterOptions {
  uri: string;
  database: string;
  tenantField: string;
  namedQueries: Record<string, MongoNamedQuery>;
  /** For tests — inject a pre-built client instead of opening via uri. */
  _clientOverride?: MongoClient;
}

const FORBIDDEN_OPERATORS = ['$where', '$function', '$accumulator', '$out', '$merge', '$listLocalSessions'];

/** Deep-walk an object/array; throw if any FORBIDDEN_OPERATORS appears as a key. */
function assertNoForbiddenOperators(node: unknown, namedQueryName: string): void {
  if (Array.isArray(node)) {
    for (const item of node) assertNoForbiddenOperators(item, namedQueryName);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_OPERATORS.includes(key)) {
        throw new Error(`named query "${namedQueryName}" uses forbidden operator ${key}`);
      }
      assertNoForbiddenOperators(val, namedQueryName);
    }
  }
}

/**
 * @stable since v0.8.0. Read-only Mongo-backed BackendAdapter.
 *
 * Enforces design-doc §7.6.3 safety rails:
 *  - Named queries only (no raw operations from contracts).
 *  - find / aggregate only (no insert / update / delete / replace).
 *  - Tenant field must be present in every query's `params`.
 *  - Forbidden operators rejected at construction: $where, $function, $accumulator, $out, $merge.
 */
export class MongoBackendAdapter implements BackendAdapter {
  readonly kind = 'mongo' as const;
  private client: MongoClient | null = null;
  private opts: MongoBackendAdapterOptions;

  constructor(opts: MongoBackendAdapterOptions) {
    for (const [name, q] of Object.entries(opts.namedQueries)) {
      if (q.operation !== 'find' && q.operation !== 'aggregate') {
        throw new Error(`named query "${name}": operation must be 'find' or 'aggregate', got '${q.operation}'`);
      }
      if (!(opts.tenantField in q.params)) {
        throw new Error(`named query "${name}": params is missing the tenant field "${opts.tenantField}"`);
      }
      if (q.operation === 'find') {
        assertNoForbiddenOperators(q.filter ?? {}, name);
      } else {
        assertNoForbiddenOperators(q.pipeline ?? [], name);
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
    const q = this.opts.namedQueries[namedQuery];
    if (!q) throw new Error(`unknown named query: ${namedQuery}`);

    const db = await this.getDb();
    const col = db.collection(q.collection);
    const substitute = (val: unknown): unknown => {
      if (typeof val === 'string' && /^\$\d+$/.test(val)) {
        // Map $1 → params[firstParamName], $2 → params[secondParamName], ...
        // Simple positional: walk params in declaration order.
        const idx = Number.parseInt(val.slice(1), 10) - 1;
        const paramName = Object.keys(q.params)[idx];
        if (!paramName) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
        return params[paramName];
      }
      if (Array.isArray(val)) return val.map(substitute);
      if (val && typeof val === 'object') {
        return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, substitute(v)]));
      }
      return val;
    };

    if (q.operation === 'find') {
      const filter = substitute(q.filter ?? {}) as Record<string, unknown>;
      return col.find(filter).toArray();
    } else {
      const pipeline = (substitute(q.pipeline ?? []) as Array<Record<string, unknown>>);
      return col.aggregate(pipeline).toArray();
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  private async getDb(): Promise<Db> {
    if (!this.client) {
      this.client = this.opts._clientOverride ?? new MongoClient(this.opts.uri);
      if (!this.opts._clientOverride) await this.client.connect();
    }
    return this.client.db(this.opts.database);
  }
}
```

- [ ] **Step 5: Verify PASS** — all 7 construction tests pass: `pnpm --filter @contractqa/adapters exec vitest run tests/mongo-readonly.test.ts 2>&1 | tail -10`.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM: worktree-phase8-exec
git add packages/adapters/package.json packages/adapters/src/backend/mongo.ts packages/adapters/tests/mongo-readonly.test.ts pnpm-lock.yaml
git commit -m "feat(adapters): MongoBackendAdapter — construction guards (read-only/tenant/operators)"
```

---

### Task A2: Mongo query path — mocked-client test for find + aggregate

**File:** `packages/adapters/tests/mongo-query.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/adapters/tests/mongo-query.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

function mockClient(rows: unknown[]) {
  const toArray = vi.fn(async () => rows);
  const find = vi.fn(() => ({ toArray }));
  const aggregate = vi.fn(() => ({ toArray }));
  const collection = vi.fn(() => ({ find, aggregate }));
  const db = vi.fn(() => ({ collection }));
  // Pretend it's already connected (no .connect() call needed).
  const close = vi.fn(async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db, close, _spies: { find, aggregate, toArray, collection } } as any;
}

describe('MongoBackendAdapter — query path', () => {
  it('find substitutes $1 with params[firstName] and returns rows', async () => {
    const client = mockClient([{ _id: 'r1', user_id: 'u-1' }]);
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
      _clientOverride: client,
    });
    const r = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(r).toEqual([{ _id: 'r1', user_id: 'u-1' }]);
    expect(client._spies.find).toHaveBeenCalledWith({ user_id: 'u-1' });
  });

  it('aggregate substitutes deep within pipeline stages', async () => {
    const client = mockClient([{ _id: 'r1' }]);
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        countByOwner: {
          description: 'count',
          collection: 'rooms',
          operation: 'aggregate',
          pipeline: [{ $match: { user_id: '$1' } }, { $count: 'n' }],
          params: { user_id: '$1' },
        },
      },
      _clientOverride: client,
    });
    await adapter.query('countByOwner', { user_id: 'u-1' });
    expect(client._spies.aggregate).toHaveBeenCalledWith([
      { $match: { user_id: 'u-1' } },
      { $count: 'n' },
    ]);
  });

  it('throws on unknown named query', async () => {
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        ok: { description: '', collection: 'r', operation: 'find', filter: { user_id: '$1' }, params: { user_id: '$1' } },
      },
      _clientOverride: mockClient([]),
    });
    await expect(adapter.query('missing', { user_id: 'u' })).rejects.toThrow(/unknown named query/);
  });
});
```

- [ ] **Step 2: Verify PASS** — `pnpm --filter @contractqa/adapters exec vitest run tests/mongo-query.test.ts 2>&1 | tail -10`. Implementation from A1 should already satisfy these tests via `_clientOverride`. If not, adjust A1's `getDb()` to skip `connect()` when `_clientOverride` is present (already in the snippet above).

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/tests/mongo-query.test.ts
git commit -m "test(adapters): MongoBackendAdapter query path via mocked client"
```

---

### Task A3: Public exports + STABILITY note

**Files:**
- `packages/adapters/src/public.ts`
- `packages/adapters/STABILITY.md`

- [ ] **Step 1: Add to public.ts**

After the `PostgresBackendAdapter` export, append:
```ts
export { MongoBackendAdapter } from './backend/mongo.js';
```

- [ ] **Step 2: Update STABILITY.md**

Add an entry under the relevant `## Stable since vX.Y.Z` section (or create `## Stable since v0.8.0`):

```markdown
## Stable since v0.8.0

- `MongoBackendAdapter` — read-only Mongo `BackendAdapter`. Construction-time guards: named-queries-only, `find`/`aggregate` operations only, mandatory tenant field, forbidden operators (`$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$listLocalSessions`) rejected via deep walk. Mirrors `PostgresBackendAdapter` API surface.
```

- [ ] **Step 3: Verify** — `pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -5`.

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/src/public.ts packages/adapters/STABILITY.md
git commit -m "feat(adapters): export MongoBackendAdapter from public surface"
```

---

# Part B: QA pass

### Task B1: Dashboard Next 15 `params: Promise<{ id }>` fix

**File:** `apps/dashboard/app/issues/[id]/page.tsx`

Next 15 changed the App Router page-param type: `params` is now a `Promise`. The current declaration `params: { id: string }` causes a typecheck error.

- [ ] **Step 1: Read the current shape**

```bash
head -20 apps/dashboard/app/issues/\[id\]/page.tsx
```

- [ ] **Step 2: Update the typing + await**

```ts
export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...rest of the function uses `id` instead of `params.id`...
}
```

Be careful to replace ALL `params.id` references with the destructured `id`.

- [ ] **Step 3: Verify dashboard builds further than before**

```bash
pnpm --filter @contractqa/dashboard run build 2>&1 | tail -15
```

The `params`-Promise error should be gone. If the build STILL fails for a different reason, capture it but don't block Phase 8 — A8's gate is "the `params` error is gone".

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/issues/\[id\]/page.tsx
git commit -m "fix(dashboard): Next.js 15 params is Promise — await before use"
```

---

### Task B2: `custom-cookie` AuthSignal detector (bcryptjs / bcrypt heuristic)

**Files:**
- `packages/cli/src/init/detect-framework.ts`
- `packages/cli/tests/detect-framework.test.ts`

Phase 7 documented `custom-cookie` as "no detector yet". Phase 8 adds a deps-only heuristic: presence of `bcryptjs` OR `bcrypt` in dependencies signals a hand-rolled cookie-auth setup. False positives are acceptable (it's an advisory signal).

- [ ] **Step 1: Append failing test**

```ts
// In tests/detect-framework.test.ts — append:
it('flags custom-cookie when bcryptjs is in deps', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*', bcryptjs: '^3.0.0' } },
    files: ['package.json'],
  });
  expect(r.authSignals).toContain('custom-cookie');
});

it('flags custom-cookie when bcrypt is in deps', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*', bcrypt: '^5.0.0' } },
    files: ['package.json'],
  });
  expect(r.authSignals).toContain('custom-cookie');
});

it('does not flag custom-cookie when neither bcrypt variant is present', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*' } },
    files: ['package.json'],
  });
  expect(r.authSignals).not.toContain('custom-cookie');
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm --filter contractqa exec vitest run tests/detect-framework.test.ts 2>&1 | tail -10`. First 2 fail (no detector yet).

- [ ] **Step 3: Add rule to AUTH_RULES array**

Append:
```ts
{ signal: 'custom-cookie', test: (d) => !!d['bcryptjs'] || !!d['bcrypt'] },
```

- [ ] **Step 4: Update the JSDoc on `AuthSignal`** (Phase 7 said "no detector yet" — now there is one):

```ts
/**
 * Auth provider signals detected via package.json deps.
 *
 * `'custom-cookie'` is a heuristic signal: presence of `bcryptjs` or `bcrypt`
 * in deps suggests a hand-rolled cookie-auth setup. Advisory only — false
 * positives are acceptable (a project might use bcrypt for non-auth password
 * hashing). Phase 9 candidate: layer in file-presence verification (look for
 * `cookies()` usage in middleware or route handlers).
 */
export type AuthSignal = ...
```

- [ ] **Step 5: Verify PASS** — `pnpm --filter contractqa exec vitest run tests/detect-framework.test.ts 2>&1 | tail -10`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework.test.ts
git commit -m "feat(scan): custom-cookie AuthSignal detector (bcrypt(js) heuristic)"
```

---

# Part C: Release v0.8.0

### Task C1: `scripts/phase8-acceptance.sh`

Copy `scripts/phase7-acceptance.sh` → `scripts/phase8-acceptance.sh`. Relabel headers (Phase 7 → Phase 8). Update opening comment to describe Phase 8's shipment (Mongo adapter + 2 QA items).

```bash
chmod +x scripts/phase8-acceptance.sh
git add scripts/phase8-acceptance.sh
git commit -m "chore: scripts/phase8-acceptance.sh — Phase 8 release lane"
```

### Task C2: `dogfood/FINDINGS.md`

Add `## Phase 8 resolution status (v0.8.0)` after Phase 7's resolution section:

```markdown
## Phase 8 resolution status (v0.8.0)

Findings RESOLVED in Phase 8:
- **Mongo BackendAdapter** (was: deferred from Phase 4+). `MongoBackendAdapter` ships with construction-time read-only guards (named-queries-only, find/aggregate only, mandatory tenant field, forbidden-operator deep-walk: $where, $function, $accumulator, $out, $merge, $listLocalSessions). Unit tests via mocked client only — real-Mongo integration is Phase 9.
- **`custom-cookie` AuthSignal detector** (was: Phase 7 documented as missing). Deps-only heuristic: `bcryptjs` or `bcrypt` presence triggers the signal. Advisory; false positives accepted.
- **Dashboard Next 15 `params: Promise` migration** (was: Phase 7 surfaced as a Next 15 typecheck error). `app/issues/[id]/page.tsx` now awaits `params` before destructuring.
```

Rename "Findings STILL DEFERRED to Phase 8:" to "Findings STILL DEFERRED to Phase 9:". Drop items resolved here; carry the rest forward; add new candidates:
- Real-Mongo integration tests (`mongodb-memory-server` or docker fixture).
- Firestore BackendAdapter.
- File-content parsing for `custom-cookie` (cookies() usage verification).

Commit:
```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 8 deliverables; reroll deferred list to Phase 9"
```

### Task C3: CHANGELOG + version bump → v0.8.0

In `CHANGELOG.md`, prepend a v0.8.0 section before v0.7.0. Structure mirrors prior phases (Added / Changed / Still deferred).

Body:

```markdown
## v0.8.0 — 2026-05-15 (Phase 8)

Phase 8 ships `MongoBackendAdapter` (second member of the `BackendAdapter` family) plus a deps-only `custom-cookie` auth detector and the Next 15 dashboard `params` migration.

### Added

- **`MongoBackendAdapter`** (`@stable since v0.8.0`). Read-only Mongo `BackendAdapter` mirroring the `PostgresBackendAdapter` shape from Phase 4. Construction-time guards: named-queries-only; `find` / `aggregate` operations only (no `insertOne`/`updateOne`/`deleteOne`/`replaceOne`); mandatory tenant field in every query's `params`; deep-walk rejection of forbidden operators (`$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$listLocalSessions`). Positional placeholder substitution: `$1`, `$2`, ... map to params in declaration order. New dep: `mongodb ^6.x`. Unit tests via mocked client; integration tests against real Mongo are a Phase 9 candidate.
- **`custom-cookie` AuthSignal detector.** Deps-only heuristic: presence of `bcryptjs` or `bcrypt` triggers the signal. Closes the Phase 7 "no detector yet" JSDoc gap. Advisory only; false positives accepted (e.g., a project that uses bcrypt for non-auth password hashing).

### Changed

- **No breaking changes.**
- `apps/dashboard/app/issues/[id]/page.tsx` migrated to Next.js 15's `params: Promise<{ id }>` typing. Awaits `params` before destructuring.
- `AuthSignal['custom-cookie']` JSDoc updated to describe the new detector + Phase 9 next-step.

### Still deferred (Phase 9 candidates)

- Real-Mongo integration tests (`mongodb-memory-server` or docker fixture).
- Firestore / custom `BackendAdapter` implementations.
- HTTP-API contract surface (B5) — still no Postgres-wired target.
- File-content parsing for auth detection (currently deps + path-presence only).
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
  sed -i '' 's/"version": "0.7.0"/"version": "0.8.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.7.0"/"@contractqa\/adapters": "^0.8.0"/' packages/adapters/templates/third-party/package.json
grep '"version"' packages/*/package.json   # verify 9 → 0.8.0
```

Commit:

```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.8.0 + CHANGELOG (Phase 8 — Mongo + QA)"
```

Do NOT tag.

---

## Self-review notes

1. **Spec coverage:** A1 (impl + guards) + A2 (query path) + A3 (exports) + B1 (dashboard) + B2 (custom-cookie) + C1/C2/C3 (release). 8 tasks total.
2. **Type consistency:** `MongoNamedQuery` is a NEW type. `BackendAdapter` interface's `kind: 'mongo'` is already in core — no core change.
3. **Risk:** A1 uses a deep-walk for forbidden operators. The walk visits every key in nested objects/arrays — could be slow on very large pipelines. For Phase 8 acceptable; if performance matters in Phase 9, switch to a top-level + targeted check.
4. **Risk:** The substitution path uses positional `$1`/`$2` mapping. The Postgres adapter uses the same convention. Document if a contract author hits an off-by-one.
5. **Risk:** Mongo's `$expr` allows referencing aggregation expressions — could it bypass the `$where`/`$function` reject? The deep walk catches both since it visits every key. Verified.

---

## Execution Handoff

Plan complete. Save state if needed; resume via `/resume-session-handoff`.

Execution: `superpowers:subagent-driven-development` with `.claude/worktrees/phase8-exec` worktree (same pattern as Phase 5/6/7).

Estimated size: ~8 tasks, ~1-2 hour focused session.
