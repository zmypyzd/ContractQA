# ContractQA Phase 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the family-wide tenant-placeholder gap on `BackendAdapter` (Postgres + Mongo): the construction guard currently only checks that the tenant field is *declared* in `params` — it doesn't verify the placeholder is actually *referenced* in the SQL body / Mongo filter / pipeline. A user can write `params: { user_id: '$1' }` with a filter that ignores `$1` and the guard passes silently. Phase 9 forces references at construction. Plus 3 QA follow-ups from Phase 8's opus review.

**Architecture:** Three parts.

- **Part A — Tenant-placeholder body reference check.** Both adapters validate at construction that `params[tenantField]` (e.g., `$1`) is referenced at least once in the query body:
  - `PostgresBackendAdapter`: grep the `sql` string for the placeholder token (`\$N` with word boundary).
  - `MongoBackendAdapter`: deep-walk `filter` or `pipeline` checking for any string equal to the placeholder.
  Both adapters: throw a clear error naming the query if the placeholder is absent.
- **Part B — QA pass (3 tasks):**
  - B1: Real-Mongo integration test via `mongodb-memory-server` for `MongoBackendAdapter` — confirms the mocked tests reflect actual behavior.
  - B2: `MongoBackendAdapter.getDb()` race fix — memoize a connecting promise so concurrent `query()` calls share one connection.
  - B3: `apps/dashboard/next-env.d.ts` to `.gitignore`.
- **Part C — Release v0.9.0.** Acceptance script, FINDINGS close-out, CHANGELOG, version bump.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. New devDep: `mongodb-memory-server ^10.x` (in `packages/adapters` devDeps for integration test).

---

## Required reading (before starting)

