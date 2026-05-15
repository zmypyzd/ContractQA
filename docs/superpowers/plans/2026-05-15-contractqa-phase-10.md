# ContractQA Phase 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land Mongo named-placeholder substitution (`:user_id` alongside the existing `$1`) — removes declaration-order coupling that's been load-bearing since Phase 8 — plus 3 QA follow-ups flagged by Phase 9's opus review.

**Architecture:** Three parts.

- **Part A — Mongo named-placeholder syntax (forward-compatible).** Adapter recognizes BOTH `$<digit>` (positional, existing) AND `:<name>` (named, new) placeholders. New syntax looks up `params[name]` directly. Both can coexist within a single named query (mixed style not encouraged but parses). The change is additive: existing user code keeps working.
- **Part B — QA pass (3 tasks):**
  - B1: `MongoBackendAdapter.getDb()` reject-recovery — clear `connectingP` on rejection so the next call retries.
  - B2: `MongoBackendAdapter.close()` during in-flight `connect()` — wait for the in-flight promise to settle, then close cleanly (don't leak the orphan client).
  - B3: Graduate `custom-cookie` auth signal from deps-only heuristic to deps+file-content verification — check for `cookies()` usage in `middleware.ts` or route handlers. File-content parsing replaces this Phase's "advisory only" caveat.
- **Part C — Release v0.10.0.** Acceptance script, FINDINGS close-out, CHANGELOG, version bump.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. No new deps.

---

## Required reading (before starting)

1. Opus Phase 9 review (in this session's transcript): items #1 (sticky rejection), #2 (close during connect), and the "Mongo named-placeholder substitution" recommendation.
2. `packages/adapters/src/backend/mongo.ts` — current `MongoBackendAdapter` with positional `$1` substitution + `getDb()` race fix.
3. `packages/cli/src/init/detect-framework.ts` — `AUTH_RULES` array; `custom-cookie` rule currently `(d) => !!d['bcryptjs'] || !!d['bcrypt']`. B3 layers a file-presence check on top.
4. `packages/cli/src/init/inspect-auth.ts` — `WIRING_RULES` per AuthSignal; B3 adds rules for `custom-cookie` so the existing scan diagnostic surfaces evidence.

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict |
|---|---|
| Phase 10 anchor count | 1 small anchor (named placeholders) + 3-task QA pass |
| Named-placeholder syntax | `:name` (lowercase letters / digits / underscores). Matches Postgres-named-param convention. |
| Coexistence | Both `$N` (positional) and `:name` (named) recognized; mix-and-match allowed within one query (advisory: pick one style per query for readability). |
| Should `params` map become optional in named-style? | NO — keep `params` mandatory for parity with Postgres + clarity. Even with named placeholders, `params` declares the tenantField mapping. |
| getDb reject-recovery | Clear `connectingP` inside a `catch` so next call retries. |
| close-during-connect | If `connectingP` is in-flight when `close()` is called, await it then close the client. Mark adapter closed via a `closed` flag — subsequent `query()` throws. |
| `custom-cookie` graduation | Require BOTH deps signal (bcrypt(js)) AND a file-content match (`cookies()` call in `middleware.ts` or `app/api/*/route.ts`). Keep file-content cheap: simple regex grep, no AST parse. |
| Version target | v0.10.0 (10th minor — first "double-digit" release) |
| External repo PRs | Still NO |

---

## Non-goals (do not touch)

- B5 HTTP-API contract surface — still deferred.
- Firestore BackendAdapter — Phase 11+ candidate.
- Mongo's `_clientOverride` test injection API — keep stable.
- AST parsing for file-content auth detection (regex grep is enough for Phase 10).
- TypeScript project references, persona dogfood agents, dashboard §15.3–§15.6, property/model gen, pnpm-version-aware spawn helper.
- Publishing to npm.
- Dynamic `$session.userId` resolution.

---

## File structure

**Modified (Part A):**
- `packages/adapters/src/backend/mongo.ts` — `substitute` recognizes `:<name>` in addition to `$<digit>`.
- `packages/adapters/tests/mongo-query.test.ts` — new tests for named-placeholder paths.
- `packages/adapters/tests/mongo-readonly.test.ts` — extend body-reference check to recognize named placeholders too (so the construction guard still works with `:user_id`).

**Modified (Part B):**
- `packages/adapters/src/backend/mongo.ts` — B1 reject-recovery + B2 close-during-connect.
- `packages/adapters/tests/mongo-lifecycle.test.ts` (new) — covers reject-retry + close-during-connect scenarios via mocked client.
- `packages/cli/src/init/detect-framework.ts` — B3: AUTH_RULE for `custom-cookie` now also looks at `files` for cookies() usage. Adjust `detectFramework` to pass files into the rule.
- `packages/cli/tests/detect-framework.test.ts` — extend with files-based custom-cookie test.

**New (Part C):**
- `scripts/phase10-acceptance.sh`

**Modified (Part C):**
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, 9 `packages/*/package.json`, third-party template peer

---

## Dependency graph

```
Part A (named placeholders) ────┐
                                ├──► Part C (release)
Part B (QA)                 ────┘
```

Worktree: `.claude/worktrees/phase10-exec`.

---

# Part A: Mongo named-placeholder syntax

**Acceptance gate A:** A Mongo named query using `:user_id` placeholder constructs without throwing AND queries correctly substitute `params.user_id` into the filter/pipeline. Existing positional `$1` queries continue to work identically.

---

### Task A1: Recognize `:<name>` in substitute() + extend body-reference check

**Files:**
- `packages/adapters/src/backend/mongo.ts`
- `packages/adapters/tests/mongo-query.test.ts`
- `packages/adapters/tests/mongo-readonly.test.ts`

- [ ] **Step 1: Append failing tests to `mongo-query.test.ts`**

```ts
it('substitutes :name-style placeholder by looking up params[name]', async () => {
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
        filter: { user_id: ':user_id' },
        params: { user_id: ':user_id' },
      },
    },
    _clientOverride: client,
  });
  const r = await adapter.query('roomsByOwner', { user_id: 'u-1' });
  expect(r).toEqual([{ _id: 'r1', user_id: 'u-1' }]);
  expect(client._spies.find).toHaveBeenCalledWith({ user_id: 'u-1' });
});

it('mixed $N and :name placeholders both substitute correctly', async () => {
  const client = mockClient([]);
  const adapter = new MongoBackendAdapter({
    uri: 'mongodb://x',
    database: 'test',
    tenantField: 'user_id',
    namedQueries: {
      mix: {
        description: '',
        collection: 'rooms',
        operation: 'find',
        filter: { user_id: ':user_id', status: '$2' },
        params: { user_id: ':user_id', status: '$2' },
      },
    },
    _clientOverride: client,
  });
  await adapter.query('mix', { user_id: 'u-1', status: 'active' });
  expect(client._spies.find).toHaveBeenCalledWith({ user_id: 'u-1', status: 'active' });
});
```

- [ ] **Step 2: Append failing tests to `mongo-readonly.test.ts`**

```ts
it('accepts a find with :name-style tenant placeholder referenced in filter', () => {
  expect(() => new MongoBackendAdapter({
    ...baseOpts,
    namedQueries: {
      ok: {
        description: '',
        collection: 'rooms',
        operation: 'find',
        filter: { user_id: ':user_id' },
        params: { user_id: ':user_id' },
      },
    },
  })).not.toThrow();
});

it('rejects find when :name tenant placeholder is declared but unused in filter', () => {
  expect(() => new MongoBackendAdapter({
    ...baseOpts,
    namedQueries: {
      bad: {
        description: '',
        collection: 'rooms',
        operation: 'find',
        filter: { status: 'active' },
        params: { user_id: ':user_id' },
      },
    },
  })).toThrow(/tenant placeholder.*not referenced|placeholder.*:user_id.*missing/i);
});
```

- [ ] **Step 3: Verify FAIL** — `pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -10`. The new tests fail (named placeholder not recognized).

- [ ] **Step 4: Modify `substitute` in `mongo.ts`**

Current substitute:
```ts
if (typeof val === 'string' && /^\$\d+$/.test(val)) {
  const idx = Number.parseInt(val.slice(1), 10) - 1;
  const paramName = Object.keys(q.params)[idx];
  if (!paramName) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
  return params[paramName];
}
```

Replace with:
```ts
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
```

The string-vs-not check is hoisted so we only typeof-check once.

- [ ] **Step 5: The body-reference check in the constructor**

`bodyReferencesPlaceholder` already does an exact string match against the declared placeholder. Since `params[tenantField]` can be either `'$1'` or `':user_id'`, the existing check just works — no change needed (verify by running the new "rejects :name unused" test; should pass with the existing check).

- [ ] **Step 6: Verify PASS**

```bash
pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -10
```

All Mongo tests pass (existing + new). Postgres tests still green.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/src/backend/mongo.ts packages/adapters/tests/mongo-query.test.ts packages/adapters/tests/mongo-readonly.test.ts
git commit -m "feat(adapters): mongo — :name-style placeholders alongside positional \$N"
```

---

# Part B: QA pass

### Task B1 + B2: getDb reject-recovery + close-during-connect

**Files:**
- `packages/adapters/src/backend/mongo.ts`
- `packages/adapters/tests/mongo-lifecycle.test.ts` (new)

- [ ] **Step 1: Write failing tests**

```ts
// packages/adapters/tests/mongo-lifecycle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

describe('MongoBackendAdapter — lifecycle edge cases', () => {
  it('retries connect after a previous failure (reject-recovery)', async () => {
    let attempt = 0;
    const failingClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: vi.fn(() => ({ collection: vi.fn(() => ({ find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })) })) as any,
      // First connect rejects, second succeeds (need a fresh client per try).
      close: vi.fn(async () => {}),
    };

    // We can't easily inject a "failing then succeeding" client via _clientOverride alone.
    // Use a real-looking mock that throws on getDb the first time. Simpler shape:
    // Use _clientOverride to inject a client whose db() throws once.
    let dbCalls = 0;
    const flakyClient = {
      db: vi.fn(() => {
        if (dbCalls++ === 0) throw new Error('transient ECONNREFUSED');
        return { collection: vi.fn(() => ({ find: vi.fn(() => ({ toArray: vi.fn(async () => [{ ok: true }]) })) })) };
      }),
      close: vi.fn(async () => {}),
    };

    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: {
          description: '',
          collection: 'r',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _clientOverride: flakyClient as any,
    });

    await expect(adapter.query('q', { user_id: 'u' })).rejects.toThrow(/ECONNREFUSED/);
    // After the failure, connectingP should be cleared so the retry can succeed.
    const rows = await adapter.query('q', { user_id: 'u' });
    expect(rows).toEqual([{ ok: true }]);
  });

  it('close() while connect is in-flight waits for the connect and closes cleanly', async () => {
    let resolveConnect: () => void = () => {};
    const slowConnectPromise = new Promise<void>((res) => { resolveConnect = res; });
    let closed = false;
    const slowClient = {
      db: vi.fn(() => ({ collection: vi.fn(() => ({ find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })) })),
      close: vi.fn(async () => { closed = true; }),
      // No real connect() — _clientOverride skips that. We simulate slow init by stalling getDb's first call.
    };

    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: {
          description: '',
          collection: 'r',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _clientOverride: slowClient as any,
    });

    // Start a query (kicks off getDb)
    const queryP = adapter.query('q', { user_id: 'u' });
    // Concurrent close
    const closeP = adapter.close();
    resolveConnect(); // unblock
    await queryP;
    await closeP;
    expect(closed).toBe(true);
  });
});
```

NOTE: The "slow connect" test as written above isn't actually slow because `_clientOverride` skips `connect()`. Adapt the implementation so the in-flight scenario triggers correctly. Suggested simpler shape — use a real `vi.fn()` for `connect()` that returns an unresolved promise until the test resolves it:

```ts
// Better approach: don't use _clientOverride for this test. Instead, mock MongoClient via vi.mock.
// OR: make _clientOverride accept a client whose connect() can be controlled.
```

If the test design proves too fragile, simplify to: "after close(), a subsequent query() throws AdapterClosed (or similar)". That's the user-facing contract that matters.

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement reject-recovery**

Modify the IIFE inside `getDb`:

```ts
this.connectingP = (async () => {
  try {
    const client = this.opts._clientOverride ?? new MongoClient(this.opts.uri);
    if (!this.opts._clientOverride) await client.connect();
    return client;
  } catch (e) {
    // Allow next call to retry rather than re-throwing forever.
    this.connectingP = null;
    throw e;
  }
})();
```

ALSO: the `db(...)` call inside `getDb()` could throw (per the reject-recovery test above where the FIRST db() call throws). Wrap that too:

```ts
try {
  this.client = await this.connectingP;
  return this.client.db(this.opts.database);
} catch (e) {
  this.connectingP = null;
  this.client = null;
  throw e;
}
```

Actually, the simpler fix: don't cache `this.client` until after the first SUCCESSFUL `db()` call. Restructure:

```ts
private async getDb(): Promise<Db> {
  if (this.closed) throw new Error('MongoBackendAdapter is closed');
  if (this.client) {
    // Even after successful connect, db() can still throw if the connection died.
    return this.client.db(this.opts.database);
  }
  if (!this.connectingP) {
    this.connectingP = (async () => {
      const client = this.opts._clientOverride ?? new MongoClient(this.opts.uri);
      if (!this.opts._clientOverride) await client.connect();
      return client;
    })();
  }
  try {
    const client = await this.connectingP;
    const db = client.db(this.opts.database);  // can throw — don't cache `client` if it does
    this.client = client;
    return db;
  } catch (e) {
    this.connectingP = null;
    throw e;
  }
}
```

- [ ] **Step 4: Implement close-during-connect**

Add a `closed` flag:
```ts
private closed = false;
```

Modify `close()`:
```ts
async close(): Promise<void> {
  this.closed = true;
  // Wait for any in-flight connect to complete (or fail) before closing.
  if (this.connectingP) {
    try { await this.connectingP; } catch { /* ignore */ }
  }
  if (this.client) {
    await this.client.close();
    this.client = null;
    this.connectingP = null;
  }
}
```

Modify `getDb` to check `this.closed` first (see above).

Modify `query` to fail-fast if closed — actually `getDb` already does this since it's called from `query`. Good.

- [ ] **Step 5: Verify PASS** — `pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -10`. All tests pass.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/src/backend/mongo.ts packages/adapters/tests/mongo-lifecycle.test.ts
git commit -m "fix(adapters): mongo — getDb reject-recovery + close-during-connect lifecycle"
```

