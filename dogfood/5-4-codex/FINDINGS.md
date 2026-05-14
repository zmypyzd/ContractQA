# Dogfood findings — agent-poker-platform (5-4-codex)

First real-repo dogfood of ContractQA Phase 1. The target is a Vite + React +
react-router-dom monorepo with custom HttpOnly-cookie session auth — every
Next.js / Supabase assumption Phase 1 baked in had to be worked around.

Outcome: **PASS verdict on INV-L1** (the target's logout impl is correct).
Pipeline ran end-to-end in ~3.5s once the workarounds were in place.

The whole point of this file is to seed the Phase 2 plan. Each numbered item
is a concrete Phase 2 task.

## Findings

### 1. Cookie classifier had the §24 bug we already fixed for localStorage (FIXED IN THIS PR)

`packages/oracle/src/declared-fields.ts` only inspected `diff.cookies.added`
when evaluating `expected.cookies.no_name_matches`. A cookie present BEFORE
the action AND still present AFTER (the canonical logout-leak shape on a
cookie-auth app) would never appear in `added`, so the violation would
silently PASS.

This is the same delta-only bug the §24 fix patched for localStorage, but
the fix was only applied on one axis. Cookie auth is at least as common as
localStorage auth in the wild, so this is high-severity.

Fix: same shape as the localStorage fix — pass `afterState` into
`classifyDiff` and check `afterState.cookies` against the regex, fall back
to `diff.cookies.added` when no afterState is supplied.

Added two unit tests in `packages/oracle/tests/declared-fields.test.ts`.

### 2. CLI `init` and `scan` are Next.js-only

`contractqa init` writes a Next-flavored qa/ skeleton; `contractqa scan`
enumerates Next.js routes. Neither helps on a Vite/SPA codebase. Today we
hand-wrote `dogfood/5-4-codex/contracts/*.yml` + `noise-profile.yml`.

Phase 2 task: split `init` into framework-agnostic core (writes qa/ tree,
contract template, noise profile template) and framework adapters (Next.js
scan, Vite/React Router scan, file-system route conventions).

### 3. No AuthAdapter for cookie-session apps

Phase 1 ships Supabase / Clerk / NextAuth / Auth0 only. The target's custom
`apk_sid` cookie auth has no first-class adapter. We had to:
- Pre-register a fresh user through the UI each test (slow + noisy)
- Drop the AuthAdapter entirely and rely on `contracts.cookies` assertions

Phase 2 task: `BackendAdapter` (already typed in `core` per the §17.1
notes) so host projects can supply `createTestUser(email, pw) → cookie` and
the runner can pre-seed contexts without UI-driven registration.

### 4. Host-app native deps need rebuilding before the runner can boot it

`better-sqlite3` in the target was built against an older Node. ContractQA's
"boot host dev server" path crashed with a confusing `bindings not found`
error before any contract ran. No preflight, no error surface in the runner
that says "host app failed to start, here's why."

Phase 2 task: a `contractqa doctor` preflight that:
- Boots the host's dev server in detection mode and surfaces the first
  exit + stderr clearly
- Optionally runs `pnpm rebuild` / `npm rebuild` for the host workspace

### 5. `pnpm run dev -- --port N` arg-forwarding varies by pnpm version

Our worktree's pnpm 9 mangles `--port` into a positional vite arg
(`vite "--" "--port" "5287"`); the target's pnpm 10 does not. Phase 1's
README implicitly assumes the pnpm-9 pattern works.

Workaround: invoke `pnpm --filter web exec vite --port N` directly.

Phase 2 task: document this. Better: ship a helper that detects the host's
pnpm and emits the right spawn args. Even better: don't spawn the host's
own dev server — ship a fixture/router that imports the host's vite config
directly.

### 6. Vite 5 binds to `localhost` only by default

`http://localhost:5287/` answers, `http://127.0.0.1:5287/` does NOT, on this
Node/Vite build. ContractQA documents `127.0.0.1` in every example. Need
`--host 127.0.0.1` to bind IPv4.

Phase 2 task: standardize on one host (probably `127.0.0.1` since macOS
+ Linux differ on localhost → ::1 vs 127.0.0.1) and force the bind.

### 7. Reporter early-returns on PASS — no bundle on success

`ContractQAReporter.onTestEnd` does
`if (result.status !== 'failed' && result.status !== 'timedOut') return;`
so a PASS run produces zero artifacts. For dogfooding, we want the bundle
even on PASS (proof of run, screenshot diff against future runs, drift
detection). We worked around by calling `writeEvidenceBundle` directly.

Phase 2 task: `ReporterOptions.alwaysBundle?: boolean` (default false, on
for dogfood/baseline mode).

### 8. No host-project install path for the unpublished workspace packages

`@contractqa/*` are workspace-only. To dogfood properly the host project
should `pnpm add @contractqa/cli @contractqa/adapters` etc, but neither is
published. We sidestepped by running the loop from a `dogfood/` workspace
inside qa-agent that spawns the target as a subprocess.

Phase 2 task: pick one of —
- Publish under `@contractqa/*` to a private npm registry
- `pnpm pack` tarballs as part of release; host installs from file:
- Permanent "sidecar" pattern (qa-agent runs against host repo on disk)

The sidecar pattern is what we used here. It works but requires the host's
node_modules + native deps to be set up at runtime.

### 9. Driving contracts standalone (non-Playwright-runner) requires shim

The full Playwright Test runtime is heavyweight. For dogfood we used plain
`vitest` + `chromium.launch()` + manual `compileContract`. Worked, but
required wiring `runOracle`'s attach callback to a hand-rolled
`writeEvidenceBundle` call.

Phase 2 task: a `runContract(contract, page, options) → { verdict, bundle }`
one-shot helper that does the snapshot/oracle/attach/bundle dance in one
call. Today `compileContract` returns the state slices and the caller has
to glue everything else together.

### 10. INVARIANTS.md `severity: P0/P1/P2` vs `dogfood`

`severity` accepts an enum; `owner` is free-form. We set `owner: dogfood`
in the contract. Fine, but worth documenting that `owner` is per-project
free text and not a known role.

## Inventory of what worked unchanged

For posterity, here's what Phase 1 got right on a non-Next.js stack:

- `packages/core` contract YAML schema — every field mapped cleanly
- `packages/runner` `loadContractsFromDir` + `compileContract` — drove real
  Playwright via `getByRole(name_regex)` + `goto` + `waitForTimeout` on a
  React Router app with zero changes
- `packages/probes` `snapshotBrowser` — captured DOM/cookies/localStorage
  correctly through a Playwright page (cast through the structural type)
- `packages/oracle` `runOracle` — accepted manually-constructed StateSlices
  and produced correct verdicts (after the §1 fix)
- `packages/evidence` `writeEvidenceBundle` — host-agnostic; framework
  doesn't care about Next.js anywhere in the pipeline

The core idea (declarative invariants + deterministic oracle + evidence
bundle) holds up on a stack the framework wasn't designed for. The gaps are
in glue, scaffolding, and host-side adapters — not in the core contract.
