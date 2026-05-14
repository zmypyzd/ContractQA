# Dogfood findings — 5-4-claude

Fourth dogfood target. Stack: Vite + React + react-router-dom + 
`@supabase/supabase-js`. Without real Supabase credentials we drive a 
render-only contract.

Outcome: **PASS** on INV-S1 (`/login` renders, no `sb-*-auth-token-error` 
key leaked).

## New findings

### 1. Hybrid Supabase + custom-cookie auth coexists in one app

5-4-claude's repo has BOTH `apps/web/src/auth/AuthContext.tsx` (legacy
custom-cookie auth identical to 5-4-codex's pattern) AND
`apps/web/src/lib/auth.ts` (newer `supabase.auth.signInWith*` API). This
is mid-migration code that real production codebases exhibit constantly.

Phase 2's `composeAuth` already handles this conceptually: pass both
`CustomCookieAuthAdapter` and `SupabaseAuthAdapter` with different
responsibilities. But the test author has to know which adapter is the
session-of-record. Phase 3 task: a `contractqa scan --detect-auth` that
finds these competing patterns in the host repo and recommends a
composition.

### 2. Vite dev-server proxies leak loud noise during dogfood

Vite proxies `/api` → `API_TARGET`. With no API on the other side, every
fetch from supabase-js + the React app's own /auth/me + various app
endpoints prints `[vite] http proxy error: /api/...` to stderr. Doesn't
fail the test, but dirties the dogfood output. Phase 2's `host-probe.ts`
already filters its own noise; the dogfood test harness should pipe the
host's stderr through a similar filter.

## Reused findings (already in `../FINDINGS.md`)

- vite `--host 127.0.0.1` quirk (same as 5-4-codex)
- pre-navigate before snapshotBrowser (now mitigated by T5's
  origin-less tolerance, but still good practice)
- pnpm exec vite instead of run dev -- (cross-pnpm-version arg forwarding)

## What this proves about Phase 1 / Phase 2

- `supabase-js` is genuinely framework-agnostic — module init succeeds on
  Vite with stub env, no Next.js-specific hooks needed
- Phase 1's `SupabaseAuthAdapter` is invocable here in principle but
  doesn't have a `loginAs` impl that drives `supabase.auth.signInWithPassword`
  (the Phase 1 adapter throws `loginAs must be overridden per project`).
  Phase 3 should ship a SupabaseAuthAdapter v2 with the default impl.
- `runContract()` (Phase 2 T1) drove this stack with zero changes.
