# Dogfood findings — cross-target

Per-target details live in each subdir's `FINDINGS.md`. This file collects
findings that appeared across **two or more** targets — those are the
strongest signals for Phase 2.

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

### Reporter doesn't bundle on PASS (both targets)

Phase 1's `ContractQAReporter` early-returns when `result.status !== 'failed'`.
Both dogfoods wanted bundles on PASS (proof of run, drift baseline). We
worked around by calling `writeEvidenceBundle` directly. Phase 2:
`ReporterOptions.alwaysBundle?: boolean`.

### Standalone (non-Playwright-runner) driver pattern emerging (both targets)

Both dogfoods drive contracts via plain vitest + `chromium.launch()` +
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

## Target-specific summary

| Target | Stack | Auth | Result |
|---|---|---|---|
| [5-4-codex](./5-4-codex/FINDINGS.md) | Vite + React + react-router + Fastify | Custom cookie session | PASS + 1 oracle bug fixed |
| [website-vercel-supabase](./website-vercel-supabase/FINDINGS.md) | Next.js 16 + NextAuth v5 + Supabase | NextAuth+Supabase composite | PASS + schema change required |

## What's NOT in dogfood scope yet

Targets we considered but skipped, with why:

- **WolfMind** (Vue 3 + FastAPI, no auth) — no auth means no interesting
  Phase 1 invariants until the schema grows DOM/game-state assertions
- **5-4-claude** (Vite + Supabase + custom-cookie) — likely yields similar
  findings to 5-4-codex; queue when bored
- **teamagent/dogfood-target** — pure static counter, no contracts apply
