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

Findings STILL DEFERRED to Phase 6:
These were originally Phase 5 candidates; after target-repo recon during Phase 5 the HTTP-API surface anchor was pushed to Phase 6, and the remaining items carry forward unchanged.
- HTTP-API contract surface (for api-only repos like `agent-poker-platform`) — originally planned as Phase 5 B5. **Deferred to Phase 6 on 2026-05-15** after target-repo recon found `pnpm dev` hard-wired to in-memory stores (no Postgres) and schema mismatches (`live_rooms` / `created_by` instead of `tables` / `owner_user_id`). Making it work needs upstream PRs to the target repo, which falls outside Phase 5 scope. Phase 6 either (a) wires `PostgresLiveStore` via env switch and rewrites the named query against `live_rooms`, or (b) picks a different api-only Postgres-wired target.
- Hybrid-auth scanner (`contractqa scan --detect-auth` from 5-4-claude finding) — basic detection landed in scan, hybrid multi-provider case still requires manual `composeAuth`
- Dashboard §15.3–§15.6
- Persona dogfood agents
- Property/model-based test generation
- TypeScript project references (`tsc -b`) — Phase 3 D1 reorder is the cheap mitigation; project references is the real fix
- pnpm-version-aware spawn helper (still documented, not coded)
- Publishing to npm — Phase 3 prepares the surface; `pnpm publish` is user-gated
- Mongo / Firestore / custom `BackendAdapter` implementations (Phase 4 only shipped Postgres; design doc §7.6.3 declares 4 kinds)

## Phase 5 resolution status (v0.5.0)

Findings / final-review follow-ups RESOLVED in Phase 5 (QA pass):
- README Phase 3 + Phase 4 + Phase 5 status sections (was: stale "Out of Phase 2" deferred list).
- `detectFrameworkInRepo` walks scoped packages (`apps/@org/pkg`); skips symlinked subdirs via `lstat` guard.
- `contractqa doctor` UX hint when `npm run install` reports "Missing script: install" (covers npm 10's quoted form `Missing script: "install"`); multi-version pnpm dedup test covers `findPnpmPkgDir` determinism.
- `PostgresBackendAdapter` writable-CTE coverage tests added (nested CTE with `DELETE`, `WITH RECURSIVE` with `UPDATE`) — confirmed existing forbidden-DML regex catches both; no impl change needed.
- Bounded `extractAbiHint` regression test asserts <100ms termination on adversarial 100k-char stderr.

Phase 5 has no new anchor (Part A B5 deferred — see above). Phase 6 candidates are the same as v0.4.0's "Still deferred" list minus the items closed here.

## Targets considered but not used

- **teamagent/dogfood-target** — pure static counter, no contracts apply
- **agent-poker-platform** (no suffix) — api-only, no web for browser
  contracts (would require Phase 3's HTTP-API surface)
