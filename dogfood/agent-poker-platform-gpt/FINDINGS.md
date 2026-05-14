# Dogfood findings — agent-poker-platform-gpt

Fifth dogfood target. Same shape as 5-4-codex (Vite + React + custom
`apk_sid` cookie auth + Fastify API + better-sqlite3), but built by a
different LLM author. Picked specifically to surface whether nominally
identical projects produce identical framework footprints.

Outcome: **PASS** on INV-L2 (same shape as INV-L1 — logout reaches
/login, apk_sid cleared).

## Findings

### 1. better-sqlite3 needed rebuilding again — confirms a recurring tax

Same `bindings not found` / `ERR_DLOPEN_FAILED` failure mode as
dogfood/5-4-codex. Each new project on a new machine pays this tax once.
The Phase 2 doctor (`packages/cli/src/lib/native-deps.ts`) already
surfaces *.node files as candidates; what's still missing is a one-shot
remediation command. Phase 3 task: `contractqa doctor --fix` that runs
`npm --prefix <path> rebuild` for every flagged binding.

### 2. Zero divergence between this and 5-4-codex

INV-L2 is byte-identical to INV-L1 except for the id and project
name. The contract, noise profile, test sequence, and final verdict
are the same. The two implementations (built by different LLMs) are
functionally indistinguishable from ContractQA's vantage point.

That's a strong **null finding**: ContractQA's view of "the app's
contract surface" is independent of implementation idiosyncrasies. A
single contract YAML can reach across cohorts of nominally identical
forks without modification.

### 3. The original `agent-poker-platform` (no `-gpt` suffix) is API-only

Looking for the canonical "original" variant first, we found
`/Users/zmy/intership/4/agent-poker-platform/` has no `apps/web` —
api-only. No web means no browser-driveable contract. Phase 3 should
extend ContractQA's surface to HTTP-API contracts (request/response
invariants, not just browser/DOM state). The schema today is
implicitly browser-shaped.

## Reused findings (already in `../FINDINGS.md`)

- vite `--host 127.0.0.1` quirk
- native-dep rebuild tax (5-4-codex #4, again)
- pnpm exec vite (cross-pnpm arg forwarding)
