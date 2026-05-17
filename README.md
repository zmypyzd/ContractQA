# ContractQA Agent

> Claude-Code-powered Product Invariant QA and Auto-Fix Platform.
> Verifies product contracts (not just screenshots), captures full evidence on
> failure, generates minimal repros, hands them to Claude Code for auto-fix.

## Install

```bash
npm install contractqa @contractqa/adapters
# Browser-flow users also need:
npm install @playwright/test
npx playwright install chromium
```

See [STABILITY.md](./STABILITY.md) for the semver surface and stability policy.

## Autopilot (new in v1.1)

For zero-YAML onboarding, see [docs/AUTOPILOT.md](./docs/AUTOPILOT.md):

```bash
contractqa autopilot
```

## Usage

```ts
// Browser flow (requires @playwright/test)
import { runContract } from '@contractqa/runner';
import { compileContract } from '@contractqa/core';

// HTTP flow (no browser required — must use /http subpath)
import { runHttpContract } from '@contractqa/runner/http';  // @experimental
```

## What this is

The thesis is in `claude_code_qa_agent_design.md`: LLMs are bad at being both
the runtime and the judge of web tests. ContractQA puts a deterministic
oracle in between. You write product invariants (logout clears session, owner
required for delete, protected routes redirect anonymous users). The platform
runs them via Playwright, snapshots the full browser/state surface, classifies
violations against noise, generates a minimal Playwright repro, and hands the
evidence bundle to Claude Code in an isolated worktree to fix.

Phase 1 ships the foundation: contract schema, four auth adapters, oracle,
evidence pipeline, repro generator, Claude Code shadow-fix orchestrator,
Next.js dashboard scaffold, and an end-to-end fixture that proves the loop.

## Phase 1 status (mapped from `claude_code_qa_agent_design.md` §23.1)

- [x] INVARIANTS.md auto-generated from YAML (`pnpm --filter contractqa exec contractqa invariants:gen`)
- [x] Machine-readable contracts + Zod schema + ReDoS-safe regex (`packages/core`)
- [x] AppAdapter + AuthAdapter for **Supabase / Clerk / NextAuth / Auth0** (`packages/adapters`)
- [x] Browser state snapshot + redaction + idle-baseline noise profile (`packages/probes`)
- [x] State diff oracle, 4-state verdict (`PASS|FAIL|FLAKY|INCONCLUSIVE`), confidence score (`packages/oracle`)
- [x] Evidence bundle + manifest + S3/MinIO upload (`packages/evidence`)
- [x] Minimal repro generator + 2/3 stability gate (`packages/repro`)
- [x] Playwright Test runner scaffolding (loader, compiler, reporter, oracle fixture) (`packages/runner`)
- [x] CLI: `init`, `invariants:gen`, `run --changed` (`packages/cli`)
- [x] Claude Code shadow-fix pipeline: worktree isolation + `claude --bare -p` + maxAttempts loop + contract-revision escape valve (`packages/orchestrator`)
- [x] Dashboard: Run Overview + Issue Detail with StateDiffViewer (`apps/dashboard`)
- [x] End-to-end loop on the §24 Logout Bug fixture, **real Playwright + real Next.js fixture-app** (`e2e/phase1-loop.test.ts` — boots `next dev`, drives `compileContract` against `chromium`, exercises `snapshotBrowser` + `ContractQAReporter` on the on-disk bundle)

Out of Phase 1 scope (documented in plan §1c risk register):
- BackendAdapter (L2 — types exist in `core`, no impl yet)
- Persona Dogfood Engine, Property/Model-based testing (Phase 3/4)
- Dashboard §15.3–§15.6 (Invariant Editor, Route Graph, Learning Inbox, Audit)
- OpenClaw integration (permanently optional)
- Adapter API opened to third-party providers (internal until v0.5+ per §7.6.5)

## Phase 2 status (closes gaps surfaced by dogfooding 5 real repos)

- [x] `runContract()` one-shot helper folding the dogfood glue (`packages/runner/src/run-contract.ts`)
- [x] Schema breadth: `target.within`, `target.first`, `goto.locale`, `dom:` block (`contains_text` / `not_contains_text` / `role_count`)
- [x] `snapshotBrowser.captureDom` + origin-less tolerance (works on `about:blank`)
- [x] `ReporterOptions.alwaysBundle` for PASS-path bundling
- [x] `contractqa doctor <target>` preflight (env vars, port allocation, native bindings, host-boot probe)
- [x] `CustomCookieAuthAdapter` for cookie-session apps + `composeAuth` for multi-adapter stacks
- [x] `pnpm pack:host` workflow for installing into host projects
- [x] 5 dogfood targets validated (§23.1 acceptance): `dogfood/{5-4-codex,website-vercel-supabase,wolfmind,5-4-claude,agent-poker-platform-gpt}/`

