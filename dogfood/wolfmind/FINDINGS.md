# Dogfood findings — WolfMind (Vue 3 + Vite, no auth)

Third dogfood. Target is a **Vue 3 + Vite** SPA with a **Python FastAPI**
backend (intentionally not booted here — game session needs LLM API keys
we don't have). Picked specifically to test Phase 1 against a non-React
frontend + non-auth UX.

Outcome: **PASS** on INV-W1 (anonymous landing page exposes no auth-shaped
tokens). The schema-thin invariant — "the page exists, localStorage is
empty of auth tokens, URL is /" — is the only Phase 1-expressible
guarantee for a no-auth UI.

## Headline finding: nothing new was found

This is **itself the most important finding from this dogfood**. Three
targets in (React+react-router+cookie, Next.js+NextAuth+Supabase, Vue+Vite+no-auth),
and every issue the WolfMind target hits is already in
[`../FINDINGS.md`](../FINDINGS.md) or one of the per-target lists:

- vite needs `--host 127.0.0.1` (5-4-codex finding #6)
- pre-navigate before `snapshotBrowser` to avoid SecurityError on
  about:blank (website-vercel-supabase finding #2)
- the reporter doesn't bundle on PASS — worked around via direct
  `writeEvidenceBundle` (cross-cutting finding)

That means: **Phase 1's core (contract YAML, compileContract,
snapshotBrowser, runOracle, evidence bundle) is genuinely
framework-agnostic.** It runs on React + Vue + (presumably) Svelte/Solid/etc.
without changes. The gaps are all in the host-side glue (CLI scaffold,
auth adapters, preflight, ergonomic helpers) — not in the core.

This is the single most important assertion to make before writing the
Phase 2 plan. The plan can confidently treat the core as a stable
foundation and focus 100% of investment on the gaps.

## Schema thinness on no-auth UIs (NEW)

The only invariant Phase 1's YAML schema can express for a no-auth game
UI is "no auth-shaped tokens leak into storage." That's a thin guarantee.

Game UIs care about things Phase 1 can't say:
- "After clicking 'Start Game', a `game-id` cookie or localStorage key is set"
  — Phase 1 has `has_key_matches` but it's a regex match on diff.added, with
  no way to say "this key was created BY this action" rather than "this key
  exists in the after-state"
- "After clicking 'Stop Game', the game-state-machine is in state `idle`"
  — Phase 1 has no DOM/JS-state assertions
- "Visiting / shows the WolfMind logo + 4 agent cards" — Phase 1 has no
  DOM-text or DOM-count assertions

Phase 2 task: extend the schema with a `dom:` block (already partially
sketched in `packages/core/src/schemas/contract.schema.ts` line ~38) —
`dom.contains_text`, `dom.not_contains_text`, `dom.role_count`, etc.

## Vue rendering works unchanged

`compileContract` drives `getByRole`, `goto`, `waitForTimeout` against
Vue 3's reactive rendering exactly the same as it does against React or
Next.js — these are DOM-level APIs that don't care about the framework.

This is what we hoped but didn't know empirically. Now we do.

## Backend not booted is fine

We ran Vite-only, with `VITE_API_URL=http://127.0.0.1:1` so the WS client
tries to connect to a dead port. The app's WS connection fails (we see
errors in the trace), but the home page render is unaffected. The
test PASSes.

This is a useful pattern: **for navigation/render-shape invariants, you
don't need the host's backend.** Phase 2 should document "headless
frontend mode" as a first-class option.
