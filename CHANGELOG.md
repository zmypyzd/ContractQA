# Changelog

All notable changes to ContractQA are documented here.

## v0.11.0 — 2026-05-15 (Phase 11)

Phase 11 completes the `BackendAdapter` family by shipping `FirestoreBackendAdapter` (third member alongside Postgres + Mongo). Plus 3 Phase 10 lifecycle/UX follow-ups.

### Added

- **`FirestoreBackendAdapter`** (`@stable since v0.11.0`). Read-only Firestore adapter via `@google-cloud/firestore`. Construction-time guards: named queries with `where: [field, op, value]` triples, tenant field must appear in `where` with `==` op, supported operators whitelist (==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in), optional `orderBy` / `limit`. Supports both `$N` and `:name` placeholder styles (parity with Mongo). Unit tests via mocked client; real-Firestore emulator integration → Phase 12. New dep: `@google-cloud/firestore ^8.x`. Completes the `BackendAdapter` family (kind union `'postgres' | 'mongo' | 'firestore' | 'custom'` now has 3 of 4 shipped).
- **`custom-cookie` detector recognizes pages-router routes.** Adds `(src/)?pages/api/<route>.<ext>` to the auth-file regex list, alongside `middleware.ts` and `app/api/<route>/route.ts`.

### Changed

- **No breaking changes.**
- `MongoBackendAdapter.close()` now drains in-flight queries (up to 5s timeout) before terminating the client. Prevents the documented race where a `query()` mid-call could run against a client `close()` was tearing down.
- `MongoNamedQuery.params` JSDoc documents both `$N` and `:name` placeholder styles.
- `MongoBackendAdapter.close()` JSDoc documents the close lifecycle.

### Still deferred (Phase 12 candidates)

- Real-Firestore emulator integration test.
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

- File-content `cookies()` body parsing for `custom-cookie`.
- Firestore / custom `BackendAdapter` implementations.
- HTTP-API contract surface (B5) — still no Postgres-wired target.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- pnpm-version-aware spawn helper.
- Dynamic `$session.userId` resolution.
- Mongo bulk-write rejection guard.
- Publishing to npm.

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

## v0.8.0 — 2026-05-15 (Phase 8)

Phase 8 ships `MongoBackendAdapter` (second member of the `BackendAdapter` family) plus a deps-only `custom-cookie` auth detector and the Next 15 dashboard `params` migration.

### Added

- **`MongoBackendAdapter`** (`@stable since v0.8.0`). Read-only Mongo `BackendAdapter` mirroring the `PostgresBackendAdapter` shape from Phase 4. Construction-time guards: named-queries-only; `find` / `aggregate` operations only (no `insertOne`/`updateOne`/`deleteOne`/`replaceOne`); mandatory tenant field in every query's `params`; deep-walk rejection of forbidden operators (`$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$listLocalSessions`). Positional placeholder substitution: `$1`, `$2`, ... map to params in declaration order. New dep: `mongodb ^7.x`. Unit tests via mocked client; integration tests against real Mongo are a Phase 9 candidate.
- **`custom-cookie` AuthSignal detector.** Deps-only heuristic: presence of `bcryptjs` or `bcrypt` triggers the signal. Closes the Phase 7 "no detector yet" JSDoc gap. Advisory only; false positives accepted.

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

## v0.7.0 — 2026-05-15 (Phase 7 — maintenance release)

Anchor-less maintenance release. Unblocks `apps/dashboard` build + closes 4 final-review follow-ups from Phase 6.

### Added

- **NextAuth v5 App Router route-group support.** `inspect-auth.ts` now matches `app/(scope)/api/auth/[...nextauth]/route.ts` — common in NextAuth v5 setups that group auth routes.
- **Semver-aware `findPnpmPkgDir`.** Added `semver` dependency; multi-version `.pnpm` selection sorts descending by parsed version (newest first), with lexicographic fallback when parse fails. Replaces Phase 5's lucky-lexicographic behavior. Closes the comment-vs-behavior gap surfaced by Phase 5's final reviewer.

### Changed

- **No breaking changes.** Public API surface unchanged.
- `apps/dashboard` builds: dropped 7 dangling `.js` suffixes from internal imports (Next.js webpack resolver). Affected files: `app/issues/[id]/page.tsx`, `app/runs/page.tsx`, `lib/db.ts`.
- `AuthSignal['custom-cookie']` annotated with JSDoc explaining the missing detector (Phase 8 candidate).
- `scan.ts` refactored: `renderHybridSection` extracted into a private helper for readability. Output unchanged.

### Still deferred (Phase 8 candidates)

