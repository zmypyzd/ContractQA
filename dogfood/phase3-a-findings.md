# Phase 3 Part A — dogfood findings

Date: 2026-05-14
CLI under test: 79281356518bfd046e04d196ef7b32f9feec388b

| Target | Framework detected | Auth signals | Init files | Scan routes | Doctor result | Verdict |
|---|---|---|---|---|---|---|
| 5-4-codex | unknown (0.00) | none | 6 | 1 | all [ok] | 🟡 MINOR |
| website_vercel-supabase-main | unknown (0.00) | next-auth, supabase | 6 | 1 | all [ok] | 🟡 MINOR |
| WolfMind-main | unknown (0.00) | none | 6 | 1 | all [ok] (env-stub skipped, .env.local exists) | 🟡 MINOR |
| 5-4-claude | unknown (0.00) | none | 6 | 1 | all [ok] | 🟡 MINOR |
| agent-poker-platform-gpt | unknown (0.00) | none | 6 | 1 | all [ok], .env.local written (16 lines) | ✅ PASS |

## Per-target notes

### 5-4-codex

Project type: pnpm monorepo (`agent-poker-platform`, pnpm workspace with `apps/` and `packages/` dirs).
Framework detector returned `unknown` — expected for a monorepo root with no single framework entry point.
init wrote 6 files without error. scan produced SCAN_REPORT.md with 1 route (`/`). doctor completed all three
fix checks with `[ok]`. No env-stub needed (no .env.example). No [FAIL] lines.
Verdict: 🟡 MINOR — `unknown` detection is technically correct for a monorepo root but unhelpful;
a future enhancement should walk `apps/*` to detect per-app frameworks.

### website_vercel-supabase-main

Project type: Next.js 16 app with next-auth + @supabase/supabase-js.
Auth signals correctly detected (`next-auth`, `supabase`). Framework detector returned `unknown` despite
`next.config.ts` and `"next": "16.2.2"` in package.json — clear detection miss. Init produced 6 files,
scan produced 1 route, doctor all [ok]. No env-stub (no .env.example present).
Verdict: 🟡 MINOR — Next.js misdetected as `unknown`. Framework fingerprint needs a `next.config.*`
sentinel check or dependency-name match for `"next"` in package.json.

### WolfMind-main

Project type: Python backend (FastAPI/uvicorn) + JS frontend hybrid; root package.json uses
`concurrently` to run both. Has `pyproject.toml`, `docker-compose.yml`, `Dockerfile`.
`unknown` detection is appropriate for this stack — no JS framework at the monorepo root.
Auth signals: none detected. Init wrote 6 files, scan produced 1 route, doctor all [ok].
env-stub fix skipped because `.env.local` already existed in the source (not written by init).
Doctor correctly enumerated all env vars from `.env.example` (OPENAI_API_KEY, DASHSCOPE_API_KEY, etc.)
in the preflight report. No [FAIL] lines.
Verdict: 🟡 MINOR — `unknown` is expected for hybrid Python/JS stacks, but env-stub skipping because
`.env.local` pre-exists in the source tree means the stub is a no-op in clean test runs. Consider
adding a `--force-env-stub` flag or noting that `.env.local` should be git-ignored.

### 5-4-claude

Project type: pnpm monorepo (same `agent-poker-platform` layout as 5-4-codex; has `supabase/` dir).
`unknown` detection for monorepo root — same issue as 5-4-codex. No auth signals detected despite
Supabase being present (supabase CLI config in `supabase/` dir but no `@supabase/supabase-js` at
root level). Init wrote 6 files, scan 1 route, doctor all [ok], no env-stub needed.
Verdict: 🟡 MINOR — Same monorepo framework detection gap. Supabase presence via `supabase/` dir
not recognized as an auth signal (only package.json deps are checked).

### agent-poker-platform-gpt

Project type: pnpm monorepo with `.env.example` at root containing Supabase keys.
`unknown` detection for monorepo root — consistent with other monorepo targets.
No auth signals detected from package.json (same as 5-4-claude, supabase only in packages/).
Init wrote 6 files, scan produced 1 route. Doctor performed the most useful action:
env-stub wrote `.env.local` from `.env.example` (16 lines, including SUPABASE_URL, SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, S3/bucket vars, SENTRY_DSN).
All fixes [ok]. No [FAIL] lines.
Verdict: ✅ PASS — env-stub working correctly end-to-end when .env.example is present.

## Phase 3 Part A acceptance verdict

OVERALL: PASS

- 1 target PASS  (agent-poker-platform-gpt)
- 4 targets MINOR (5-4-codex, website_vercel-supabase-main, WolfMind-main, 5-4-claude)
- 0 targets FAIL

No crashes, no unhandled exceptions, no [FAIL] doctor lines across all 5 targets.
All commands (init, scan, doctor --fix=all) completed successfully on every target.

### Issues worth fixing inline (if any)

- **Framework detection miss for Next.js**: `website_vercel-supabase-main` has `next.config.ts` and
  `"next"` in dependencies but was detected as `unknown`. The detector should add `next.config.(ts|js|mjs)`
  as a high-confidence sentinel and/or match `"next"` as a key in `package.json.dependencies`.
  This is the highest-priority inline fix — it affects real-world Next.js projects.

### Issues to backlog for Phase 3b (if any)

- **Monorepo app-walking**: All three pnpm workspace monorepos (5-4-codex, 5-4-claude,
  agent-poker-platform-gpt) detected as `unknown` because the detector only inspects the root.
  Phase 3b should add monorepo-aware detection: walk `apps/*/package.json` and report per-app
  framework + suggest running `contractqa` per-app or with a `--app` flag.

- **Auth signal from `supabase/` directory**: The presence of a `supabase/` config directory is a
  strong auth signal that current detection misses. Should be added to the auth-signal fingerprints.

- **env-stub skip when `.env.local` pre-exists**: If the source tree ships a `.env.local`,
  the fix silently skips. For dogfood purposes this is acceptable, but for production use a warning
  should be emitted so engineers know to check whether the existing file has all required vars.

- **Route discovery limited to `/`**: All targets show only 1 route (`/`). The scanner is not
  finding `app/` or `pages/` route files. For Next.js App Router and Pages Router projects this
  needs improvement in Phase 3b.
