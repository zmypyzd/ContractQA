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

Findings DEFERRED to Phase 3:
- `BackendAdapter` for HTTP-API-bypass test setup
- `contractqa init` framework detection (Next.js / Vite / Astro / etc.)
- pnpm-version-aware spawn helper (still documented, not coded)
- `contractqa doctor --fix` one-shot remediation for native deps
- HTTP-API contract surface (for api-only repos like the original `agent-poker-platform`)
- Hybrid-auth scanner (`contractqa scan --detect-auth` from 5-4-claude finding)
- SupabaseAuthAdapter v2 with default `loginAs` impl (Phase 1 throws)
- Real-Supabase / real-NextAuth fixture (vs stub-env)
- Public adapter API
- Dashboard §15.3–§15.6
- Persona dogfood agents
- Property/model-based test generation
- TypeScript project references (`tsc -b`) so consumers resolve `@contractqa/core` from source instead of `dist/*.d.ts` — eliminates the "did you rebuild core?" footgun (surfaced 2026-05-14: `DomShape` / `AuthResponsibility` added but `core` not rebuilt, so `phase2-acceptance.sh` typecheck stage saw stale `.d.ts` and tripped TS2305/TS2339)

## Targets considered but not used

- **teamagent/dogfood-target** — pure static counter, no contracts apply
- **agent-poker-platform** (no suffix) — api-only, no web for browser
  contracts (would require Phase 3's HTTP-API surface)