- HTTP-API contract surface (B5).
- Mongo / Firestore / custom `BackendAdapter` implementations.
- `custom-cookie` detector heuristic.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- File-content parsing for auth detection.
- pnpm-version-aware spawn helper.
- Dynamic `$session.userId` resolution.
- Publishing to npm.

## v0.6.0 — 2026-05-15 (Phase 6)

Phase 6 ships the hybrid-auth scanner anchor (`contractqa scan --detect-auth`) plus 5 minor follow-ups from Phase 5's final review. HTTP-API contract surface (B5) remains deferred — see `dogfood/FINDINGS.md`.

### Added

- **`contractqa scan --detect-auth` flag.** Off by default. When set AND ≥1 auth provider detected via deps, runs `inspectAuthWiring()` — a pure path-presence inspector that matches concrete wiring files (`app/api/auth/[...nextauth]/route.ts`, `lib/supabase/*`, `app/sign-in/*`, etc.) and the presence of `middleware.ts`. Surfaces `authDiagnostics: AuthDiagnostic[]` on `ScanReport`.
- **`## Hybrid auth` markdown section** in `scan` report when ≥2 providers detected with `--detect-auth`. Per-provider `### <provider>` block showing wiring files + `Has middleware`; a heuristic-picked `Suggested session owner` (priority order: next-auth > clerk > supabase > auth0 > custom-cookie, but providers with middleware win first; ties broken by priority); a paste-ready `composeAuth([adapter1, adapter2])` snippet using camelCase identifier placeholders (e.g., `nextAuthAdapter`, `supabaseAdapter`).
- **`detectFrameworkInRepo` symlink-skipped diagnostic.** When the walker skips ≥1 symlinked subdir, surfaces `skipped N symlinked subdir(s); pass --target to inspect them explicitly` in the result's `evidence` array. Counter resets per-call. Makes the Phase 5 silent-skip visible to users.

### Changed

- **No breaking changes.** v0.6.0 is additive.
- `findPnpmPkgDir` source comment now matches actual lexicographic-sort behavior (Phase 5 had a stale "lowest-versioned" claim).
- `host-probe-bounded` test threshold raised from 100ms to 250ms for cold-V8 CI headroom.
- `FORBIDDEN_DML_DDL` regex annotated with a JSDoc warning about false positives on DML tokens inside string literals (behavior unchanged; full Postgres parser is Phase 7+).

### Still deferred (Phase 7 candidates)

- HTTP-API contract surface (B5) — still no Postgres-wired api-only target identified.
- Mongo / Firestore / custom `BackendAdapter` implementations.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- Semver-aware `findPnpmPkgDir` (currently lexicographic; correct by accident for 9.x vs 11.x).
- pnpm-version-aware spawn helper.
- File-content parsing for auth detection (currently path-presence only — false negatives possible).
- Dynamic `$session.userId` resolution.
- Publishing to npm — `pnpm publish` is user-gated.

## v0.5.0 — 2026-05-15 (Phase 5)

Phase 5 is a focused QA pass closing 5 of the 7 final-review follow-ups from Phase 4. Phase 5's planned anchor (B5: HTTP-API contract surface) was **deferred to Phase 6** after target-repo recon — the `agent-poker-platform` candidate is hard-wired to in-memory stores and lacks the Postgres schema the planned dogfood would query. See `dogfood/FINDINGS.md` for the recon writeup.

### Added

