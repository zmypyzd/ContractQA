# ContractQA Agent

> Claude-Code-powered Product Invariant QA and Auto-Fix Platform.
> Verifies product contracts (not just screenshots), captures full evidence on
> failure, generates minimal repros, hands them to Claude Code for auto-fix.

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
- [x] End-to-end loop on the §24 Logout Bug fixture (`e2e/phase1-loop.test.ts`)

Out of Phase 1 scope (documented in plan §1c risk register):
- BackendAdapter (L2 — types exist in `core`, no impl yet)
- Persona Dogfood Engine, Property/Model-based testing (Phase 3/4)
- Dashboard §15.3–§15.6 (Invariant Editor, Route Graph, Learning Inbox, Audit)
- OpenClaw integration (permanently optional)
- Adapter API opened to third-party providers (internal until v0.5+ per §7.6.5)

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

# 5. End-to-end Phase 1 loop test
pnpm --filter @contractqa/e2e test

# 6. (Optional) Boot dashboard + Postgres + MinIO
docker compose -f docker/docker-compose.yml up -d
pnpm --filter @contractqa/dashboard dev   # http://localhost:3000

# 7. (Optional) Boot fixture app to drive a Playwright-backed run
pnpm --filter @contractqa/fixture-app dev # http://localhost:4000

# 8. Or run the full acceptance script
./scripts/phase1-acceptance.sh
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
