# Changelog

All notable changes to ContractQA are documented here.

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

### Known broken in v0.3.0

- **`./scripts/phase3-acceptance.sh --real-cloud` fails.** The vendored Supabase compose at `fixtures/supabase-stack/` boots Postgres + Kong but GoTrue can't run its migrations — the `supabase/postgres` image creates `supabase_admin` as superuser (not `postgres`), the `auth` schema isn't auto-created, and a `postgres` role referenced by upstream migrations is absent. Discovered 2026-05-14 during real-cloud validation. The default (stub-env) acceptance is unaffected. Phase 4 will either rebuild on Supabase's official self-host compose at a pinned commit, or switch to `supabase start`. See `fixtures/supabase-stack/README.md` "STATUS — known broken in v0.3.0".

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
