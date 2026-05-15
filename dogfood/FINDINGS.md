# Dogfood findings — cross-target

Per-target details live in each subdir's `FINDINGS.md`. This file collects
findings that appeared across **two or more** targets — those are the
strongest signals for Phase 2.

## Headline (after 3 targets)

**Phase 1's core is genuinely framework-agnostic.** Three dogfoods
on three distinct stacks (React+react-router+cookie, Next.js+NextAuth+Supabase,
Vue+Vite+no-auth) — same `compileContract`, same `snapshotBrowser`,
same `runOracle`. Zero core code had to change to drive a Vue app. The
issues we hit are all in the **glue around the core** (CLI scaffold,
auth adapters, preflight, ergonomics), not in the contract→verdict
pipeline itself.

This is the single most important framing for the Phase 2 plan: budget
~zero for the core, all investment in the glue.

## Cross-cutting (≥2 targets)

### Schema is too thin for real-app DOM (5-4-codex, website-vercel-supabase)

Real apps regularly have:
- Multiple elements with the same accessible name (duplicate "Login" links)
- Localized text that's only stable if the test forces a locale
- DOM-state invariants (toast not visible, button enabled) that the YAML
  schema can't express today

Fixed-in-loop: `target.first: boolean` (website-vercel-supabase).
Still open: `target.within: <ancestor-role>`, `dom.contains_text` /
`dom.not_contains_text`, `target.locale: zh|en` for i18n stability.

### Host-app preconditions have no preflight (5-4-codex, website-vercel-supabase)

- 5-4-codex: better-sqlite3 native binding compiled for a different Node
  version — host crashes silently at boot
- website-vercel-supabase: required Supabase URL + NextAuth secret env vars
  before module init succeeds

Phase 2 task: `contractqa doctor <target>` that runs through:
1. Detect package manager (npm/pnpm/yarn/bun)
2. Detect node version mismatches → suggest `nvm use` / `pnpm rebuild`
3. Detect required env vars → suggest stubs or write `.env.dogfood`
4. Detect external service deps (Supabase, Postgres, MinIO) → suggest
   docker-compose snippets
5. Try to boot once, capture stderr, surface first non-noise error line

### Reporter doesn't bundle on PASS (all 3 targets)

Phase 1's `ContractQAReporter` early-returns when `result.status !== 'failed'`.
Every dogfood wanted bundles on PASS (proof of run, drift baseline). We
worked around by calling `writeEvidenceBundle` directly. Phase 2:
`ReporterOptions.alwaysBundle?: boolean`.

### Standalone (non-Playwright-runner) driver pattern emerging (all 3 targets)

Every dogfood drives contracts via plain vitest + `chromium.launch()` +
manual `compileContract` + manual `writeEvidenceBundle`. The
@playwright/test runner is not used. This pattern is so consistent it
should be a first-class API:

```ts
import { runContract } from '@contractqa/runner';
const { verdict, bundlePath } = await runContract({
  contract: inv,
  page,
  context,
  artifactsRoot,
  authProvider: 'custom-cookie',
});
```

Today this is ~70 lines of glue per dogfood.

## Target-specific summary (Phase 2 = 5 targets, §23.1 acceptance met)

| Target | Stack | Auth | Result |
|---|---|---|---|
| [5-4-codex](./5-4-codex/FINDINGS.md) | Vite + React + react-router + Fastify | Custom cookie session | PASS + 1 oracle bug fixed (cookie classifier) |
| [website-vercel-supabase](./website-vercel-supabase/FINDINGS.md) | Next.js 16 + NextAuth v5 + Supabase | NextAuth+Supabase composite | PASS + schema changes (`target.first`, `target.within`) |
| [wolfmind](./wolfmind/FINDINGS.md) | Vue 3 + Vite + FastAPI | None | PASS — no new findings beyond what targets 1-2 already surfaced |
| [5-4-claude](./5-4-claude/FINDINGS.md) | Vite + React + Supabase (stub env) | supabase-js direct | PASS — Supabase+Vite path works; hybrid auth finding |
| [agent-poker-platform-gpt](./agent-poker-platform-gpt/FINDINGS.md) | Vite + React + Fastify (LLM-author variant) | Custom cookie session | PASS — null divergence finding |

## Phase 2 resolution status (after T1–T22)

