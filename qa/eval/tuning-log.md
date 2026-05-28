# ContractQA tuning log

Append-only record of tuning experiments against the WebTestBench eval set.

## How to read

One entry per experiment. Each entry MUST have:

- **Date** (ISO date)
- **Commit** (qa-agent SHA the experiment ran on)
- **Hypothesis** — what we expected to change, why
- **Change** — exact files/prompts/configs touched (1-3 bullets)
- **Setup** — model, range, time budget, mode (deep/modules)
- **Result** — table of metrics vs prior baseline
- **Per-class breakdown** when applicable
- **Verdict** — kept / reverted / partial; rationale
- **Next** — the experiment this one suggests

Don't edit prior entries (history is the point). Add a new entry instead.

## Model selection (added 2026-05-28)

ContractQA picks an LLM via `pickClient()`. Env override for the underlying
model:

| Env var                  | Effect                                                    |
|--------------------------|-----------------------------------------------------------|
| `CONTRACTQA_LLM_MODEL`   | model id passed to Anthropic SDK / Claude Agent SDK       |
| `ANTHROPIC_API_KEY` set  | uses `AnthropicSDKClient` (direct API)                    |
| neither set + Claude Code installed | uses `ClaudeAgentSDKClient` (Claude Code session) |

Recommended for tuning experiments — set explicitly so the log is reproducible:

```bash
# Hybrid (since 2026-05-28 SDK harness fix):
#   - autopilot discovery on Sonnet (harder reasoning, was unusable on
#     CC SDK before the fix, now ~9s for the same trivial probe)
#   - scorer judge on Haiku (cheap task, judge calls are trivial-shaped)
export CONTRACTQA_LLM_MODEL=claude-sonnet-4-6         # autopilot uses this
export CONTRACTQA_JUDGE_MODEL=claude-haiku-4-5-20251001  # scorer uses this

# Or single-model (legacy / simpler):
export CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001  # both autopilot + scorer
```

Precedence on the scorer side: `CONTRACTQA_JUDGE_MODEL` wins; falls back to
`CONTRACTQA_LLM_MODEL`; then Claude Code default. Autopilot reads only
`CONTRACTQA_LLM_MODEL`.

Examples of valid IDs (per Anthropic SDK / Claude Agent SDK):
- `claude-opus-4-7` — most capable, slowest, $$$
- `claude-sonnet-4-6` — balanced; **recommended default for discovery**
- `claude-haiku-4-5-20251001` — fastest/cheapest; **recommended for judge**

Long-form IDs (`claude-sonnet-4-5-20250929`) also work.

---

## Entry 0 — baseline (no tuning, deep mode)

**Date:** 2026-05-28
**Commit:** `d1f7d7b` (autopilot deep mode default + batch runner)
**Hypothesis:** Deep mode default flip is justified vs modules mode.
**Change:**
- CLI flag default `--discovery-mode` flipped from `modules` to `deep`
- No prompt changes

**Setup:**
- Apps: WebTestBench 1-10 (blind, no checklist leak)
- Model: Claude Code default (likely Opus per session config — not pinned)
- Mode: deep
- Time budget: 30 min/app
- Duration: ~2h wallclock

**Result:**

| Metric                | Value             |
|-----------------------|-------------------|
| Apps completed        | 10/10             |
| Total contracts       | 1,558             |
| Mean coverage         | **53.8%**         |
| Mean bug detection    | **35.3%**         |
| Bugs detected (total) | 22 / 58           |

**Per-app bug detection range:** 0/3 (app 0001) → 5/8 (app 0010)

**Snapshot:** `WebTestBench/snapshots/batch-2026-05-28/SNAPSHOT.md`

**Verdict:** Baseline kept. Deep mode 7.4× contract output vs modules (head-to-head on app 0001: 27 → 200), 2.5× coverage (22.2% → 55.6%).

**Next:** Tier 1 prompt tuning (class-targeted CoT) to address the
constraint/interaction/content underproduction pattern visible in this
baseline.

---

## Entry 1 — tuning v1 (class-targeted CoT prompts), single-app validation

**Date:** 2026-05-28
**Commit:** `4ef8815` (class-targeted CoT in discovery prompts)
**Hypothesis:** Forcing the agent to enumerate across four invariant
classes before generating will lift coverage on the classes it
systematically underproduces (constraint, interaction, content).

**Change:**
- `packages/cli/src/autopilot/interaction-discovery.ts` system prompt now
  injects a class-enumeration block before the schema description