- **README Phase 3 + Phase 4 + Phase 5 status sections.** Replaces the stale "Out of Phase 2" deferred-list paragraph with a "Out of Phase 5 (Phase 6+)" version that names current deferrals and the B5 deferral rationale.
- **Scoped-package + symlink safety in `detectFrameworkInRepo`.** Walker now descends one extra level when an entry starts with `@` (catches `apps/@org/pkg` layouts) and uses `lstat` + `isDirectory()` guards to skip symlinked workspace entries (e.g., pnpm injection). Cached `lstat` result avoids redundant syscalls.
- **`contractqa doctor` UX hint when no install script is present.** When `npm run install` exits non-zero with `Missing script: install` (or npm 10's quoted form `Missing script: "install"`), the doctor detail now appends `(package has no install script — try \`pnpm rebuild <pkg>\` or \`npm rebuild <pkg>\`)`. Multi-version pnpm dedup test asserts `findPnpmPkgDir` picks the alphabetically-first version deterministically (e.g., `better-sqlite3@11.10.0` over `9.6.0`).
- **`fixNativeDeps` result includes resolved version.** Output lines now read `pkg@<version>: rebuilt OK` / `pkg@<version>: failed — <detail>` (was: `pkg: ...`). Resolved from the `.pnpm/<pkg>@<ver>` directory entry.
- **`PostgresBackendAdapter` writable-CTE regression tests.** Two new cases assert nested writable CTEs (`WITH a AS (..), b AS (DELETE ...)`) and `WITH RECURSIVE ... UPDATE` throw at construction. Existing body-wide forbidden-DML regex from v0.4.0 catches both without modification.
- **Bounded `extractAbiHint` regression test.** Adversarial 100k-char stderr with no closing token returns `null` in <100ms; in-window input still extracts `{ built, runtime }`. Asserts the `[^]{0,512}` bound from v0.4.0 holds.

### Changed

- No breaking changes. v0.5.0 is additive QA hardening.

### Still deferred (Phase 6 candidates)

- **HTTP-API contract surface (B5).** Originally Phase 5's anchor; deferred to Phase 6 after target-repo recon (see header note + `dogfood/FINDINGS.md`).
- Mongo / Firestore / custom `BackendAdapter` implementations.
- Hybrid-auth scanner (`contractqa scan --detect-auth`).
- Dashboard §15.3–§15.6.
- Persona dogfood agents.
- Property/model-based test generation.
- TypeScript project references (`tsc -b`).
- pnpm-version-aware spawn helper.
- Dynamic `$session.userId` resolution (was tied to B5; rolls into Phase 6).
- Publishing to npm — `pnpm publish` is user-gated.

## v0.4.0 — 2026-05-15 (Phase 4)

### Added

- **`contractqa doctor --fix=native-deps` walks workspace packages.** Phase 3's fix only scanned the root `package.json` for the 6 hardcoded native deps; transitive deps living in `packages/persistence/package.json` (or any other workspace package) were silently missed. v0.4.0 walks `apps/*/package.json` and `packages/*/package.json` in addition to root, then for each detected dep runs `npm run install` inside `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>` — the only path that triggers `prebuild-install` reliably under pnpm 10. `pnpm rebuild <pkg>` is silently a no-op for transitive workspace deps.
- **`detectNativeDepMismatch` reads ABI from `.node` binaries.** Phase 3's detector flagged every `.node` as a candidate (`builtAbi: null`). v0.4.0 sniffs the `NODE_MODULE_VERSION` symbol from the binary's first 64 KB and only flags actual mismatches. Bounded read keeps memory steady; sniff is best-effort (returns `null` and falls back to "candidate" suggestion when the symbol isn't found).
- **Boot-probe → ABI hint synthesis.** `probeHostBoot` now accumulates full stderr and runs `extractAbiHint(stderr)` on timeout. When `ERR_DLOPEN_FAILED ... NODE_MODULE_VERSION X ... requires NODE_MODULE_VERSION Y` is detected, `DoctorReport.boot.abiHint = { built, runtime }` is surfaced and `renderDoctorReport` prints `→ run \`contractqa doctor --fix=native-deps <target>\``. Closes the detection→remediation loop.
- **`PostgresBackendAdapter` real implementation** (promoted from `@experimental` stub to `@stable`). Honors design doc §7.6.3 safety rails: read-only DSN guarded at construction (`SELECT` and `WITH ... SELECT` only — rejects `INSERT`/`UPDATE`/`DELETE`/`DROP`/`CREATE`/`TRUNCATE`/`GRANT`); mandatory tenant scope (every `query()` requires the configured tenant field in params); named queries only (no raw SQL from contracts). New deps: `pg ^8.13.0`, `@types/pg ^8.11.0`.
- **`backend_state` block in contract schema.** Contracts can now express backend assertions: `expected.backend_state.named_query`, `params`, and `assert: { rowCount } | { rows }`. The block is `.strict()`-validated — raw `sql` keys are rejected. Backward compatible: contracts without `backend_state` parse unchanged.
- **Runner `evaluateBackendState`.** `runContract` accepts optional `backend?: BackendAdapter`. When the contract has `backend_state` but no backend is provided, the verdict is downgraded to `INCONCLUSIVE` with `missingCapabilities: ['backend_probe']`. When backend is provided, rows are fetched via `backend.query(...)` and asserted against `rowCount` or `rows`. Severity merge: backend `FAIL` overrides; `INCONCLUSIVE` only downgrades a frontend `PASS`.
- **`contractqa init` walks monorepo subdirectories.** New `detectFrameworkInRepo(root)` walks `apps/*`, `packages/*`, `web`, `frontend`, `client`, `site` (apps/packages recursed one level deeper). Returns ranked candidates by confidence. `init` and `scan` both gain `--target <subdir>` flag for explicit selection. With ambiguous tied-confidence candidates and no `--target`, `init` throws `AmbiguousTarget` listing the candidates. Resolves the 5-4-codex / WolfMind / 5-4-claude `unknown`-detection regression.
- **`scan` per-candidate report.** When detection finds multiple candidates, the report includes a `## Other detected candidates` section listing each with confidence.

### Changed

- **`composeAuth` routes per-responsibility (BREAKING for 2+ adapter compositions).** Phase 1–3 routed every method to the `'session'`-owning adapter; only `sessionKeyPatterns` was unioned. v0.4.0:
  - `loginAs` / `isAuthenticated` → owner of `'session'` (unchanged)
  - `currentUser` → owner of `'user-store'`, falling back to `'session'`
  - `expectFullyLoggedOut` → ALL adapters; AND-merges `fullyLoggedOut`, UNIONs `leaked_keys`
  - `sessionKeyPatterns` → UNION across all (unchanged)

  Single-adapter callers are unaffected. The Phase 3 B4 test that documented the old (buggy) behavior has been reverted to assert the new (correct) routing. See `packages/adapters/STABILITY.md` for the full break note.

### Still deferred (Phase 5 candidates)

- HTTP-API contract surface (for api-only repos like the original `agent-poker-platform`) — `PostgresBackendAdapter` is the prerequisite (shipped here); the consumer-side wiring (`action.kind: 'http'` runner support + dogfood test) is Phase 5.
- Mongo / Firestore / custom `BackendAdapter` implementations (design doc §7.6.3 declares 4 kinds; Phase 4 only shipped Postgres).
- Hybrid-auth scanner (`contractqa scan --detect-auth`).
- Dashboard §15.3–§15.6.
- Persona dogfood agents.
- Property/model-based test generation.
- TypeScript project references (`tsc -b`).
- pnpm-version-aware spawn helper.
- Publishing to npm — `pnpm publish` is user-gated.

## v0.3.0 — 2026-05-14 (Phase 3)

### Added

- **`contractqa init` auto-detects framework.** Replaces the Phase 1 manual `--provider` flag. Detects Next.js (app + pages, including `src/app/` and `src/pages/`), Vite (React + Vue), Astro, with `unknown` fallback. Six per-framework scaffolds. Flags: `--yes`, `--force`, `--framework <name>`. Refuses overwrite without `--force`.
- **`contractqa scan` command.** Read-only. Walks the project tree, calls the framework detector, derives routes (for Next.js: `app/page.tsx`, `src/app/page.tsx`, and pages-router variants), writes `qa/SCAN_REPORT.md` listing detected framework, auth signals, routes, and suggested contracts.
- **`contractqa doctor --fix=<list>`.** Phase 2's read-only preflight now remediates. Three fixers:
  - `native-deps` — spawns `npm rebuild` for any of `better-sqlite3`, `sqlite3`, `node-gyp`, `bcrypt`, `sharp`, `canvas` present in the target's `package.json`.
  - `env-stub` — copies `.env.example` → `.env.local` when missing, no-op when either condition unmet.
  - `port-collision` — re-allocates colliding ports via the Phase 2 `allocatePort` helper.
  - `--fix=all` runs every fixer.
- **`SupabaseAuthAdapter` v2.** Phase 1 threw on `loginAs`; v2 ships a real default that hits `<url>/auth/v1/token?grant_type=password` via an injectable `tokenIssuer`. `roleFixtures` defaults to `admin@example.test` / `user@example.test`. `responsibilities: ['session']` declared for Phase 2 `composeAuth`. `currentUser` reads back `sb-<projectRef>-auth-token` from localStorage.
- **Vendored docker-compose Supabase stack** at `fixtures/supabase-stack/`. Pinned tags: `supabase/postgres:15.6.1.146`, `supabase/gotrue:v2.171.0`, `postgrest/postgrest:v12.2.0`, `kong:2.8.1`. Exposes Kong gateway on `localhost:54321`, Postgres on `localhost:54322`. Harness scripts: `up.sh`, `seed.sh`, `down.sh`, `wait-for-health.sh`. Development-only `.env.example` ships safe local credentials.
- **`@contractqa/adapters/public`** semver-stable entry point. Re-exports the five runtime adapters (`NextAuthAdapter`, `SupabaseAuthAdapter`, `CustomCookieAuthAdapter`, `composeAuth`, `PostgresBackendAdapter`) and the core type contracts (`AuthAdapter`, `AppAdapter`, `BackendAdapter`, `AuthStateAssertion`, `SessionKeyPatterns`, `AuthResponsibility`, `SeedProfile`, `SchemaDescriptor`).
- **`packages/adapters/STABILITY.md`.** Semver policy for the `/public` surface. `@stable` follows semver; `@experimental` (`PostgresBackendAdapter` today) may break in minor. One-minor-cycle deprecation window before major removal.
- **Third-party adapter starter template** at `packages/adapters/templates/third-party/`. Pinned to `@contractqa/adapters@^0.3.0`. Companion guide at `docs/adapters/writing-your-own.md`.
- **Out-of-tree adapter smoke test** at `scripts/test-third-party-adapter.sh`. Packs `@contractqa/adapters` and `@contractqa/core` tarballs, copies the starter template to `/tmp`, swaps deps to `file:` installs, runs `npm install + npm run build`, asserts `dist/index.js` exports `ExampleAuthAdapter`. End-to-end proof that the v0.3.0 public surface works for external adapter authors.
- **Opt-in CI real-cloud lane** (`.github/workflows/real-cloud.yml`). Triggers on `workflow_dispatch` or PRs touching `fixtures/supabase-stack/`, `packages/adapters/src/auth/supabase.ts`, or `dogfood/5-4-claude/`. 30-min timeout, guaranteed teardown.
- **`scripts/phase3-acceptance.sh`.** Default mode runs build → typecheck → test → invariants → e2e → 5-target dogfood → pack:host smoke → Part A init/scan smoke → doctor --fix=all smoke → Part C out-of-tree adapter build. `--real-cloud` flag also runs the Supabase docker stack lane.

### Changed

- **`scripts/phase2-acceptance.sh` reorders `build` before `typecheck`.** Downstream packages (oracle, adapters, …) typecheck against `@contractqa/core`'s emitted `dist/*.d.ts`, not source. Stale dist tripped typecheck with `TS2305 'no exported member'` when core source moved. Surfaced on 2026-05-14 during a session resume.
- **Design doc §7.6.5 reversal.** Public adapter API opens in v0.3.0 (was: gated to v0.5+). Mitigations enumerated: `/public` is the only stable surface, `@experimental` escape hatch, `composeAuth`+`AuthResponsibility` composition primitive, 5-target Phase 2 dogfood pressure-test.

### v0.3.1 — 2026-05-15 (post-release fix)

- **`fixtures/supabase-stack/` rebuilt on the Supabase CLI.** The original Phase 3 minimal docker-compose was incomplete — `supabase/postgres` initializes a `supabase_admin` superuser (not `postgres`), the `auth` schema isn't auto-created, and GoTrue's own migrations reference roles that don't exist in a hand-rolled stack. Switched `up.sh` / `down.sh` / `seed.sh` to wrap `supabase start` / `supabase stop` / `curl … /auth/v1/admin/users` against keys from `supabase status -o env`. The 5-4-claude `test-real-cloud.sh` and `.github/workflows/real-cloud.yml` updated to match. New dependency: developers and CI need the Supabase CLI on PATH; the default (stub-env) acceptance lane is unaffected.

### Still deferred (Phase 4 candidates)

- `BackendAdapter` for HTTP-API-only repos (the candidate dropped from Phase 3's anchor vote).
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`) — D1's acceptance-script reorder is the accepted cheap mitigation.
- Real per-responsibility routing in `composeAuth` (currently all calls route to the session owner; `sessionKeyPatterns` is the only unioned method).
- Monorepo / polyglot subdirectory detection in `contractqa init` (currently returns `unknown` for projects whose Vite/Next app lives in `frontend/` or a pnpm workspace package).
- Persona dogfood agents.
- Property/model-based test generation.
- Publishing to npm (`@contractqa/adapters`, `@contractqa/core`, `contractqa`). v0.3.0 prepares the surface; `pnpm publish` is user-gated.

---

## v0.2.0 — 2026-05-14 (Phase 2)

See `dogfood/FINDINGS.md` and `docs/superpowers/plans/2026-05-14-contractqa-phase-2.md` for the full Phase 2 work log. Headlines:

- 5-target real-repo dogfood (5-4-codex, website_vercel-supabase-main, WolfMind-main, 5-4-claude, agent-poker-platform-gpt) — all PASS.
- `runContract()` one-shot helper.
- DOM-shape oracle block (`contains_text`, `not_contains_text`, `role_count`).
- `target.within` ancestor-role scoping.
- `goto.locale` for i18n stability.
- `contractqa doctor` read-only preflight.
- `CustomCookieAuthAdapter` + `composeAuth` + `AuthResponsibility` on `AuthAdapter`.
- `scripts/pack-for-host.sh` produces tarballs for `file:` install in host projects.

## v0.1.0 — Phase 1

Initial release: framework-agnostic contract execution against fixture-app, real Playwright runner, Phase 1 invariants (§24 logout).