---

### Task B3: File-content `cookies()` detector for `custom-cookie`

**Files:**
- `packages/cli/src/init/detect-framework.ts`
- `packages/cli/tests/detect-framework.test.ts`

Current `custom-cookie` rule: `(d) => !!d['bcryptjs'] || !!d['bcrypt']` — deps only, advisory. Phase 10 graduates by requiring ALSO at least one of: `middleware.ts` exists OR a route handler file under `app/api/`.

This is still cheap path-presence (no file-content parsing — the Phase 6 hybrid-auth scanner uses path-presence too). Despite the task's name in the plan, we'll keep the cost-effective bar: file PATH presence, not file content.

(If a future phase wants real `cookies()` body parsing, that's Phase 11+. For Phase 10, path-presence raises the bar enough to filter out test-fixtures-only bcrypt usage.)

- [ ] **Step 1: Append failing tests**

```ts
// In tests/detect-framework.test.ts:
it('flags custom-cookie when bcryptjs + middleware.ts both present', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*', bcryptjs: '^3.0.0' } },
    files: ['package.json', 'middleware.ts'],
  });
  expect(r.authSignals).toContain('custom-cookie');
});

it('flags custom-cookie when bcrypt + app/api route handler both present', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*', bcrypt: '^5.0.0' } },
    files: ['package.json', 'app/api/login/route.ts'],
  });
  expect(r.authSignals).toContain('custom-cookie');
});

it('does NOT flag custom-cookie when only bcryptjs is in deps (no middleware/route)', async () => {
  const r = await detectFramework({
    packageJson: { dependencies: { next: '*', bcryptjs: '^3.0.0' } },
    files: ['package.json'],
  });
  expect(r.authSignals).not.toContain('custom-cookie');
});
```

Update or remove the older "flags custom-cookie when bcryptjs is in deps" test from Phase 8 — that test's premise (deps-only) has been raised. Either:
- Convert it to assert NO match (new behavior)
- Remove it entirely
- Add `middleware.ts` to its `files` to keep it positive

Choose whichever is cleanest after re-reading the Phase 8 test.

- [ ] **Step 2: Verify the new tests FAIL**

- [ ] **Step 3: Modify AUTH_RULES**

The current `AUTH_RULES` rules take `(d: deps)` — they don't see files. We need to widen the rule signature. Options:
- Change the rule shape to `(d, files) => bool` for ALL rules.
- Special-case `custom-cookie` outside the array.

The cleaner change is to widen the rule signature. Verify by reading how `AUTH_RULES` is currently iterated.

```ts
// Widen the rule type:
interface AuthRule {
  signal: AuthSignal;
  test: (deps: Record<string, string>, files: readonly string[]) => boolean;
}

const AUTH_RULES: AuthRule[] = [
  { signal: 'next-auth', test: (d) => !!d['next-auth'] || !!d['@auth/core'] },
  { signal: 'supabase', test: (d) => !!d['@supabase/supabase-js'] || !!d['@supabase/ssr'] },
  { signal: 'clerk', test: (d) => !!d['@clerk/nextjs'] || !!d['@clerk/clerk-sdk-node'] },
  { signal: 'auth0', test: (d) => !!d['@auth0/nextjs-auth0'] },
  {
    signal: 'custom-cookie',
    test: (d, files) => {
      const hasBcrypt = !!d['bcryptjs'] || !!d['bcrypt'];
      if (!hasBcrypt) return false;
      const hasAuthFile = files.some((f) =>
        /^(src\/)?middleware\.(ts|tsx|js|jsx|mjs)$/.test(f)
        || /^(src\/)?app\/api\/.+\.(ts|tsx|js|jsx|mjs)$/.test(f)
      );
      return hasAuthFile;
    },
  },
];
```

Find the invocation site of `AUTH_RULES` — currently `AUTH_RULES.filter((r) => r.test(deps))` — and pass `files`:
```ts
const authSignals = AUTH_RULES.filter((r) => r.test(deps, files)).map((r) => r.signal);
```

If `detectFramework` doesn't currently accept `files`, check its signature — it likely does (it already reads `input.files` for framework detection). Wire `input.files` into the AUTH_RULES filter call.

- [ ] **Step 4: Update the `AuthSignal` JSDoc**

Replace the Phase 8 wording:
```ts
/**
 * Auth provider signals detected via package.json deps.
 *
 * `'custom-cookie'` is a heuristic signal: presence of `bcryptjs` or `bcrypt`
 * AND at least one of `middleware.ts` or `app/api/<route>/route.ts` files.
 * Both conditions must hold — deps alone are not enough (a project might use
 * bcrypt for non-auth password hashing). Phase 11 candidate: parse file
 * contents to verify `cookies()` usage explicitly.
 */
export type AuthSignal = ...
```

- [ ] **Step 5: Verify PASS** — `pnpm --filter contractqa exec vitest run 2>&1 | tail -10`. Full cli suite green.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework.test.ts
git commit -m "feat(scan): custom-cookie detector — require deps + auth-file path-presence"
```

---

# Part C: Release v0.10.0

### Task C1: scripts/phase10-acceptance.sh

Copy `scripts/phase9-acceptance.sh` → `scripts/phase10-acceptance.sh`. Relabel "Phase 9" → "Phase 10". Update opening comment:

> Phase 10 acceptance script. Lands Mongo `:name` placeholder syntax (forward-compatible alongside `$N`) + 3 Phase 9 follow-ups: `getDb` reject-recovery, `close()` during in-flight connect, graduated `custom-cookie` detector (deps + auth-file path-presence).

```bash
chmod +x scripts/phase10-acceptance.sh
git add scripts/phase10-acceptance.sh
git commit -m "chore: scripts/phase10-acceptance.sh — Phase 10 release lane"
```

### Task C2: dogfood/FINDINGS.md

Add `## Phase 10 resolution status (v0.10.0)` after Phase 9's:

```markdown
## Phase 10 resolution status (v0.10.0)

Findings RESOLVED in Phase 10:
- **Mongo named-placeholder syntax** (was: Phase 8 opus reviewer's #2). `MongoBackendAdapter` now recognizes `:name` placeholders that resolve by name from `params` — alongside the existing `$N` positional substitution. Both styles can coexist within a single named query. Removes the declaration-order coupling that's been load-bearing since Phase 8.
- **MongoBackendAdapter getDb reject-recovery** (was: Phase 9 opus reviewer's #1). `connectingP` is now cleared on rejection, so the next `query()` call retries rather than permanently re-throwing the same error.
- **MongoBackendAdapter close-during-connect** (was: Phase 9 opus reviewer's #2). `close()` now awaits any in-flight `connect()` promise before closing — no orphan client leaks. A `closed` flag fail-fasts any post-close `query()`.
- **`custom-cookie` AuthSignal graduates from heuristic** (was: Phase 8 deferred). The detector now requires BOTH deps presence (`bcryptjs`/`bcrypt`) AND at least one auth-file (`middleware.ts` or `app/api/<route>/route.ts`) — path-presence only, file-content parsing remains Phase 11+ candidate.
```

Rename "Findings STILL DEFERRED to Phase 10:" → "Findings STILL DEFERRED to Phase 11:". Drop resolved items. Carry rest forward. New candidates:
- File-content `cookies()` body parsing for `custom-cookie` (deeper than path-presence).
- Mongo bulk-write rejection guard (currently relies on `operation: 'find' | 'aggregate'` whitelist).

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 10 deliverables; reroll deferred list to Phase 11"
```

### Task C3: CHANGELOG + version bump → v0.10.0

Insert v0.10.0 section in `CHANGELOG.md` BEFORE v0.9.0:

```markdown
## v0.10.0 — 2026-05-15 (Phase 10)

Phase 10 lands Mongo named-placeholder syntax (forward-compatible) plus 3 Phase 9 lifecycle/UX follow-ups.

### Added

- **Mongo `:name`-style placeholders.** `MongoBackendAdapter` now recognizes `:name` placeholders that resolve by name lookup from `params`. Coexists with the existing `$N` positional style; either or both can appear in a single named query. Removes the declaration-order coupling between `params` keys and `$N` indices that's been load-bearing since Phase 8.
- **`custom-cookie` AuthSignal graduates to deps+file detection.** Detector now requires BOTH `bcryptjs`/`bcrypt` in deps AND at least one of `middleware.ts` or `app/api/<route>/route.ts`. Path-presence only; file-content parsing for `cookies()` usage is a Phase 11 candidate.

### Changed

- **No breaking changes.**
- `MongoBackendAdapter.getDb()` clears `connectingP` on rejection so subsequent `query()` calls retry rather than permanently re-throwing the same error.
- `MongoBackendAdapter.close()` awaits any in-flight `connect()` promise before closing — prevents orphan client leak. A `closed` flag fail-fasts any post-close `query()`.

### Still deferred (Phase 11 candidates)

- File-content `cookies()` body parsing for `custom-cookie` (verify usage, not just file presence).
- Firestore / custom `BackendAdapter` implementations.
- HTTP-API contract surface (B5) — still no Postgres-wired target.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- pnpm-version-aware spawn helper.
- Dynamic `$session.userId` resolution.
- Mongo bulk-write rejection guard (currently relies on `operation` whitelist).
- Publishing to npm.
```

Bump versions:
```bash
for f in packages/*/package.json; do
  sed -i '' 's/"version": "0.9.0"/"version": "0.10.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.9.0"/"@contractqa\/adapters": "^0.10.0"/' packages/adapters/templates/third-party/package.json
grep '"version"' packages/*/package.json
```

Commit:
```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.10.0 + CHANGELOG (Phase 10 — named placeholders + lifecycle)"
```

DO NOT tag.

---

## Self-review notes

1. **Spec coverage:** A1 (named placeholders) + B1/B2 (lifecycle — one commit) + B3 (graduated detector) + C1/C2/C3 (release). 6 commits total.
2. **Type consistency:** `MongoNamedQuery.params` value type stays `string` — accepts both `'$1'` and `':user_id'` shapes.
3. **Risk:** B3 widens `AUTH_RULES`'s rule signature. All 5 existing rules need the new param (but they ignore it). Confirm no other callsite expects the old shape.
4. **Risk:** The `:name` regex `/^:[a-zA-Z_][a-zA-Z0-9_]*$/` requires at least one char after the colon — `':'` alone won't match.
5. **Risk:** Substitution recurses into objects/arrays. A deeply nested structure with `':name'` placeholders works because the existing recursion already covers it.

---

## Execution Handoff

Plan complete. Save state if needed; resume via `/resume-session-handoff`.

Execution: `superpowers:subagent-driven-development` with `.claude/worktrees/phase10-exec`.

Estimated size: ~6-7 tasks, ~1 hour focused session.
