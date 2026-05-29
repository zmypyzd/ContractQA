# Session Handoff

**Saved:** 2026-05-29T03:35:25Z (UTC) / 2026-05-29 11:35 CST
**Branch:** main (pushed to origin/main, 0 ahead 0 behind)
**Head:** 0ce9b11 — docs(eval): tuning log Entry 12 — Haiku docker //=3 sets new high-water on every metric

## Current task

ContractQA WebTestBench tuning — pursue the Entry 12 "Next" list now that Haiku + docker-parallel-3 + Reflexion has set a new high-water (61.2% mean coverage, 47.7% bug detection, 10/10 OK, 38 min wallclock — beats Entry 0 Opus baseline by every metric).

## Next concrete step

Add a `--no-reflexion` CLI flag to `packages/cli/src/autopilot/index.ts` (or wherever autopilot CLI args are parsed) that threads through to `discoverByInteraction({ enableReflexion: false })` in `packages/cli/src/autopilot/interaction-discovery.ts`. This unlocks paired Reflexion-on / Reflexion-off batches for clean delta measurement (Entry 13 candidate). The integration test already passes `enableReflexion: false` so the orchestrator hook exists.

## Status of play (this session)

- [x] Diagnosed Entry 4-6 SDK 403 as Anthropic-OAuth policy on `cwd`/`systemPrompt`/`disallowedTools` options (option-bisect in Entry 7)
- [x] Retracted Entry 7 tail's "OAuth pool quota" framing as unsupported
- [x] Flipped `ClaudeAgentSDKClient` harness default to OFF (commit `932f974`) — restored Entry 3-equivalent code path
- [x] Added `CONTRACTQA_FORCE_SDK_CLIENT` + `CONTRACTQA_ENABLE_SDK_HARNESS` env switches (`3fa2413`) for arm-B/C experiments
- [x] Built `docker-batch.mjs` + `Dockerfile.webtestbench` (`5d29dce` + `d506360`) — per-app isolated containers, random host ports, p-limit concurrency
- [x] Ran 3-arm A/B on MiniMax (Entry 10) — proved harness 403 is Anthropic-OAuth policy not SDK code, and SDK agentic search adds +22 contracts vs direct HTTP
- [x] Ran docker batch 1-10 on MiniMax (Entry 11) — 6/10 OK, first non-zero content-class output ever (app 0001 `contracts/content/` has 2 cross-view consistency contracts)
- [x] Fixed scorer to drop `CONTRACTQA_FORCE_SDK_CLIENT` so it routes to direct HTTP (`33b0455`) — solves 0007-0010 scorer failures
- [x] Ran docker batch 1-10 on Haiku via OAuth (Entry 12) — 10/10 OK, 61.2% coverage, 47.7% bug detection — NEW HIGH-WATER on every metric
- [x] Pushed 37 commits to `origin/main` (`2bfeb14..0ce9b11`)

## WIP / uncommitted

Working tree clean — no uncommitted edits. All this session's code + docs already committed and pushed. Two scratch-dir snapshots preserved for follow-up:
- `qa-eval-fixtures/WebTestBench/snapshots/batch-2026-05-28-docker-minimax/` (Entry 11 MiniMax data)
- `qa-eval-fixtures/WebTestBench/snapshots/batch-2026-05-29-docker/` (Entry 12 Haiku data — the new baseline)

## Decisions made