Findings RESOLVED in Phase 2:
- ✅ Cookie classifier delta-only (5-4-codex #1, fixed pre-Phase-2 in 2a75413)
- ✅ Schema thinness on no-auth UIs → T4 `dom:` block
- ✅ Multi-match locator → already-shipped `target.first` + T3 `target.within`
- ✅ i18n stability → T6 `goto.locale`
- ✅ about:blank SecurityError → T5 origin-less tolerance
- ✅ Reporter no-bundle on PASS → T2 `alwaysBundle`
- ✅ Standalone runner glue → T1 `runContract()`
- ✅ No cookie-session AuthAdapter → T15 `CustomCookieAuthAdapter`
- ✅ Multi-adapter composition → T16 `composeAuth`
- ✅ Env preflight → T11 + T13 `contractqa doctor`
- ✅ Native-dep rebuild detection → T12 (best-effort, surfaces candidates)
- ✅ Port-collision footgun → T9 `allocatePort`
- ✅ Workspace-only install → T19 `pnpm pack:host`
- ✅ 5-target validation (§23.1) → 5 PASS verdicts across 5 stacks

## Phase 3 resolution status (v0.3.0 + v0.3.1 fix)

Findings RESOLVED in Phase 3:
- ✅ Vendored Supabase stack rebuilt on Supabase CLI in v0.3.1 (Phase 3's hand-rolled docker-compose was incomplete — `supabase/postgres` uses `supabase_admin` as superuser, the `auth` schema isn't auto-created, GoTrue migrations reference roles that don't exist; switching to `supabase start` removed three cascading init bugs and is what upstream maintains).
- ✅ `contractqa init` framework detection → A1–A3 (rule-based detector + per-framework scaffolds + auto-detect wiring)
- ✅ `contractqa scan` read-only project survey → A4
- ✅ `contractqa doctor --fix` one-shot remediation → A5–A8 (native-deps via `npm rebuild`, env-stub from `.env.example`, port-collision via `allocatePort`)
- ✅ SupabaseAuthAdapter v2 with default `loginAs` → B3 (injectable tokenIssuer, real GoTrue fetch, `responsibilities: ['session']`)
- ✅ Real-Supabase fixture (vs stub-env) → B1–B2 (vendored docker-compose stack with pinned tags)
- ✅ Real-cloud lane CI integration → B6 (opt-in workflow_dispatch + path-filtered PR)
- ✅ Public adapter API → C1–C6 (`@contractqa/adapters/public` semver surface, STABILITY.md, third-party starter, out-of-tree smoke test, design doc §7.6.5 reversal)
- ✅ Acceptance-script ordering bug (build → typecheck → test) → D1 (cheap mitigation for the tsc -b backlog item)
- ✅ Detector also handles `src/app/` and `src/pages/` layouts → inline fix during A9 dogfood (f0d8a2a)

## Phase 4 resolution status (v0.4.0)

Findings RESOLVED in Phase 4:
- ✅ `contractqa doctor` hardening — workspace-aware native-dep scanner walks `apps/*` + `packages/*` package.jsons; `--fix=native-deps` runs `cd node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> && npm run install` (the only path that triggers `prebuild-install` reliably under pnpm 10); boot-probe extracts `NODE_MODULE_VERSION X requires Y` from stderr and surfaces an ABI-mismatch hint pointing at the fix command. Today's regression case (5-4-codex / agent-poker-platform-gpt better-sqlite3 ABI 115 vs 127) becomes detectable + auto-fixable. → A1, A2, A3, A5
- ✅ `BackendAdapter` real impl — `PostgresBackendAdapter` promoted from `@experimental` stub to `@stable`. Read-only DSN guarded at construction (rejects INSERT/UPDATE/DELETE/DROP/CREATE/TRUNCATE/GRANT; accepts SELECT and WITH...SELECT). Mandatory tenant scope — `query()` throws when tenant field absent from params. Named queries only (no raw SQL). → B1, B2, B3, B4
- ✅ Monorepo / polyglot subdirectory detection in `contractqa init` — new `detectFrameworkInRepo` walks `apps/*`, `packages/*`, `web`, `frontend`, `client`, `site`. `init` and `scan` both gain `--target <subdir>` flag and auto-select the highest-confidence candidate. AmbiguousTarget thrown on tied confidence. Resolves the 5-4-codex / WolfMind / 5-4-claude `unknown`-detection regression. → C1, C2, C3
- ✅ True per-responsibility routing in `composeAuth` — `currentUser` now routes to `'user-store'` owner (falling back to `'session'`); `expectFullyLoggedOut` runs against ALL adapters and AND-merges `fullyLoggedOut` + UNIONs `leaked_keys`. Phase 3 B4's "adjusted to match observed bug" test reverted. → D1, D2

Findings STILL DEFERRED to Phase 8:
Phase 6 closed the hybrid-auth scanner anchor and the 5 minor follow-ups from Phase 5's final review. Phase 7 closed the dashboard build fix and 4 Phase 6 final-review follow-ups. The HTTP-API surface anchor and the remaining items carry forward to Phase 8 unchanged.
- (Still) HTTP-API contract surface (for api-only repos like `agent-poker-platform`) — originally planned as Phase 5 B5. **Deferred to Phase 6 on 2026-05-15** after target-repo recon found `pnpm dev` hard-wired to in-memory stores (no Postgres) and schema mismatches (`live_rooms` / `created_by` instead of `tables` / `owner_user_id`). Making it work needs upstream PRs to the target repo. Phase 8 either (a) wires `PostgresLiveStore` via env switch and rewrites the named query against `live_rooms`, or (b) picks a different api-only Postgres-wired target.
- Dashboard §15.3–§15.6
- Persona dogfood agents
- Property/model-based test generation
- TypeScript project references (`tsc -b`) — Phase 3 D1 reorder is the cheap mitigation; project references is the real fix
- pnpm-version-aware spawn helper (still documented, not coded)
- Publishing to npm — Phase 3 prepares the surface; `pnpm publish` is user-gated
- Mongo / Firestore / custom `BackendAdapter` implementations (Phase 4 only shipped Postgres; design doc §7.6.3 declares 4 kinds)
- `custom-cookie` detector heuristic (bcrypt + cookies co-occurrence)
- File-content parsing for auth detection (currently path-presence only — false negatives possible)
- Dynamic `$session.userId` resolution

## Phase 5 resolution status (v0.5.0)

Findings / final-review follow-ups RESOLVED in Phase 5 (QA pass):
- README Phase 3 + Phase 4 + Phase 5 status sections (was: stale "Out of Phase 2" deferred list).
- `detectFrameworkInRepo` walks scoped packages (`apps/@org/pkg`); skips symlinked subdirs via `lstat` guard.
- `contractqa doctor` UX hint when `npm run install` reports "Missing script: install" (covers npm 10's quoted form `Missing script: "install"`); multi-version pnpm dedup test covers `findPnpmPkgDir` determinism.
- `PostgresBackendAdapter` writable-CTE coverage tests added (nested CTE with `DELETE`, `WITH RECURSIVE` with `UPDATE`) — confirmed existing forbidden-DML regex catches both; no impl change needed.
- Bounded `extractAbiHint` regression test asserts <100ms termination on adversarial 100k-char stderr.

Phase 5 has no new anchor (Part A B5 deferred — see above). Phase 6 candidates are the same as v0.4.0's "Still deferred" list minus the items closed here.

## Phase 6 resolution status (v0.6.0)

Findings RESOLVED in Phase 6:
- **Hybrid-auth scanner**: `contractqa scan --detect-auth` inspects file paths (NextAuth route, Supabase SSR helpers, Clerk middleware, etc.) and emits a structured `## Hybrid auth` markdown section with per-provider evidence, a heuristic-picked session owner, and a paste-ready `composeAuth` config snippet using identifier placeholders. Path-presence only (no file-content parsing); false negatives acceptable, scanner is advisory.

5 minor follow-ups from Phase 5 final review RESOLVED:
- `findPnpmPkgDir` comment-vs-behavior drift (comment now matches lexicographic sort; semver-aware selection deferred to Phase 7)
- `host-probe-bounded` 100ms → 250ms threshold (CI flake headroom)
- `detectFrameworkInRepo` records `skipped N symlinked subdir(s); pass --target to inspect them explicitly` diagnostic in evidence
- `FORBIDDEN_DML_DDL` regex documents false-positive risk in JSDoc
- `scripts/phase6-acceptance.sh` parameterizes TARGET via `PHASE_TARGET` env var (forward-only; phase5-acceptance.sh not retro-touched)

## Phase 7 resolution status (v0.7.0)

Maintenance release. Anchor-less by design.

Findings RESOLVED in Phase 7:
- **`apps/dashboard` build was failing on dangling `.js`-suffixed imports.** Next.js webpack resolver can't find `.tsx` sources when imports use the TypeScript ESM `.js` extension convention. Dropped `.js` suffixes from 7 internal dashboard imports (`app/issues/[id]/page.tsx`, `app/runs/page.tsx`, `lib/db.ts`).

4 Phase 6 final-review follow-ups RESOLVED:
- NextAuth v5 App Router route-group support: `inspect-auth.ts` recognizes `app/(scope)/api/auth/[...nextauth]/route.ts`.
- `custom-cookie` AuthSignal JSDoc: documents the missing detector and points to a Phase 8 heuristic candidate.
- Semver-aware `findPnpmPkgDir`: added `semver` dep; sorts descending by parsed version; lex fallback when parse fails.
- `renderHybridSection` extracted from `scanProject` into a private helper (file-size budget).

Findings STILL DEFERRED to Phase 8:
- HTTP-API contract surface (B5) — still no Postgres-wired target identified.
- Mongo / Firestore BackendAdapter.
- `custom-cookie` detector (bcrypt + cookies heuristic).
- Persona dogfood agents, property/model-based test generation, dashboard §15.3–§15.6.
- pnpm-version-aware spawn helper.
- File-content parsing for auth detection.
- Dynamic `$session.userId` resolution.
- Publishing to npm (still user-gated).

## Phase 8 resolution status (v0.8.0)

Findings RESOLVED in Phase 8:
- **Mongo BackendAdapter** (was: deferred from Phase 4+). `MongoBackendAdapter` ships with construction-time read-only guards (named-queries-only, find/aggregate only, mandatory tenant field, forbidden-operator deep-walk: $where, $function, $accumulator, $out, $merge, $listLocalSessions). Unit tests via mocked client only — real-Mongo integration is Phase 9.
- **`custom-cookie` AuthSignal detector** (was: Phase 7 documented as missing). Deps-only heuristic: `bcryptjs` or `bcrypt` presence triggers the signal. Advisory; false positives accepted.
- **Dashboard Next 15 `params: Promise` migration** (was: Phase 7 surfaced as a Next 15 typecheck error). `app/issues/[id]/page.tsx` now awaits `params` before destructuring.

Findings STILL DEFERRED to Phase 10:
- HTTP-API contract surface (B5) — still no Postgres-wired target identified.
- Firestore BackendAdapter.
- Persona dogfood agents, property/model-based test generation, dashboard §15.3–§15.6.
- pnpm-version-aware spawn helper.
- File-content parsing for auth detection.
- Dynamic `$session.userId` resolution.
- Publishing to npm (still user-gated).

## Phase 9 resolution status (v0.9.0)

Findings RESOLVED in Phase 9:
- **Tenant-placeholder body reference check** (was: Phase 8 opus reviewer's #1 Minor — family-wide gap). Both `PostgresBackendAdapter` and `MongoBackendAdapter` now reject at construction if `params[tenantField]` is declared but the placeholder is not referenced in the query body (SQL / filter / pipeline). Closes the "guard passes silently while tenant scope is bypassable" hole.
- **Real-Mongo integration test** (was: Phase 8 deferred). `tests/mongo-integration.test.ts` spins up `mongodb-memory-server`, seeds two docs, runs a `find` named query, asserts tenant scoping works end-to-end. Skips on `MONGOMS_SKIP=1` for CI without binary download.
- **MongoBackendAdapter getDb concurrent-init race** (was: Phase 8 opus reviewer's #3 Minor). `getDb()` now memoizes a single connecting promise so two simultaneous `query()` calls share one `MongoClient` instance.
- **`apps/dashboard/next-env.d.ts` gitignored** (was: Phase 8 opus reviewer's #5 Minor). Next.js regenerates this file on every build; no longer surfaces as working-tree noise.

Findings STILL DEFERRED to Phase 10:
- Mongo named-placeholder substitution (`:user_id` instead of `$1`) — removes declaration-order coupling. Phase 8 opus reviewer's #2.
- File-content `cookies()` verification for `custom-cookie`.

## Phase 10 resolution status (v0.10.0)

Findings RESOLVED in Phase 10:
- **Mongo named-placeholder syntax** (was: Phase 8 opus reviewer's #2). `MongoBackendAdapter` now recognizes `:name` placeholders that resolve by name from `params` — alongside the existing `$N` positional substitution. Both styles can coexist within a single named query. Removes the declaration-order coupling that's been load-bearing since Phase 8.
- **MongoBackendAdapter getDb reject-recovery** (was: Phase 9 opus reviewer's #1). `connectingP` is now cleared on rejection, so the next `query()` call retries rather than permanently re-throwing the same error.
- **MongoBackendAdapter close-during-connect** (was: Phase 9 opus reviewer's #2). `close()` now awaits any in-flight `connect()` promise before closing — no orphan client leaks. A `closed` flag fail-fasts any post-close `query()`.
- **`custom-cookie` AuthSignal graduates from heuristic** (was: Phase 8 deferred). The detector now requires BOTH deps presence (`bcryptjs`/`bcrypt`) AND at least one auth-file (`middleware.ts` or `app/api/<route>/route.ts`) — path-presence only, file-content parsing remains Phase 11+ candidate.

Findings STILL DEFERRED to Phase 13 (carried from Phase 10):
- Real-Firestore emulator integration test. (Resolved in Phase 12 → Phase 13)
- File-content `cookies()` body parsing for `custom-cookie`.
- `MongoClient.db()` orphan-leak path (low probability). (Resolved in Phase 12)

## Phase 11 resolution status (v0.11.0)

Findings RESOLVED in Phase 11:
- **FirestoreBackendAdapter** (was: deferred from Phase 4+). Completes the `BackendAdapter` family (Postgres + Mongo + Firestore). Read-only via `@google-cloud/firestore`; named queries with `where: [field, op, value]` triples; tenant scoping enforced at construction (tenant field must appear in `where` with `==` op); operator allowlist. Supports `$N` and `:name` placeholder styles (parity with Mongo). Unit tests via mocked client; real-Firestore emulator integration → Phase 12.
- **Mongo close() drains in-flight queries** (was: Phase 10 opus reviewer #1). Tracks `inFlight` count; `close()` waits up to 5s for active queries to finish before terminating client. Prevents Phase 10's documented race where `close()` could tear down a client mid-query.
- **Mongo JSDoc polish** (was: Phase 10 opus reviewer #2 + #3). `MongoNamedQuery.params` documents both `$N` and `:name` placeholder styles; `close()` documents the close lifecycle (closed flag → drain connectingP → drain inFlight → terminate).
- **custom-cookie pages-router variant** (was: Phase 10 opus reviewer #4). Detector now recognizes `pages/api/<route>.<ext>` alongside `app/api/<route>/route.ts` for older Next.js layouts.

## Phase 12 resolution status (v0.12.0)

Findings RESOLVED in Phase 12:
- **B5 HTTP action support (runner + schema)** (was: deferred from Phase 5 — 7 phases ago). `action.type: 'http'` added to contract schema (GET/POST/PUT/PATCH/DELETE with body, headers). `runHttpContract` sibling function in the runner — separate from `runContract` (Playwright-bound), with its own input shape `{ contract, backend?, baseUrl }`. Tests via mocked `global.fetch` + mocked `BackendAdapter`. The dogfood target (was Phase 5 A3) remains deferred — still no Postgres-wired api-only target.
- **`@google-cloud/firestore` as optionalDependency** (was: Phase 11 opus reviewer #2). Moves the heavy gRPC/protobufjs install to `optionalDependencies` so Postgres/Mongo-only users don't carry the bulk. Still auto-installs by default; only allowed to fail.
- **Firestore `id`-merge precedence** (was: Phase 11 opus reviewer #1). Flipped to `{ ...doc.data(), id: doc.id }` so the Firestore doc id always wins. Documented in class JSDoc.
- **MongoClient.db() orphan-leak fix** (was: Phase 10 opus reviewer #5 / Phase 11 deferred). If `client.db()` throws after a successful `connect()`, the resolved client is now `close()`'d before clearing `connectingP`. New test asserts the orphan-close.

Findings STILL DEFERRED to Phase 13:
- HTTP dogfood target (still no Postgres-wired candidate).
- Real-Firestore emulator integration test.

## Targets considered but not used

- **teamagent/dogfood-target** — pure static counter, no contracts apply
- **agent-poker-platform** (no suffix) — api-only, no web for browser
  contracts (would require Phase 3's HTTP-API surface)