Out of Phase 6 (Phase 7+): HTTP-API contract surface for api-only repos
(B5 — still deferred; no Postgres-wired target identified yet), Mongo /
Firestore BackendAdapter, persona dogfood agents, property/model-based
generation, dashboard §15.3–§15.6, TypeScript project references via
`tsc -b`, semver-aware `findPnpmPkgDir` (currently lexicographic). See
[`dogfood/FINDINGS.md`](dogfood/FINDINGS.md) for the complete list.

## Phase 3 status (CLI onboarding + real-cloud Supabase + public adapter API)

- [x] `contractqa init` auto-detects framework (no `--provider` flag needed)
- [x] `contractqa scan` writes `qa/SCAN_REPORT.md`
- [x] `contractqa doctor --fix=<list>` remediates native-deps / env-stub / port-collision
- [x] `SupabaseAuthAdapter` v2 with default `loginAs`
- [x] Vendored Supabase fixture (CLI-based as of v0.3.1)
- [x] `@contractqa/adapters/public` semver-stable surface + STABILITY.md + third-party template

## Phase 4 status (doctor hardening + BackendAdapter L2 + monorepo + composeAuth)

- [x] `contractqa doctor --fix=native-deps` walks workspace packages; pnpm 10 rebuild path
- [x] Boot probe → ABI mismatch hint synthesis
- [x] `PostgresBackendAdapter` real impl (read-only DSN, mandatory tenant scope, named queries only)
- [x] `backend_state` block in contract schema; runner `evaluateBackendState`
- [x] Monorepo-aware `init` and `scan` (walks apps/*, packages/*, web, frontend, client, site)
- [x] `composeAuth` per-responsibility routing (currentUser → user-store; expectFullyLoggedOut → all + AND)

## Phase 5 status (final-review QA pass — v0.5.0)

- [x] README Phase 3/4/5 status sections (this section)
- [x] `detectFrameworkInRepo` walks scoped packages (`apps/@org/pkg`); skips symlinked subdirs
- [x] `contractqa doctor` UX hint when package has no install script; multi-version pnpm dedup coverage
- [x] `PostgresBackendAdapter` writable-CTE coverage tests (nested CTE + WITH RECURSIVE + write)
- [x] Bounded sniffer regression test (`extractAbiHint` resists catastrophic backtracking)
- [ ] HTTP-API contract surface (B5) — **deferred to Phase 6** after target-repo recon found no Postgres-wired api-only dogfood candidate

### `doctor --fix=native-deps` (Phase 4)

Walks `package.json`, `apps/*/package.json`, and `packages/*/package.json`
for declarations of the known-native dependencies (`better-sqlite3`,
`sqlite3`, `bcrypt`, `sharp`, `canvas`, `node-gyp`). For each detected dep,
runs `npm run install` inside `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>`
— the only path that triggers `prebuild-install` reliably under pnpm 10.

`pnpm rebuild <pkg>` is silently a no-op for transitive workspace deps in
pnpm 10 and is **not** what this fix runs.

When a boot probe fails with `ERR_DLOPEN_FAILED ... NODE_MODULE_VERSION X
... requires NODE_MODULE_VERSION Y`, the rendered report includes an ABI
mismatch hint pointing directly at this fix command.

Worked example — 5-4-codex on Node 22 (binary built for Node 20):

```bash
contractqa doctor --fix=native-deps /path/to/5-4-codex
# [ok] native-deps: better-sqlite3: rebuilt OK
```

## Phase 6 status (hybrid-auth scanner + QA pass — v0.6.0)

- [x] `contractqa scan --detect-auth` flag with path-presence rules per provider
- [x] `## Hybrid auth` markdown section: per-provider evidence + suggested session owner + `composeAuth` config snippet (identifier placeholders, not empty-array comments)
- [x] `findPnpmPkgDir` comment now matches lexicographic-sort behavior
- [x] `host-probe-bounded` test threshold raised to 250ms for CI headroom
- [x] `detectFrameworkInRepo` records symlink-skipped diagnostic in evidence
- [x] `FORBIDDEN_DML_DDL` regex documents false-positive risk in JSDoc
- [ ] HTTP-API contract surface (B5 of Phase 5 plan) — **still deferred** pending a Postgres-wired api-only target

## Quick start

```bash
# 1. Install
pnpm install

# 2. Run all unit tests + typecheck
pnpm -r --filter './packages/**' typecheck
pnpm -r --filter './packages/**' test

# 3. Build packages (CLI + reporter need dist/)
pnpm -r --filter './packages/**' build

# 4. Generate INVARIANTS.md from YAML contracts
node packages/cli/dist/bin/contractqa.js invariants:gen \
  --contracts qa/contracts --out qa/INVARIANTS.md

# 5. End-to-end Phase 1 loop test (boots fixture-app, real Chromium via Playwright;
#    the first run downloads Chromium via the e2e package's pretest hook).
pnpm --filter @contractqa/e2e test

# 6. (Optional) Boot dashboard + Postgres + MinIO
docker compose -f docker/docker-compose.yml up -d
pnpm --filter @contractqa/dashboard dev   # http://localhost:3000

# 7. (Optional) Boot fixture app to drive a Playwright-backed run
pnpm --filter @contractqa/fixture-app dev # http://localhost:4000

# 8. Or run the full acceptance script (Phase 1)
./scripts/phase1-acceptance.sh

# 9. Phase 2 acceptance (typecheck + tests + Phase 1 e2e + 5 dogfood targets + pack:host + doctor)
./scripts/phase2-acceptance.sh

# 10. (Optional) Install ContractQA into a host project
pnpm pack:host             # produces tarballs in dist-host/
# then in the host repo:
# npm i ./path/to/dist-host/contractqa-runner-0.1.0.tgz @playwright/test
```

## Repo layout

```
packages/
  core/          @contractqa/core         types, Zod schemas
  adapters/      @contractqa/adapters     AppAdapter + Supabase/Clerk/NextAuth/Auth0
  probes/        @contractqa/probes       browser snapshot + redaction + noise profile
  oracle/        @contractqa/oracle       state diff, classifier, 4-state verdict
  evidence/      @contractqa/evidence     bundle layout + S3 upload
  runner/        @contractqa/runner       Playwright loader/compiler/reporter/oracle hook
  repro/         @contractqa/repro        minimal repro generator + 2/3 stability gate
  orchestrator/  @contractqa/orchestrator worktree + claude-code wrapper + shadow pipeline
  cli/           contractqa               CLI entrypoint
apps/
  dashboard/     Next.js 15 dashboard (Run Overview + Issue Detail)
  fixture-app/   Next.js fixture reproducing the §24 Logout Bug
qa/
  INVARIANTS.md  generated from yml
  contracts/     YAML invariants
  noise-profile.yml
e2e/             end-to-end loop test
docker/          postgres + minio for local dev
docs/superpowers/plans/
  2026-05-14-contractqa-phase-1.md   the implementation plan
```

## Architecture cheat-sheet

The §17.0 dual pipeline is the core operational decision:

```
PR
 ├─→ Critical Path Gate (≤ 5min, BLOCKING)
 │   ├─ diff-targeted contracts via Playwright Test workers
 │   ├─ on PASS → merge
 │   └─ on FAIL → emit evidence bundle, do NOT block waiting for fix
 │
 └─→ Shadow Fix Pipeline (async, non-blocking)
     ├─ git worktree per issueId (contractqa-fix/<id>)
     ├─ Claude Code --bare -p <fix-prompt> --allowedTools Read,Edit,Bash,Grep,Glob
     ├─ maxFixAttempts: 3
     │   ├─ proposed_contract_revision → escape valve (§13.1.1, needs human review)
     │   └─ validation_result PASS → open fix-PR
     └─ on EXHAUSTED → comment root-cause on original PR
```

## Notes

- Dashboard `dev`/`build` requires Postgres on `:5432` (use `docker compose up -d`).
  Without it, dashboard pages will error at runtime. The Phase 1 e2e doesn't
  depend on the dashboard runtime — it asserts the artifact bundle on disk
  directly.
- The fixture app reproduces the bug pattern (logout doesn't clear `sb-*` key,
  protected route still renders) without depending on a real Supabase project.
  Real Supabase integration is wired through `qa/adapters/<project>.adapter.ts`
  per host project.

## Where to read more

- Full design: [`claude_code_qa_agent_design.md`](claude_code_qa_agent_design.md)
- Phase 1 plan with task-by-task TDD breakdown: [`docs/superpowers/plans/2026-05-14-contractqa-phase-1.md`](docs/superpowers/plans/2026-05-14-contractqa-phase-1.md)