- **Harness default flipped to OFF, not removed entirely** — kept the harness available via `CONTRACTQA_ENABLE_SDK_HARNESS=1` for Sonnet users who need 240s-loop protection. Default off because Entry 10 proved harness actively hurts quality on the non-Sonnet path (Arm C 5 contracts vs Arm B 46).
- **Docker wraps the fixture from outside, no fixture changes** — `runner/launch.sh` etc. untouched. Fixture stays frozen per the user's design pattern. `docker-batch.mjs` is a parallel alternative to `batch-webtestbench.mjs`, both coexist.
- **Inline `pLimit` instead of importing `p-limit` from node_modules** — `scripts/eval/` isn't a pnpm workspace package, so `require('p-limit')` fails. 15-line inline limiter has identical semantics, zero deps.
- **Concurrency=3 is right-sized for both MiniMax + Haiku OAuth** — higher concurrency would hit MiniMax per-key rate limit (Entry 11 finding) and would likely re-trigger OAuth burst rejection that Entry 9 documented. Don't bump unless cross-validated.
- **Retracted Entry 7 tail's "OAuth pool quota" framing** — only option-validation gating is empirically supported. Quota framing was post-hoc rationalization without evidence (user called this out and was right).
- **Entry 12's Reflexion contracts land under feature-area subdirs, not `contracts/content/`** — Haiku categorizes Reflexion's 5 proposals by feature (`core`, `auth`, etc.). The `contracts/content/` subdir test ("did Reflexion fire") returns false even though Reflexion is empirically effective (+17.6pp bug detection lift). Don't use subdir presence as a Reflexion-validation signal in future entries.

## Open questions

- Should the `--no-reflexion` flag be added at the autopilot CLI level (user-facing) or only as an env var (`CONTRACTQA_DISABLE_REFLEXION=1`) for tuning experiments? Both are easy. User preference unknown.
- For investigating apps 0001/0002 "invalid JSON" Reflexion failures: should we tighten the Reflexion prompt to discourage markdown-fenced output, or add markdown-stripping to `extractJsonFromLlmResponse`?
- Apps 0006/0007 underperformed in Entry 12 (38.1% / 55.6% coverage, low contract count). Worth a single-app debug to find why their enumerateSurface produced fewer interactions, OR accept as model-specific behavior?
- Is the Anthropic API key path worth pursuing? Entry 12 proved OAuth Haiku works for the canonical use case; API key only matters if user wants cross-validation against MiniMax or wants billing isolation.

## Read these first

1. `qa/eval/tuning-log.md` — Entry 12 (the new high-water) and Entry 11 (Reflexion validation). The "Next" list at the end of Entry 12 is the next-session backlog.
2. `packages/cli/src/autopilot/interaction-discovery.ts` — Reflexion code at line 715+, `reflexionContentPass()` and `discoverByInteraction` wiring (line 1137+). Where the `--no-reflexion` flag plumbing needs to go.
3. `scripts/eval/docker-batch.mjs` — the parallel batch runner that produced Entry 11 + 12 numbers. Read the scorer-env-override around the `score (LLM judge)` step to understand the Entry 11 fix.
4. `packages/orchestrator/src/llm/claude-agent-sdk-client.ts` — the harness ON/OFF switch logic. `harnessEnabled` defaults to false; verify behavior before adding new env vars.
5. `/Users/zmy/.claude/projects/-Users-zmy-intership-5-10--qa-agent/memory/reference_deep_mode_sdk_crash.md` — corrected diagnosis of the 403 (Anthropic-OAuth policy on custom-context SDK options). Still load-bearing reference for future SDK debugging.

## Already invoked this session

- **MiniMax API key** — user shared `sk-cp-...` for Anthropic-compat shim experiments (Entry 10/11). Was used as Bearer token via `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`. Treat as expended for tuning purposes; user may want to rotate the OAuth tokens that leaked in early Entry 7 work via `claude logout && claude` if not already done.
- **Background batches** — three full WebTestBench batches ran: Arm B sequential on MiniMax (killed mid-run), docker batch on MiniMax (6/10 OK), docker batch on Haiku (10/10 OK). Snapshots preserved at `qa-eval-fixtures/WebTestBench/snapshots/batch-2026-05-{28,29}-docker*`.
- **Docker images** — all `cqa-webtest-NNNN-*` images cleaned up after each batch (--rm + explicit removal). No leaked containers expected; verify with `docker ps -a --filter name=cqa-`.
- **No subagents spawned** this session. No `/loop`, `/schedule`, or autonomous skills triggered.

## Verify state on resume

```
cd /Users/zmy/intership/5.10+/qa-agent && \
  git log --oneline -3 && \
  git status --short | grep -v "^??" | head -3 && \
  grep "^## Entry 12" qa/eval/tuning-log.md
```