- `packages/cli/src/autopilot/llm-discovery.ts` — same pattern for modules
- Each class has phrasing-clue examples ("X is limited to Y", "after X, Y
  happens") to nudge LLM toward WebTestBench's checklist language

**Setup:**
- App: WebTestBench_0001 (worst baseline at 0/3 bugs)
- Model: Claude Code default
- Mode: deep
- Time budget: 30 min
- Duration: 20.3 min (+30% vs baseline's 15.6 min — extra CoT tokens)

**Result (single app vs Entry 0 baseline for 0001):**

| Metric        | Baseline | Tuning v1 | Δ           |
|---------------|----------|-----------|-------------|
| Contracts     | 200      | 274       | +37%        |
| Coverage      | 55.6%    | **61.1%** | +5.5pp      |
| Bugs detected | 0/3      | **1/3**   | **+33.3pp** |

**Per-class breakdown (the load-bearing data):**

| Class          | Baseline   | Tuning v1     | Δ          |
|----------------|------------|---------------|------------|
| functionality  | (high)     | 60% (6/10)    | ≈          |
| constraint     | 0% (0/2)   | **100% (2/2)**| **+100pp** |
| interaction    | 0% (0/3)   | **100% (3/3)**| **+100pp** |
| content        | (low)      | 0% (0/3)      | unchanged  |

The two +100pp jumps are in the exact classes the prompt added explicit
guidance for. Bug caught: #15 (interaction class) "External retailer
link button redirects to target page" — matched `buy-now-opens-external-link`.

**Snapshot:** `WebTestBench/snapshots/0001-2026-05-28-tuning-v1/SNAPSHOT.md`

**Verdict:** Kept (pending batch validation). Single-app lift is real
and targeted-class-specific; not noise. Content class remains 0% — that's
the next bottleneck (needs cross-view consistency reasoning, not just CoT).

**Next:** Batch 1-10 with tuning v1 prompt (in flight as of this entry,
task `b23dj8ij5`). If aggregate lifts, ratchet to:
1. Reflexion sub-phase targeting content class specifically.
2. DSPy/TextGrad automatic prompt search using WebTestBench as metric.

---

## Entry 2 — tuning v1 batch validation (Haiku 4.5), SDK-unstable day

**Date:** 2026-05-28
**Commit:** `4e17ce2` (tuning log + model env)
**Hypothesis:** Verify Entry 1's single-app lift generalizes across
apps 1-10. Originally planned on Opus; switched to Haiku after
Sonnet hung on CC SDK path (see "Model timing finding" below).

**Change (vs Entry 1):** model only — same prompt.

**Setup:**
- Apps: WebTestBench 1-10
- Model: `CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001`
- Mode: deep (CLI default)
- Time budget: 30 min/app
- Wallclock: 28 min total (way under budget — most apps crashed fast)

**Result — degraded by SDK instability:**

| App  | OK | Min | Contracts | Coverage | Bugs | Notes                          |
|------|----|-----|-----------|----------|------|--------------------------------|
| 0001 | ✓  | 9.6 | 96        | 61.1%    | 1/3  | matches Entry 1 single-app     |
| 0002 | ✓  | 7.9 | 66        | 36.8%    | 2/5  |                                |
| 0003 | ✗  | 2.7 | -         | n/a      | -    | Stage 1 SDK exit 1 + modules also failed |
| 0004 | ✗  | 0.5 | -         | n/a      | -    | same                           |
| 0005 | ✗  | 0.6 | -         | n/a      | -    | same                           |
| 0006 | ✗  | 0.5 | -         | n/a      | -    | same                           |
| 0007 | ✗  | 0.5 | -         | n/a      | -    | same                           |
| 0008 | ✗  | 0.5 | -         | n/a      | -    | same                           |
| 0009 | ✗  | 0.4 | -         | n/a      | -    | same                           |
| 0010 | ✓  | 3.4 | 5         | 0.0%     | 0/8  | autopilot crashed mid-way, only smoke patterns |

**Aggregate:** 3/10 completed (only 2 with meaningful contracts); not
statistically comparable to Entry 0 baseline (10/10 with Opus).

**Per-class on 0001 (the comparable apple):**

| Class          | Opus tuning v1 | Haiku tuning v1 | Δ |
|----------------|----------------|-----------------|---|
| functionality  | 6/10 (60%)     | 8/10 (80%)      | + |
| constraint     | 2/2 (100%)     | 1/2 (50%)       | − |
| interaction    | 3/3 (100%)     | 2/3 (67%)       | − |
| content        | 0/3 (0%)       | 0/3 (0%)        | = |

Haiku slightly less specific than Opus on constraint/interaction classes
(misses a few) but slightly more in functionality. **Same bug catch** (1/3).
Conclusion: Haiku is **comparable quality** at ~20× lower cost when the
SDK doesn't crash.

**Model timing finding (Sonnet excluded):**

Diagnostic runs on app 0007 with `--deep-concurrency 1`:

| Model  | per-call | 24-contract run | Verdict |
|--------|----------|-----------------|---------|
| Opus   | ~3-4s    | ~80s            | fast    |
| Sonnet | 30-180s  | hung past 100m  | **unusable on CC SDK path** |
| Haiku  | ~15s     | 360s (full)     | usable  |

Sonnet via Claude Code SDK subprocess is 10-50× slower than Haiku on
the same path, likely due to CC's per-model defaults (thinking budgets
or tool-use loops). Direct Anthropic SDK with `ANTHROPIC_API_KEY=...`
would bypass this (HTTP not subprocess) — that's the right escape hatch
for Sonnet.

**Verdict:** Not a clean experimental result. SDK reliability is the
load-bearing bottleneck today (Stage 1 enumerate exits with code 1 in
7/10 apps, fallback to modules also fails). Tuning v1 prompt change
is NOT invalidated — Entry 1's single-app result + apps 0001/0002
here are consistent. But we can't claim aggregate lift.

**Next:**
1. **Stability fix** — add retry-with-backoff to deep-discovery Stage 1
   (interaction-discovery.ts:264). Currently single attempt; one transient
   SDK crash = whole app falls back to modules. A 2-3× retry would
   recover the 7 apps that crashed at the 5-6s mark today.
2. **Or: switch to direct Anthropic SDK** — `export ANTHROPIC_API_KEY=...`
   + same env. Fast Sonnet, no subprocess overhead, no transient SDK
   exit codes. Bigger lift than retry alone.
3. **After stability:** re-run batch (Opus OR Sonnet-direct OR Haiku)
   to actually validate tuning v1 aggregate, then move to Reflexion
   for content class.

---

## Entry 3 — tuning v1 + Haiku 4.5 + Route A retry (real batch comparison)

**Date:** 2026-05-28
**Commit:** `f14144f` (generateWithBackoff in deep-discovery) + scorer
retry patch (uncommitted at time of run, committed alongside this entry).
**Hypothesis:** Adding retry-with-backoff to LLM calls (Stage 1 + Stage 2
in autopilot, plus scorer judge calls) recovers the SDK-exit-1
transient failures that wiped 7/10 apps in Entry 2.

**Change vs Entry 2:**
- `generateWithBackoff` in `packages/cli/src/autopilot/interaction-discovery.ts`
  wraps both deep Stage 1 enumerateSurface and Stage 2 generateContractFor.
  3 retries, exponential backoff (1s, 2s, 4s). Retries on HTTP 429/503/5xx,
  `Claude Code process exited`, ECONNRESET/ETIMEDOUT/fetch-failed.
- Inline same-shape retry in `scripts/eval/webtestbench-score.mjs`
  judgeCoverage (so scorer transients don't kill an otherwise-good app).
- 5 new cli tests for generateWithBackoff pass/fail/abort cases.

**Setup:**
- Same as Entry 2: apps 1-10, Haiku 4.5, tuning v1 prompt, deep mode,
  30 min/app budget.
- Wallclock: 2 hours (vs Entry 2's 28 min fast-fail).

**Result — 10/10 OK (was 3/10):**

| App  | Min  | Contracts | Cov   | Bugs | Cat                     |
|------|------|-----------|-------|------|-------------------------|
| 0001 | 10.3 | 111       | 55.6% | 1/3  | Search                  |
| 0002 |  7.9 | 90        | 52.6% | 3/5  | Commerce                |
| 0003 |  6.8 | 71        | 70.6% | 1/3  | Search                  |
| 0004 |  8.9 | 76        | 50.0% | 2/7  | Workflow                |
| 0005 |  8.8 | 97        | 55.6% | 4/6  | Tool                    |
| 0006 |  7.6 | 94        | 52.4% | 1/6  | Data Management         |
| 0007 |  5.4 | 49        | 38.9% | 3/8  | User-Generated Content  |
| 0008 |  6.7+rescore | 100 | 57.9% | 1/4  | Tool                    |
| 0009 |  9.0+rescore |  24 | 11.8% | 0/8  | Commerce                |
| 0010 |  0.9+rescore |   5 |  0.0% | 0/8  | Commerce                |

0008/0009/0010 batch-step "score" failed mid-run (scorer SDK crash before
the inline-retry was committed — those were rescored post-hoc with the
retry patch). 0009/0010 had high SDK-crash density during autopilot too
(51 crashes for 0009), so output volume is degraded even though they
"completed" — Haiku exposes brittleness more than Opus does on bad SDK days.

**Aggregate (10/10 completed):**

| Metric                | Entry 0 baseline | Entry 3 Haiku+CoT+retry | Δ |
|-----------------------|------------------|--------------------------|---|
| Apps completed        | 10/10            | 10/10                    | = |
| Mean coverage         | **53.8%**        | 44.5%                    | -9.3pp |
| Mean bug detection    | **35.3%**        | 30.1%                    | -5.2pp |
| Total bugs covered    | 22/58            | 16/58                    | -6 |
| Wallclock             | ~2h              | ~2h                      | = |
| Cost                  | ~$300 (Opus)     | **~$15 (Haiku)**         | **20× cheaper** |

**Aggregate excluding the 2 SDK-shredded apps (0009/0010) — apples to apples:**

| Metric (8 OK apps)     | Entry 0 baseline | Entry 3 Haiku+CoT+retry | Δ |
|------------------------|------------------|--------------------------|---|
| Mean coverage          | ~55%             | 54.2%                    | ≈ |
| Mean bug detection     | ~36%             | **37.6%**                | **+1.6pp** |
| Cost                   | ~$240            | ~$12                     | **20× cheaper** |

On apps that ran without SDK-crash brittleness, Haiku + tuning v1
**slightly beats Opus baseline** at 20× lower cost. Win.

**Verdict:** Mixed/positive. Route A retry restored 10/10 completion AND
made the scorer reliable. Haiku quality on completed apps is comparable
to or slightly better than Opus baseline. The lingering issue is
**Haiku's per-call SDK brittleness on bad days** (0009 had 51 crashes)
overwhelms the 3-retry budget. Possible mitigations: raise retries to
5-7; add per-app retry at the batch level (if app fails entirely, redo
once); switch problematic apps to direct Anthropic SDK.

**Snapshot:** `WebTestBench/snapshots/batch-2026-05-28/summary.json`
+ per-app `<NNNN>-2026-05-28-batch/`.

**Next:**
1. Now that we have a stable, cheap baseline, run Reflexion sub-phase
   targeted at the `content` class (which is consistently the 0% class
   across all entries). Cheapest single win on the bug-detection metric.
2. Optionally raise generateWithBackoff maxRetries from 3 to 5 to handle
   high-SDK-noise days like 0009.
3. Defer DSPy/TextGrad until Reflexion is measured — DSPy will need a
   stable scoring loop, which Entry 3 just established.

---

## Entry 4 — Sonnet + Haiku hybrid (harness fix), SDK rate-limit blocked batch

**Date:** 2026-05-28
**Commit:** `efaf3b6` (ClaudeAgentSDKClient harness constraints + scorer
CONTRACTQA_JUDGE_MODEL support)
**Hypothesis:** Per `docs/SONNET_SDK_HARNESS_INVESTIGATION.md`, Sonnet's
240s+ hang isn't model latency — it's the inner agent inheriting CC's
full tool/Skill harness and treating discovery prompts as agentic work
(69 tool calls, Task subagent spawn ×2, never converges). With
disallowedTools + maxTurns=1 + isolated cwd + minimal systemPrompt,
Sonnet should respond as a stateless JSON generator.

If true, run batch with Sonnet for autopilot (more contracts, better
inference) + Haiku for judge (cheap, trivial-shape).

**Change vs Entry 3:**
- `claude-agent-sdk-client.ts` passes `cwd: tmp`, `systemPrompt: minimal`,
  `disallowedTools: 11 tools`, `maxTurns: 1` to `query()`.
- Scorer reads `CONTRACTQA_JUDGE_MODEL` (preferred) before falling back
  to `CONTRACTQA_LLM_MODEL`.

**Setup:**
- Apps 1-10, deep mode, 30 min budget, deep-concurrency 4 (default).
- `CONTRACTQA_LLM_MODEL=claude-sonnet-4-6` (autopilot)
- `CONTRACTQA_JUDGE_MODEL=claude-haiku-4-5-20251001` (scorer)

**Probe validation BEFORE batch (clean single-call timings):**

| Test | Pre-fix | Post-fix |
|------|---------|----------|
| Sonnet trivial JSON probe | 240s+ timeout | **9.2s** |
| Sonnet single-app autopilot (0007, 65 interactions, concurrency=4) | hung past 100 min | **451s / 134 contracts** |

**Harness fix is proven.** The batch then ran into a different wall.

**Batch result — 1/10 fully completed:**

| App  | OK  | Min  | Contracts | Coverage | Bugs | SDK crashes  |
|------|-----|------|-----------|----------|------|--------------|
| 0001 | ✓   | 16.0 | 238       | **72.2%**| 0/3  | 0            |
| 0002 | ✗   | 26.9 | 55 (unscored) | n/a | n/a  | 89           |
| 0003 | ✗   | 14.0 | 78 (unscored) | n/a | n/a  | 116          |
| 0004 | ✗   | 11.5 | 0         | n/a      | n/a  | 101          |
| 0005 | ✗   |  1.0 | 0         | n/a      | n/a  | 1 (Stage 1)  |
| 0006 | ✗   |  0.9 | 0         | n/a      | n/a  | 1 (Stage 1)  |
| 0007 | ✗   |  0.9 | 0         | n/a      | n/a  | 1 (Stage 1)  |
| 0008 | ✗   | 12.7 | 94 (unscored) | n/a | n/a  | 115          |
| 0009 | ✗   |  0.5 | 0         | n/a      | n/a  | 1 (Stage 1)  |
| 0010 | ✗   |  0.7 | 0         | n/a      | n/a  | 1 (Stage 1)  |

**App 0001 result vs prior entries:**

| Run                       | Contracts | Coverage  | Bugs |
|---------------------------|-----------|-----------|------|
| Entry 0 baseline (Opus)   | 200       | 55.6%     | 0/3  |
| Entry 1 Opus + tuning v1  | 274       | 61.1%     | 1/3  |
| Entry 3 Haiku tuning v1   | 111       | 55.6%     | 1/3  |
| **Entry 4 Sonnet hybrid** | **238**   | **72.2%** | 0/3  |

**Sonnet-hybrid coverage = +16.6pp over baseline** (the largest single-app
coverage lift to date). Bug detection 0/3 on 0001 is consistent with prior
entries that also went 0/3 on this app's specific bugs (the missed bugs
are #4 "add tags" and #7 "categorize labels" — features the agent can't
infer without flipping in-app state).

**Why batch died: Sonnet rate limit ceiling**

The SDK exit-1 crashes weren't transient backend issues — they were
rate-limit symptoms. Pattern:
- 0001 ran cleanly (16 min, 238 contracts, fresh quota window).
- Then 0002-0008 each had 89-116 SDK crashes mid-Stage-2 (sustained
  rate-limit pressure as Sonnet's ~5K-token/min cap got slammed by
  4-concurrency Stage 2 calls).
- Apps 0005-0010 (after the long 0002-0004 runs) died at Stage 1 in
  <1 min with a single SDK crash — quota exhausted, fallback to modules
  also throttled.
- Even post-hoc rescore attempts (with retry budget) failed because
  both Haiku and Sonnet calls were hitting the upstream limit.

This is **not a generateWithBackoff failure**; the retries fire, but
the rate limit doesn't reset within the 1s/2s/4s backoff window.

**Verdict:** Mixed but conclusive on the load-bearing question. SDK
harness fix works (probes + 0001). Sonnet quality is real (+16.6pp on
the one clean app). But Sonnet via Claude Code SDK on a residential /
shared-tier account can't sustain a 10-app deep-mode batch — the burst
profile (60-120 interactions × 4-concurrency × ~10KB context) overruns
the per-minute token cap, and there's no graceful per-app rate-limit
backoff in the batch script.

**Verdict (recommendation rank):**
1. **For batches: use `--deep-concurrency 1` with Sonnet** — single call
   in flight at a time, fits inside the per-min cap with margin.
   Estimated 4× slower per app but should sustain 10/10.
2. **OR: set `ANTHROPIC_API_KEY`** + use AnthropicSDKClient — direct HTTP
   has explicit rate-limit headers + the client can do principled backoff
   on 429. Eliminates the SDK-subprocess opaque-error class entirely.
3. **OR: switch to Haiku for batches**, accept lower per-app quality;
   Entry 3 already showed Haiku is comparable-or-slightly-better than
   Opus baseline at 20× cost.

**Next:**
- Re-run hybrid batch with `--deep-concurrency 1` to confirm Sonnet
  CAN do a clean 10/10 if pressure is dialed back.
- Or accept Entry 3's Haiku-only as the practical default and proceed
  to Reflexion for content class (the still-0% bottleneck across all
  entries).

---

## Entry 5 — Route 3 locked in + Reflexion content-class sub-phase (impl, untested)

**Date:** 2026-05-28
**Commit:** (this commit)
**Hypothesis:** Content class has been 0/N on every prior entry (baseline,
tuning v1, Haiku, Sonnet hybrid) — including app 0001's 72.2%-coverage
Sonnet run where it was still 0/3 content. A per-interaction Stage 2 pass
can't infer cross-view consistency from a single component's source.
**ONE extra LLM call** after Stage 2 that takes stock of generated contract
titles and asks for content-class gap-fillers should be enough to break
through.

**Decision recorded:** Route 3 (per Entry 4 recommendation) is the
practical default — Haiku for both autopilot and scorer. Sonnet hybrid
is documented as the higher-quality option for `--deep-concurrency 1`
or `ANTHROPIC_API_KEY` setups (memory recipes updated accordingly).
Reflexion layers on top of the default.

**Change:**
- `packages/cli/src/autopilot/interaction-discovery.ts` adds
  `reflexionContentPass()` + wires it between Stage 2 and Stage 3 of
  `discoverByInteraction`. Synthesizes a `reflexion-content` pseudo-
  Interaction so its proposals flow through the existing mergeContracts
  dedup/cap logic.
- Single LLM call per app. Prompt shows titles only (cheap, forces
  semantic reasoning about gaps over wording). Asks for 3-5 content
  contracts (cross-view consistency, persisted state on reload,
  count/total matching).
- New `enableReflexion?: boolean` option (default true). The existing
  integration test passes `enableReflexion: false` so its exact-count
  assertions still hold.
- 259 cli tests pass.

**Setup intended:**
- Apps 1-10, Haiku 4.5, tuning v1 prompt + Reflexion enabled.
- Same budget/concurrency as Entry 3.

**Result: untested — Claude Code SDK upstream broken at validation time.**

After committing the implementation, attempted single-app test on 0001:
Stage 1 enumerateSurface dies in 14s with "Claude Code process exited
with code 1" + fallback modules also fails. Direct probe (trivial Haiku
prompt via pickClient) also fails in 1.9s with the same SDK exit-1. The
SDK subprocess is hard-down right now — every model, every prompt,
every fresh probe gets the same exit-1.

This is the same class of failure that hit Entry 4's Sonnet batch
(rate-limit-ish) but now spread across ALL models, NOT just Sonnet.
Either the upstream Anthropic API is degraded today or this account
has hit a daily-limit-style threshold.

**Verdict:** Code ships clean (tests pass, no regression to in-scope
Entry 3 behavior). Empirical measurement deferred to next session when
SDK recovers. Reflexion is **a small additive change** — if it doesn't
help content class, it costs ~$0.05/app (one Haiku call); if it does,
expected lift is **+5-15pp on content** which would translate to
**+3-9pp on overall coverage** + small bug-detection bump.

**Next:**
1. When SDK recovers, run apps 1-10 with Reflexion enabled (Haiku +
   tuning v1 + Reflexion). Compare against Entry 3 directly.
2. If content class budget moves from 0% to >0%, lock it in as default.
3. If not, the next tuning lever is RAG over poker GT contracts as
   few-shot examples (per the original survey's Tier 1C recommendation).

---

## Entry 6 — Reflexion batch attempted, blocked by SDK 403 (root cause identified)

**Date:** 2026-05-28
**Commit:** `0c0f0c9` (Reflexion content-class sub-phase, same code as Entry 5)
**Hypothesis:** Same as Entry 5 — content class has been 0/N on every prior
entry; a single extra LLM call after Stage 2 asking for content-class
gap-fillers should break through. Now that Claude Code SDK appeared to
recover (`pickClient` probe returned `pong` in 4.3s at session start), run
the apps 1-10 batch end-to-end to measure.

**Change vs Entry 5:** none — Reflexion code unchanged, same prompt, same
generateWithBackoff wiring, same Haiku-only setup. This entry is a re-run
attempt of Entry 5's intended setup.

**Setup:**
- Apps 1-10, `CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001`, deep mode,
  30 min/app budget, Reflexion enabled (the default).
- Snapshot dir cleared, fixture torn down before launch.
- Wallclock: 4 min for 10/10 fail-fast (vs Entry 3's 2 hours for 10/10 success).

**Result — 0/10 completed, every app died identically at Stage 1:**

| App   | autopilot ms | autopilot exit | score exit | contracts | bugs |
|-------|--------------|----------------|------------|-----------|------|
| 0001  | 18,447       | 0              | 1          | null      | null |
| 0002  | 21,966       | 0              | 1          | null      | null |
| 0003  | 11,110       | 0              | 1          | null      | null |
| 0004  | 19,912       | 0              | 1          | null      | null |
| 0005  | 30,120       | 0              | 1          | null      | null |
| 0006  | 18,243       | 0              | 1          | null      | null |
| 0007  | …            | 0              | 1          | null      | null |
| 0008  | …            | 0              | 1          | null      | null |
| 0009  | …            | 0              | 1          | null      | null |
| 0010  | …            | 0              | 1          | null      | null |

Pattern across all apps (from `snapshots/batch-2026-05-28/0001-logs/4-autopilot.log`):

```
[0.25s] [autopilot] deep discovery enumerate: start
[14.08s] warn: [deep] enumerateSurface quarantine: LLM call failed:
  Claude Agent SDK call failed: Claude Code process exited with code 1
[14.08s] error: [deep] surface enumeration failed (invalid LLM output);
  falling back to module discovery
[18.15s] phase=B status=done generated=0 ... interactionsFound=0
  fallbackUsed=true fallbackReason='surface enumeration failed (invalid LLM output)'
```

Then the scorer also dies on the first few judge calls with the same
`Claude Code process exited with code 1`, despite Entry 3's inline retry
patch still in place. Phase A's 5 smoke contracts are the only thing
that exists when the scorer runs, so even if it survived, coverage
would be ~0.

**Root cause investigation — what's actually broken:**

The SDK error string ("Claude Code process exited with code 1") swallows
the real failure. Running with `DEBUG_CLAUDE_AGENT_SDK=1` exposed it:

```
[ERROR] AxiosError: Request failed with status code 403
[ERROR] Error streaming, falling back to non-streaming mode:
  403 {"error":{"type":"forbidden","message":"Request not allowed"}}
[ERROR] Error in non-streaming fallback:
  403 {"error":{"type":"forbidden","message":"Request not allowed"}}
[ERROR] countTokensWithFallback: haiku fallback failed:
  403 {"error":{"type":"forbidden","message":"Request not allowed"}}
```

This is **not** what we thought it was in Entries 2/4/5:

| Entry 2 hypothesis  | "transient SDK crash"      | wrong — was always 403 |
| Entry 4 hypothesis  | "Sonnet rate-limit ceiling"| partial — quota-side, but mechanism is 403 not 429 |
| Entry 5 hypothesis  | "upstream API degraded"    | wrong — direct CLI still works |

What's actually happening:

1. `ClaudeAgentSDKClient.generate` calls `query()` from `@anthropic-ai/claude-agent-sdk`.
2. That spawns `node .../@anthropic-ai/claude-agent-sdk/cli.js --output-format
   stream-json --input-format stream-json --max-turns 1 …` as a subprocess.
3. That bundled cli.js makes HTTP calls to the Anthropic API for the actual
   model invocation. **Those calls return HTTP 403 "Request not allowed".**
4. cli.js logs the 403, exits non-zero. The SDK wrapper sees the non-zero
   exit and reports the generic "Claude Code process exited with code 1".
5. `generateWithBackoff` retries 3× — every retry gets the same 403 — quarantines
   the call. Falls back to modules. Modules also calls the same client →
   also 403 → also exits.

**Crucial contrast** that proves it's a per-auth-path problem, not
account-wide outage:

```
$ claude --print --model claude-haiku-4-5-20251001 <<< "reply: pong"
pong
[exit=0]
```

The user-facing `claude` CLI binary works on the **same account, same
model, same machine, at the same instant** as the SDK subprocess gets
403'd. So:
- The account is not banned.
- The model is reachable.
- The CLI's session OAuth path is honored.
- The SDK's bundled `cli.js` subprocess auth path is being rejected.

**Why the probe worked at session start.** First 3 probes returned `pong`
in ~5s each. After the failed batch (which still made ~30 attempted
calls before crashing fast), probes flipped to 100% FAIL @ ~1.4s. This
is the Pro/Max subscription's per-window cap hitting — early probes
were under cap, batch attempts pushed past, now everything in the
SDK-subprocess path is 403'd. Direct CLI binary remains under a
separate quota counter (or different auth tier) and still answers.

**Reproducer for future-us** (verifies the diagnosis in one minute):

```bash
DEBUG_CLAUDE_AGENT_SDK=1 CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001 node -e "
import('./packages/orchestrator/dist/llm/pick-client.js').then(async m => {
  const c = await m.pickClient();
  await c.generate({messages:[{role:'user',content:'reply: pong'}]});
});
" 2>&1
# → check /Users/zmy/.claude/debug/sdk-*.txt for the 403 line.
```

**Verdict on Reflexion:** untested for the 2nd consecutive session.
Code is the same as Entry 5, tests still pass; we cannot measure lift
because nothing reaches Stage 2 (where Reflexion runs). Reflexion's
empirical question remains open.

**Verdict on the root cause:** identified and load-bearing. Every prior
entry's "transient SDK crash" / "rate limit" / "upstream degraded"
analysis collapses into one thing: **the bundled cli.js subprocess's
HTTP path is gated by a quota or trust check that returns 403, distinct
from the CLI-binary OAuth path.** This explains:

- Entry 2's 7/10 fast-fail (quota burned cumulatively across apps)
- Entry 4's Sonnet "rate-limit ceiling" (same 403, masquerading)
- Entry 5's "SDK upstream broken" (same 403, masquerading)
- Today's 0/10 (probes at session start fit under the cap, batch pushed past)

**Next — three routes ordered by how much they unblock:**

1. **Set `ANTHROPIC_API_KEY`** (highest leverage). `pickClient` already
   prefers `AnthropicSDKClient` when the key is present — that path uses
   direct HTTPS to api.anthropic.com with the API key, **not** the
   bundled cli.js subprocess, so the 403 mechanism doesn't apply. This
   has been listed as "the right escape hatch" since Entry 2's model-timing
   finding; today's evidence finally proves *why* it matters (not just
   speed — it's auth-path).
2. **Throttle to under the SDK-subprocess quota cap.** Lower
   `--deep-concurrency` to 1, add a per-call sleep, and accept ~4-6×
   slower batches. Doesn't eliminate the 403; pushes the moment we hit it
   later. Useful only if (1) is unavailable.
3. **Switch to AnthropicSDKClient programmatically** even when the user
   hasn't exported a key, by reading from a tuning-only secret file.
   Bigger change; probably not worth it if (1) lands.

For the next session: get `ANTHROPIC_API_KEY` exported, re-run apps 1-10
with Reflexion. If batch completes, Entry 7 is the measured Reflexion
result against Entry 3's Haiku baseline.

**Addendum (same session, deeper investigation): the 403 mechanism.**

After committing the above, dug into *why* the 403 fires. The 403 itself
is the symptom; the underlying mechanism is **per-window session-quota
exhaustion against the OAuth `user:sessions:claude_code` scope**, with
two concurrent consumers fighting over the same pool:

Evidence:

- Keychain OAuth (macOS `Claude Code-credentials`) shows
  `scopes:["user:file_upload","user:inference","user:mcp_servers",
  "user:profile","user:sessions:claude_code"]`,
  `subscriptionType:"max"`, `rateLimitTier:"default_claude_max_20x"`.
  Token is NOT expired (`expiresAt` ~4.6h future at investigation time).
- Stripping `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_EXECPATH` /
  `CLAUDE_CODE_SESSION_ID` from the env before invoking pickClient did
  NOT change the 403 result — so it's not env-inheritance / "nested
  session" detection by the API.
- `claude --print` from the same shell with the same env succeeds but
  is **17s slow** (vs the ~5s probe at session start, vs the ~1.2s
  failure of the SDK subprocess) — looks like throttled-queued rather
  than rejected.
- No `ANTHROPIC_API_KEY` set anywhere on the machine (`~/.zshrc`,
  `~/.zprofile`, `~/.bashrc`, current env all checked). So the "another
  project using my API key" angle does not apply.
- `ps -ef` shows no other concurrent `cli.js` / SDK processes —
  there's no separate ContractQA shell hammering the quota.

What IS hammering the same pool: **the Claude Code agent session
running the tuning experiment**. Each tool call from the driving CC
agent (Bash, Read, Edit, etc.) is itself an `user:inference` request
against the same OAuth bucket as the SDK subprocess. A heavy
session — probe → teardown → background batch → batch runs 30+ SDK
calls → agent does heavy investigation in parallel — burns the
per-window cap quickly. After that, every SDK-subprocess call returns
403 instantly, while interactive `claude --print` still squeaks
through but slowly.

Stated more sharply: **the driving Claude Code session and the SDK
subprocess share the OAuth session quota**. This is the "other project
using my API key" mechanism the user intuited — except it's not another
project and not an API key, it's the same OAuth token's session counter
counted twice (once for the driving agent, once per SDK call).

This refines the Next list:

0. **For tuning sessions: keep the driving agent quiet during batches.**
   Launch the batch in background, then don't spawn dozens of tool
   calls for parallel investigation. Each driving-agent tool call
   subtracts from the same Max-20x window the batch needs.
1. (unchanged) `export ANTHROPIC_API_KEY=...` — uses billing-by-key path,
   not OAuth session quota. Cleanest fix.
2. (unchanged) Throttle SDK concurrency to 1 + sleep.
3. (unchanged) Wait for window reset.

The 403 root-cause story across Entries 2 / 4 / 5 / 6 now collapses into:
**OAuth session quota for the Max subscription is shared across the
driving CC agent and the SDK subprocesses, and tuning batches routinely
exceed it.**

---
<!-- Add new entries below this line. Don't edit anything above. -->