1. `packages/adapters/src/backend/postgres.ts` — current `PostgresBackendAdapter` constructor; A1 adds the body-reference check next to existing guards.
2. `packages/adapters/src/backend/mongo.ts` — current `MongoBackendAdapter` constructor; A2 adds equivalent check.
3. `packages/adapters/tests/postgres-readonly.test.ts` and `tests/mongo-readonly.test.ts` — extend with new "missing placeholder reference" cases.
4. Opus Phase 8 review (in this session's transcript): items #1 (tenant-placeholder body check), #2 (named-placeholder UX — DEFERRED to Phase 10), #3 (getDb race), #5 (`next-env.d.ts`).

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict |
|---|---|
| Phase 9 anchor count | 1 (tenant-placeholder body check) + 3-task QA pass |
| Tenant-placeholder check semantics | "at least one reference in body"; if `params[tenantField]` is missing, the existing guard catches that first |
| Postgres check method | Regex `\bSQL_PLACEHOLDER\b` on the `sql` string (e.g., `/\$1\b/` for `$1`). No real SQL parsing. |
| Mongo check method | Deep-walk `filter`/`pipeline`; track if any string value equals the placeholder. |
| Mongo integration test scope | Single end-to-end test: spin up `mongodb-memory-server`, insert two test docs, run a find query, assert the result. Acceptance via `pnpm --filter @contractqa/adapters exec vitest run tests/mongo-integration.test.ts`. Skip on CI if `MONGOMS_SKIP` env is set. |
| getDb race fix | Single `private connectingP: Promise<MongoClient> \| null = null;` — gates concurrent calls on the same promise. |
| Named-placeholder syntax (`:user_id`) | **DEFERRED to Phase 10** — would require dual-path code or a breaking change; not bundling. |
| Version target | v0.9.0 |
| External repo PRs | Still NO |

---

## Non-goals (do not touch)

- B5 HTTP-API contract surface — still deferred.
- Firestore `BackendAdapter` — Phase 10+ candidate.
- Mongo named-placeholder syntax (`:user_id`) — Phase 10 (or v1.0 if becomes breaking).
- Real-Postgres integration test addition (already exists via fixtures/supabase-stack — no new infra needed).
- TypeScript project references, persona dogfood agents, dashboard §15.3–§15.6, property/model gen.
- Publishing to npm.
- File-content `cookies()` verification for `custom-cookie` (Phase 10).

---

## File structure

**Modified (Part A):**
- `packages/adapters/src/backend/postgres.ts` — add `assertTenantPlaceholderReferenced()` helper + call inside constructor loop
- `packages/adapters/src/backend/mongo.ts` — add `assertTenantPlaceholderReferenced()` helper + call inside constructor loop
- `packages/adapters/tests/postgres-readonly.test.ts` — new "missing-reference" test case
- `packages/adapters/tests/mongo-readonly.test.ts` — new "missing-reference" test case

**New (Part B):**
- `packages/adapters/tests/mongo-integration.test.ts` — real-Mongo end-to-end via `mongodb-memory-server` (B1)

**Modified (Part B):**
- `packages/adapters/package.json` — add `mongodb-memory-server` to `devDependencies` (B1)
- `packages/adapters/src/backend/mongo.ts` — memoize `connectingP` (B2)
- `.gitignore` — add `apps/dashboard/next-env.d.ts` (B3)

**New (Part C):**
- `scripts/phase9-acceptance.sh` (copy from phase8)

**Modified (Part C):**
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, 9 `packages/*/package.json`, third-party template peer

---

## Dependency graph

```
Part A (tenant-placeholder) ────┐
                                ├──► Part C (release)
Part B (QA)                 ────┘
```

Worktree: `.claude/worktrees/phase9-exec`.

---

# Part A: Tenant-placeholder body reference check

**Acceptance gate A:** A construction-time test with `params: { user_id: '$1' }` and a filter/SQL that DOES NOT reference `$1` throws `/tenant placeholder.*not referenced|missing.*placeholder/i`. Existing passing cases still pass.

---

### Task A1: Postgres adapter — body-reference check

**Files:**
- `packages/adapters/src/backend/postgres.ts`
- `packages/adapters/tests/postgres-readonly.test.ts`

- [ ] **Step 1: Append failing test**

```ts
// In tests/postgres-readonly.test.ts:
it('rejects named query where tenant placeholder is not referenced in SQL body', () => {
  expect(() => new PostgresBackendAdapter({
    dsn: 'postgres://x',
    tenantField: 'user_id',
    namedQueries: {
      bad: {
        description: 'tenant declared but unused',
        sql: 'SELECT id FROM rooms WHERE 1 = 1',  // no $1 reference!
        params: { user_id: '$1' },
      },
    },
  })).toThrow(/tenant placeholder.*not referenced|placeholder.*\$1.*missing/i);
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm --filter @contractqa/adapters exec vitest run tests/postgres-readonly.test.ts 2>&1 | tail -10`.

- [ ] **Step 3: Implement check in constructor**

Inside the existing `for (const [name, q] of ...)` loop, after the FORBIDDEN_DML_DDL check, add:

```ts
// Tenant placeholder must be REFERENCED in the SQL body, not just declared in params.
const tenantPlaceholder = q.params[opts.tenantField];
if (tenantPlaceholder) {
  // tenantPlaceholder is the user's declared symbol, e.g. '$1'. Word-boundary match.
  // Escape regex specials in case the user uses '$1' (literal $ is special — escape it).
  const escaped = tenantPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ref = new RegExp(`(?<![\\w$])${escaped}(?![\\w])`);
  if (!ref.test(q.sql)) {
    throw new Error(`named query "${name}": tenant placeholder ${tenantPlaceholder} is declared in params but not referenced in SQL body`);
  }
}
```

NOTE: `$1` is the Postgres placeholder; the lookbehind `(?<![\w$])` ensures we don't match `$11` or `r$1`. Lookahead `(?![\w])` ensures `$1` doesn't match the leading part of `$11`.

- [ ] **Step 4: Verify PASS** — `pnpm --filter @contractqa/adapters exec vitest run tests/postgres-readonly.test.ts 2>&1 | tail -10`. Full adapter suite green.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM: worktree-phase9-exec
git add packages/adapters/src/backend/postgres.ts packages/adapters/tests/postgres-readonly.test.ts
git commit -m "feat(adapters): postgres — tenant placeholder must be referenced in SQL body"
```

---

### Task A2: Mongo adapter — body-reference check

**Files:**
- `packages/adapters/src/backend/mongo.ts`
- `packages/adapters/tests/mongo-readonly.test.ts`

- [ ] **Step 1: Append failing test**

```ts
// In tests/mongo-readonly.test.ts:
it('rejects find query where tenant placeholder is not referenced in filter', () => {
  expect(() => new MongoBackendAdapter({
    ...baseOpts,
    namedQueries: {
      bad: {
        description: 'tenant declared but unused',
        collection: 'rooms',
        operation: 'find',
        filter: { status: 'active' },  // no $1 reference!
        params: { user_id: '$1' },
      },
    },
  })).toThrow(/tenant placeholder.*not referenced|placeholder.*\$1.*missing/i);
});

it('rejects aggregate where tenant placeholder is not referenced in pipeline', () => {
  expect(() => new MongoBackendAdapter({
    ...baseOpts,
    namedQueries: {
      bad: {
        description: 'tenant declared but unused',
        collection: 'rooms',
        operation: 'aggregate',
        pipeline: [{ $match: { status: 'active' } }],  // no $1
        params: { user_id: '$1' },
      },
    },
  })).toThrow(/tenant placeholder.*not referenced|placeholder.*\$1.*missing/i);
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement check**

Add a helper:

```ts
function bodyReferencesPlaceholder(node: unknown, placeholder: string): boolean {
  if (typeof node === 'string') return node === placeholder;
  if (Array.isArray(node)) return node.some((n) => bodyReferencesPlaceholder(n, placeholder));
  if (node && typeof node === 'object') {
    return Object.values(node as Record<string, unknown>).some((v) => bodyReferencesPlaceholder(v, placeholder));
  }
  return false;
}
```

Inside the constructor loop, after `assertNoForbiddenOperators`:

```ts
const tenantPlaceholder = q.params[opts.tenantField];
if (tenantPlaceholder) {
  const body = q.operation === 'find' ? (q.filter ?? {}) : (q.pipeline ?? []);
  if (!bodyReferencesPlaceholder(body, tenantPlaceholder)) {
    throw new Error(`named query "${name}": tenant placeholder ${tenantPlaceholder} is declared in params but not referenced in ${q.operation === 'find' ? 'filter' : 'pipeline'}`);
  }
}
```

- [ ] **Step 4: Verify PASS** — both new tests pass; existing 9 mongo-readonly tests still pass; full adapter suite green.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/src/backend/mongo.ts packages/adapters/tests/mongo-readonly.test.ts
git commit -m "feat(adapters): mongo — tenant placeholder must be referenced in filter/pipeline"
```

---

# Part B: QA pass

### Task B1: Mongo real-Mongo integration test via `mongodb-memory-server`

**Files:**
- `packages/adapters/package.json` — add `mongodb-memory-server` devDep
- `packages/adapters/tests/mongo-integration.test.ts` (new)

- [ ] **Step 1: Add devDep**

```bash
pnpm --filter @contractqa/adapters add -D mongodb-memory-server
```

Verify in `packages/adapters/package.json`.

- [ ] **Step 2: Write integration test**

```ts
// packages/adapters/tests/mongo-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

const SKIP = process.env['MONGOMS_SKIP'] === '1';

(SKIP ? describe.skip : describe)('MongoBackendAdapter — real-Mongo integration', () => {
  let mongod: MongoMemoryServer;
  let adapter: MongoBackendAdapter;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();

    // Seed two docs
    const client = new MongoClient(uri);
    await client.connect();
    await client.db('test').collection('rooms').insertMany([
      { _id: 'r1' as any, user_id: 'u-1', status: 'active' },
      { _id: 'r2' as any, user_id: 'u-2', status: 'active' },
    ]);
    await client.close();

    adapter = new MongoBackendAdapter({
      uri,
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms owned by user',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await adapter.close();
    await mongod.stop();
  });

  it('find returns only docs matching the tenant scope', async () => {
    const rows = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).user_id).toBe('u-1');
  });

  it('find returns empty when no docs match', async () => {
    const rows = await adapter.query('roomsByOwner', { user_id: 'u-nobody' });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @contractqa/adapters exec vitest run tests/mongo-integration.test.ts 2>&1 | tail -15
```

Expected: 2 PASS (initial download of mongodb-memory-server binaries may take 30-60s the first time).

If `mongodb-memory-server` fails to download on your network, set `MONGOMS_SKIP=1` and re-run; the suite should report 2 SKIPPED. Don't block on the download failure for this commit — record it in your report and proceed.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/package.json packages/adapters/tests/mongo-integration.test.ts pnpm-lock.yaml
git commit -m "test(adapters): real-Mongo integration via mongodb-memory-server"
```

---

### Task B2: Mongo `getDb()` concurrent-init race fix

**File:** `packages/adapters/src/backend/mongo.ts`

Current `getDb()` creates a fresh `MongoClient` if `this.client` is null — two concurrent calls can both pass the null check and create two clients. Fix by memoizing the connecting promise.

- [ ] **Step 1: Apply the change**

Add a class field:
```ts
private connectingP: Promise<MongoClient> | null = null;
```

Rewrite `getDb`:
```ts
private async getDb(): Promise<Db> {
  if (!this.client) {
    if (!this.connectingP) {
      this.connectingP = (async () => {
        const client = this.opts._clientOverride ?? new MongoClient(this.opts.uri);
        if (!this.opts._clientOverride) await client.connect();
        return client;
      })();
    }
    this.client = await this.connectingP;
  }
  return this.client.db(this.opts.database);
}
```

Update `close()` to also clear `connectingP`:
```ts
async close(): Promise<void> {
  if (this.client) {
    await this.client.close();
    this.client = null;
    this.connectingP = null;
  }
}
```

- [ ] **Step 2: Verify** — all mongo tests still pass.

```bash
pnpm --filter @contractqa/adapters exec vitest run 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add packages/adapters/src/backend/mongo.ts
git commit -m "fix(adapters): mongo getDb — memoize connecting promise (concurrent-init race)"
```

---

### Task B3: `.gitignore` apps/dashboard/next-env.d.ts

**File:** `.gitignore`

- [ ] **Step 1: Read current .gitignore**

```bash
grep -n "next-env\|dashboard\|\.d\.ts" .gitignore | head
```

- [ ] **Step 2: Append a Next.js section if not present**

```
# Next.js auto-generated type stub (regenerated on every build)
apps/dashboard/next-env.d.ts
```

If `.gitignore` already has a global `*.d.ts` pattern, skip this task and note it.

- [ ] **Step 3: Verify untracked**

```bash
git status --short
# apps/dashboard/next-env.d.ts should NOT appear if it was already untracked + now ignored
```

If the file was already tracked, you may need to `git rm --cached apps/dashboard/next-env.d.ts` first — but verify with `git ls-files apps/dashboard/next-env.d.ts` before doing so.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD     # CONFIRM
git add .gitignore
git commit -m "chore: gitignore apps/dashboard/next-env.d.ts (Next.js auto-generated)"
```

---

# Part C: Release v0.9.0

### Task C1: scripts/phase9-acceptance.sh

Copy `scripts/phase8-acceptance.sh` to `scripts/phase9-acceptance.sh`. Relabel headers. Update opening comment to describe Phase 9 (tenant-placeholder body check + real-Mongo integration test + getDb race + next-env gitignore).

```bash
chmod +x scripts/phase9-acceptance.sh
git add scripts/phase9-acceptance.sh
git commit -m "chore: scripts/phase9-acceptance.sh — Phase 9 release lane"
```

### Task C2: dogfood/FINDINGS.md

Add `## Phase 9 resolution status (v0.9.0)`:

```markdown
## Phase 9 resolution status (v0.9.0)

Findings RESOLVED in Phase 9:
- **Tenant-placeholder body reference check** (was: Phase 8 opus reviewer's #1 Minor — family-wide gap). Both `PostgresBackendAdapter` and `MongoBackendAdapter` now reject at construction if `params[tenantField]` is declared but the placeholder is not referenced in the query body (SQL / filter / pipeline). Closes the "guard passes silently while tenant scope is bypassable" hole.
- **Real-Mongo integration test** (was: Phase 8 deferred). `tests/mongo-integration.test.ts` spins up `mongodb-memory-server`, seeds two docs, runs a `find` named query, asserts tenant scoping works end-to-end. Skips on `MONGOMS_SKIP=1` for CI without binary download.
- **MongoBackendAdapter getDb concurrent-init race** (was: Phase 8 opus reviewer's #3 Minor). `getDb()` now memoizes a single connecting promise so two simultaneous `query()` calls share one `MongoClient` instance.
- **`apps/dashboard/next-env.d.ts` gitignored** (was: Phase 8 opus reviewer's #5 Minor). Next.js regenerates this file on every build; no longer surfaces as working-tree noise.
```

Rename "Findings STILL DEFERRED to Phase 9:" → "Findings STILL DEFERRED to Phase 10:". Drop resolved items. Carry rest forward. New candidates added:
- Mongo named-placeholder substitution (`:user_id` instead of `$1`) — Phase 8 opus reviewer's #2 Minor.
- File-content `cookies()` verification for `custom-cookie`.

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 9 deliverables; reroll deferred list to Phase 10"
```

### Task C3: CHANGELOG + version bump → v0.9.0

Insert v0.9.0 section BEFORE v0.8.0 in `CHANGELOG.md`:

```markdown
## v0.9.0 — 2026-05-15 (Phase 9)

Phase 9 closes the family-wide tenant-placeholder gap on `BackendAdapter` (Postgres + Mongo) plus 3 Phase 8 follow-ups.

### Added

- **Tenant-placeholder body reference check** on both `PostgresBackendAdapter` and `MongoBackendAdapter`. Construction-time guard rejects named queries where `params[tenantField]` is declared but the placeholder is not actually referenced in the SQL body / Mongo filter / pipeline. Closes a "silent guard, bypassable scope" hole flagged by Phase 8's opus review. Per-adapter implementation:
  - Postgres: word-boundary regex on the `sql` string for the declared placeholder token.
  - Mongo: deep-walk over `filter` / `pipeline` checking for any string equal to the placeholder.
- **Real-Mongo integration test** via `mongodb-memory-server` (new devDep). End-to-end exercise of `MongoBackendAdapter` against an actual Mongo instance. Skips cleanly when `MONGOMS_SKIP=1` (CI lanes without binary download).

### Changed

- **No breaking changes.**
- `MongoBackendAdapter.getDb()` memoizes a single connecting promise to prevent concurrent-init races (two simultaneous `query()` calls now share one `MongoClient`).
- `.gitignore` now excludes `apps/dashboard/next-env.d.ts` (Next.js regenerates on every build).

### Still deferred (Phase 10 candidates)

- Mongo named-placeholder substitution (`:user_id` instead of `$1`) — removes declaration-order coupling.
- Firestore / custom `BackendAdapter` implementations.
- HTTP-API contract surface (B5) — still no Postgres-wired target.
- File-content parsing for auth detection (verify `cookies()` usage for `custom-cookie`).
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
  sed -i '' 's/"version": "0.8.0"/"version": "0.9.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.8.0"/"@contractqa\/adapters": "^0.9.0"/' packages/adapters/templates/third-party/package.json
grep '"version"' packages/*/package.json   # verify 9 → 0.9.0
```

Commit:
```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.9.0 + CHANGELOG (Phase 9 — tenant guard + integration test)"
```

Do NOT tag.

---

## Self-review notes

1. **Spec coverage:** A1 (Postgres body-ref) + A2 (Mongo body-ref) + B1 (mongo-integration) + B2 (getDb race) + B3 (.gitignore) + C1/C2/C3 (release). 8 tasks.
2. **Type consistency:** No type changes — only construction-time runtime guards + an internal field on MongoBackendAdapter (`connectingP`).
3. **Risk:** A1's regex on the SQL string could mistakenly match a `$1` inside a string literal (e.g., `'$1'`). For the body-reference check that's acceptable: even a literal mention proves the user *thought about* the placeholder. False positives are fine (it'd accept a bogus query); false negatives would be the real problem (a query without ANY mention of `$1` is the case we want to reject).
4. **Risk:** B1 mongodb-memory-server downloads a Mongo binary on first run. Network-isolated environments fail. Documented via `MONGOMS_SKIP=1` opt-out.
5. **Risk:** B2's `connectingP` memoization assumes promises persist correctly — if `connect()` throws, `connectingP` would hold a rejected promise and all subsequent calls would re-throw without retry. Acceptable for tests (one-shot); could be a Phase 10 follow-up to clear `connectingP` on rejection.

---

## Execution Handoff

Plan complete. Save state if needed; resume via `/resume-session-handoff`.

Execution: `superpowers:subagent-driven-development` with `.claude/worktrees/phase9-exec`.

Estimated size: ~8 tasks, ~1-1.5 hour focused session.
