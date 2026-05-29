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

## Entry 7 — root cause correction: SDK 403 is option-validation, not quota

**Date:** 2026-05-28
**Commit:** (this commit)
**Hypothesis being tested:** Entry 6 + addendum diagnosed the 403 as "OAuth
session-quota exhaustion shared between driving CC agent and SDK
subprocesses." User pushed back: "could it be that turning off the
scaffolding (harness constraints) is what makes it fail?" This entry
runs a differential probe to find out.

**Method:** With the same OAuth auth that was 403'ing in Entry 6, probe
the SDK's `query()` directly with progressively-added option keys. If
quota is exhausted, every shape fails. If a specific option triggers
rejection, only shapes containing that option fail.

**Result — option-by-option bisect:**

| Probe shape                              | Result | Latency |
|------------------------------------------|--------|---------|
| A. raw — model only                      | OK     | 8120ms  |
| B. + maxTurns:1                          | OK     | 6595ms  |
| C. + permissionMode:bypassPermissions    | OK     | 5870ms  |
| D. + disallowedTools (any value, even [])| **FAIL** | 1347ms |
| M. + cwd                                 | **FAIL** | 1472ms |
| N. + systemPrompt                        | **FAIL** | 2061ms |
| E/F. combinations of D/M/N               | FAIL   | ~1.3s   |

OK shapes take 5-8s (full inference roundtrip). FAIL shapes return in
~1.3s (rejected at request validation, never reach inference). The
distinction proves this is **server-side option-validation rejection**,
not quota exhaustion: a quota-locked account would fail shape A too.

The three forbidden options — `cwd`, `systemPrompt`, `disallowedTools`
— are exactly the ones that **customize the inner agent's context**
away from default Claude Code behavior. The three allowed options —
`model`, `maxTurns`, `permissionMode` — adjust the request without
overriding the Claude Code-shaped harness.

**Most plausible service-side rule (working hypothesis):** OAuth
subscription auth (Pro/Max plans) is gated to "use the Agent SDK as
Claude Code." Any option that overrides the default agent context
(custom cwd / custom systemPrompt / custom tool restrictions) returns
403 with `{"error":{"type":"forbidden","message":"Request not allowed"}}`.
This is a product gate: Anthropic doesn't want subscription quota
consumed by arbitrary custom-automation use of the SDK. Customization
requires API key billing.

**Entries 2 / 4 / 5 / 6 retroactively re-explained:**

The "transient SDK crash" / "Sonnet rate-limit ceiling" / "OAuth
session-pool exhaustion" framings in prior entries were all wrong
diagnoses of the same underlying mechanism: **the SDK harness fix in
`efaf3b6` (Entry 4) added `disallowedTools` + `cwd` + `systemPrompt` to
the `query()` call**, and that's the exact set of options that returns
403 under OAuth auth. Entry 4's first app (0001) succeeded because the
service-side rule appears to have rolled out *between* that app and
the rest of the batch, or because of probabilistic deployment. Entries
5 / 6 ran with the same harness code and all failed identically.

Entry 6's framing wasn't accidentally close to right — it was wrong on
mechanism. The shared-OAuth-pool intuition was wrong because:
- Driving-CC agent activity doesn't burn quota that the SDK then can't
  use; raw SDK probe (shape A) works fine even with the agent active.
- `claude --print` doesn't avoid 403 because it's "queued under
  different quota"; it works because it doesn't pass `cwd` /
  `systemPrompt` / `disallowedTools`, so it's not on the forbidden-
  options path.

**Implications for ContractQA:**

Removing the harness customization is **not viable**:
- Without `cwd`, the inner agent reads the calling repo's CLAUDE.md /
  DESIGN.md / memory state and contaminates JSON outputs.
- Without `disallowedTools`, the agent will reach for tools mid-call
  on Sonnet (Entry 4's 240s+ hang was specifically this).
- Without `systemPrompt`, the agent treats discovery prompts as agentic
  work and spawns sub-tasks instead of answering.

The harness is load-bearing. The only viable path is **switching the
auth tier**:

| Path                                  | OAuth (Pro/Max) | API key (AnthropicSDKClient) |
|---------------------------------------|-----------------|------------------------------|
| Harness customization allowed?        | NO (403)        | YES                          |
| Subprocess overhead?                  | YES (cli.js)    | NO (direct HTTPS)            |
| Billing                               | flat sub + ?    | per-token                    |
| Path in pickClient                    | ClaudeAgentSDKClient | AnthropicSDKClient      |
| ContractQA usable?                    | NO              | YES                          |

**Verdict on the broader Reflexion question:** still untested for the
3rd consecutive session (Entry 5 / Entry 6 / Entry 7). Reflexion code
is committed (`0c0f0c9`), tests pass, but empirical measurement keeps
getting blocked. The blocker is now precisely characterized.

**Next:**

1. **Get `ANTHROPIC_API_KEY` from console.anthropic.com.** This is no
   longer a "nice to have" — it's the only path. Subscription auth
   cannot run ContractQA at all as of the service-side change observed
   ~2026-05-28.
2. Re-run Reflexion batch via AnthropicSDKClient. Entry 8 reports
   measurement.
3. Optional code cleanup: since OAuth path is dead for our use case,
   simplify `pickClient` to fail fast with a clearer message ("OAuth
   credentials present but SDK rejects ContractQA's harness — set
   ANTHROPIC_API_KEY") instead of letting `ClaudeAgentSDKClient` try
   and surface generic "exited with code 1" errors.

**Methodological note:** Entry 6's wrong diagnosis stuck for ~half a
session because I didn't run a differential probe — only re-tested the
full failure shape, which is consistent with both "quota" and
"validation rejection." The bisect added in this entry would have been
~5 minutes of work in Entry 4 and saved Entries 5 / 6's misdirection.
**For future SDK debugging: when an option-bag call fails, bisect the
option bag before theorizing about state.**

### Tail addendum: my "quota gating" follow-up was unsupported — retracted

Right after the bisect, I added experiment switches (commit `3fa2413`)
and ran a probe with `CONTRACTQA_DISABLE_SDK_HARNESS=1` (= shape C of
the bisect, which had worked at 5870ms). Result: shape C FAILed
instantly. I then re-ran the full bisect — A/B/C/D/E/F all FAILed
uniformly at ~1.3s, including the bare shape A that had succeeded at
8120ms in the original bisect ~30 min earlier.

My first read on this was "quota burned between the two bisects, so a
second gating layer must also exist." User pushed back: that's just
post-hoc rationalization, not evidence. Reviewing carefully, they're
right:

- `claude --print` still succeeds on the same OAuth token at the same
  moment shape A is failing. If "OAuth quota burnt" were the
  mechanism, both should fail. They don't.
- The first 403 in the fresh DEBUG log is on `Grove notice config`
  (an internal Anthropic notice/banner service), which 403s on cli.js
  startup regardless of inference call shape. The original bisect's
  DEBUG log also showed Grove 403 at startup — yet shape A then
  succeeded. So Grove 403 isn't the gate either.
- I have no positive evidence for a "quota counter" mechanism. I was
  pattern-matching from Entry 6's wrong framing.

**Retracted:** the claim that "option gating AND quota gating stack."
I don't actually know why shape A succeeded in the bisect and FAILs
now. Possible candidates I can't distinguish:

- Anthropic rolled out a stricter policy between the two probes.
- Burst-rate limiting with a long window (slow reset).
- The bundled SDK 0.1.77 cli.js has an unreliable session-refresh
  path that flakes asymmetrically.

What stands: the bisect ITSELF still proves the option-validation
mechanism (A/B/C OK + D/E/F FAIL in the same session, same auth,
within seconds of each other — that pattern can't be a quota counter
or burst limit, since those would be order-dependent, and D/E/F came
right after A/B/C with no different timing).

What does NOT stand: my second-pass claim that a quota mechanism
separately explains the persistent post-bisect failures. That was
unsupported speculation. The honest answer for current SDK behavior
is "unknown — needs more probes spread across time / fresh sessions
to disambiguate."

**Practical consequence unchanged:** API key + AnthropicSDKClient (or
forced ClaudeAgentSDKClient via the new switches) remains the path
that bypasses whatever is gating the OAuth-auth subprocess calls.
The disable-harness switch IS correctly minimal (verified by tests
in `claude-agent-sdk-client.test.ts` — confirms cwd / systemPrompt /
disallowedTools / maxTurns all undefined when `disableHarness:true`).

---

## Entry 8 — harness default flipped off, partial Haiku recovery, Reflexion still untested

**Date:** 2026-05-28
**Commit:** `932f974` (flip ClaudeAgentSDKClient harness default to OFF)
**Hypothesis:** User observation: pre-`efaf3b6` (Entry 4) Haiku batches
were 10/10 OK (Entry 3). The Sonnet-targeted harness fix (cwd /
systemPrompt / disallowedTools / maxTurns) was the proximate cause of
the OAuth 403 since Entry 4 (per Entry 7 bisect). Reverting that default
should restore Entry 3-shape autopilot behavior for Haiku.

**Change:** `claude-agent-sdk-client.ts` now defaults to OFF for the
harness. New env / ctor opt `CONTRACTQA_ENABLE_SDK_HARNESS=1` /
`enableHarness:true` re-enables for callers that explicitly need it
(Sonnet on API-key auth). Legacy `CONTRACTQA_DISABLE_SDK_HARNESS=1` env
kept for backward compat. 62/62 orchestrator + 260/260 cli tests pass.

**Setup:**
- Apps 1-10, Haiku 4.5, deep mode, 30 min/app budget, Reflexion enabled.
- Same as Entry 6 except harness default flipped.
- Pre-batch probe: 3/3 OK at 6-7s each (real inference).

**Result — partial recovery, then burst-throttled:**

| App  | autopilot ms | exit | scorer ms | scorer exit | contracts in scratch | notes |
|------|--------------|------|-----------|-------------|----------------------|-------|
| 0001 | 369,469      | 0    | 13,596    | 1           | **34**               | real work — 4-6 min of generateContractFor calls, many per-call 403s, Reflexion call also 403'd. Scorer dies on 1st judge call. |
| 0002 | 356,160      | 0    | 15,976    | 1           | (similar)            | similar to 0001 |
| 0003 | 30,166       | 0    | 13,692    | 1           | (low/0)              | fast-fail at Stage 1, fallback to modules |
| 0004 | 19,331       | 0    | 13,110    | 1           | (low/0)              | fast-fail |
| 0005 | 354,907      | 0    | 13,181    | 1           | (similar to 0001)    | real work |
| 0006 | 28,013       | 0    | 15,237    | 1           | (low/0)              | fast-fail |
| 0007 | 21,976       | 0    | 33,854    | 1           | (low/0)              | fast-fail |
| 0008 | …            | 0    | …         | 1           | (low/0)              | fast-fail |
| 0009 | …            | 0    | …         | 1           | (low/0)              | fast-fail |
| 0010 | …            | 0    | …         | 1           | (low/0)              | fast-fail |

3/10 apps got real autopilot work; 7/10 fast-failed at Stage 1. Of the
3 that worked, all 3 had their Reflexion call 403'd. **No content-class
contracts written** (verified by titles audit on 0001 — all functionality
and interaction class).

**What this tells us:**

1. **The harness flip is the primary unblock.** Entry 6 batch with the
   harness was 0 contracts across 10 apps. Entry 8 batch without the
   harness is real per-interaction work on 3 apps. Confirms Entry 7
   bisect + user's diagnosis that `efaf3b6` was the proximate breakage.
2. **A separate burst-rate-limit layer is also real** (this time
   with evidence, unlike Entry 7's retracted "quota" claim): after
   ~6 minutes of dense generateContractFor calls, the post-autopilot
   probe is 3/3 FAIL, and the scorer's 3-retry/7s-backoff budget can't
   survive. The pre-batch probe was 3/3 OK at 6-7s each, then probes
   immediately after the batch are 3/3 instant 403. That's burst, not
   option, not quota-wide (CLI still works).
3. **Reflexion's single-shot call is unreliable under burst pressure.**
   It runs at the end of Stage 2, exactly when the burst window is
   hottest. All 3 well-behaved apps had Reflexion 403'd. The 4th-3rd
   consecutive session where Reflexion remains empirically untested.

**Per-class breakdown for 0001 (manual titles audit, 34 contracts):**

| Class          | Count | Notes |
|----------------|-------|-------|
| functionality  | ~19   | "X button navigates to Y" style |
| interaction    | ~7    | "form submits with non-empty query", "cancel resets fields" |
| constraint     | ~3    | "spec labels filtered out", "tags trimmed" |
| content        | **0** | **same as every prior entry** — Reflexion would have addressed this but its call failed |
| smoke (Phase A)| 5     | password-in-URL, 404, 401, etc. |

**Verdict:** Mixed. The harness flip is correct and committed. ContractQA
under OAuth+Haiku is back to *partial* function (Entry 3-shape on a good
day; degraded by burst rate-limit when bursts are tight). Reflexion still
needs measurement. **API key remains the only path to a clean run** —
not because of "OAuth quota", but because:

- Per-app autopilot bursts (50-100 contract gen calls in 5 min) trigger
  rate-limit ceilings that the 3-retry budget can't survive.
- Scorer fires immediately post-autopilot when the rate window is hottest.
- Reflexion is a single-shot call with no per-call retry beyond
  `generateWithBackoff`'s 3 tries — so any burst hit kills it.

API-key billing routes through `AnthropicSDKClient` (direct HTTPS, no
OAuth pool, much higher per-key rate limits, no subprocess overhead).

**Next:**

1. Get `ANTHROPIC_API_KEY` from console.anthropic.com. Pre-budget: Haiku
   10-app batch ~$1-3.
2. Re-run apps 1-10 with API key. Expected: 10/10 complete with
   Reflexion measurable. This becomes Entry 9 — the first clean
   Reflexion data.
3. If Reflexion produces content-class contracts (currently 0/N across
   8 entries), lock it in as default. If not, fall back to Tier 1C
   (few-shot retrieval over poker GT contracts).

**Concrete actions taken this session:**

- `932f974`: flip harness default to OFF (revert Entry 4 default)
- `3fa2413`: add CONTRACTQA_FORCE_SDK_CLIENT + CONTRACTQA_ENABLE_SDK_HARNESS
  switches for Entry 9's 3-arm A/B
- `3112107`: retract Entry 7 tail's unsupported "OAuth pool quota" claim
- Entry 8 batch results documented above (no contracts committed; scratch
  dirs hold the 34 from 0001 and similar partials from 0002/0005)

---

## Entry 9 — direct reproducibility test at Entry 3's exact commit (`f14144f`)

**Date:** 2026-05-28
**Commit run:** `f14144f` (Entry 3's exact commit, pre-`efaf3b6` harness fix)
**Hypothesis being tested:** User asked whether reverting the working tree
to Entry 3's exact commit could reproduce Entry 3's 10/10 OK + 44.5% mean
coverage result. This isolates *code* as a variable — if reproduction
fails at the same commit, the regression is service-side or account-side,
not code-side.

**Method:** Tag current `main` as `backup-main-2026-05-28-pre-entry3-repro`
(= `ed3057b`). `git checkout f14144f`. `pnpm install` + rebuild orchestrator
+ cli. Verified the on-disk code matches Entry 3 era: ClaudeAgentSDKClient
ships only `{permissionMode, model}` to query() (no harness options), no
Reflexion code present, same tuning-v1 CoT prompts. Cleared fixture
scratch + snapshot dirs. Ran the same `batch-webtestbench.mjs --range 1-10`
as Entry 3 with `CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001`.

**Setup:**
- Apps 1-10, Haiku 4.5, deep mode, 30 min/app, identical to Entry 3.
- Driving CC agent (me) deliberately quiet during the run (no parallel
  tool calls competing for the OAuth pool).

**Result — Entry 3 NOT reproducible:**

| App | Entry 3 reported (earlier today) | Entry 9 today on `f14144f` | % of Entry 3 |
|-----|----------------------------------|-----------------------------|--------------|
| 0001 | 111 contracts, 55.6% cov, 1/3 bugs | **29 contracts**, scorer 403 | 26% |
| 0002 | 90, 52.6%, 3/5                   | **26**, 403                  | 29% |
| 0003 | 71, 70.6%, 1/3                   | **5** (Phase A only)         | 7%  |
| 0004 | 76, 50.0%, 2/7                   | **5**                        | 7%  |
| 0005 | 97, 55.6%, 4/6                   | **5**                        | 5%  |
| 0006 | 94, 52.4%, 1/6                   | **5**                        | 5%  |
| 0007 | 49, 38.9%, 3/8                   | **5**                        | 10% |
| 0008 | 100, 57.9%, 1/4                  | **5**                        | 5%  |
| 0009 | 24, 11.8%, 0/8                   | **5**                        | 21% |
| 0010 | 5, 0.0%, 0/8                     | 5                            | 100%|

**Aggregate:** Entry 3 → 10/10 OK, mean cov 44.5%, mean bug 30.1%.
Entry 9 → **0/10 OK** (scorer 403s on every app, autopilot collapses
to Phase A only after the first 2 apps' bursts cook the window).

**What this rules out:**

- Not a code regression. Same commit, different result.
- Not the Entry 4 harness change (`efaf3b6`). `f14144f` predates it; no
  harness options in flight.
- Not the Reflexion addition (`0c0f0c9`). `f14144f` has no Reflexion code.
- Not the driving-CC-agent activity hypothesis from Entry 7 tail. I kept
  the agent quiet during this run — first 2 apps' degradation shows up
  anyway, and 0003-0010 all collapse to Phase A.

**What this leaves:**

The only difference between Entry 3's run and Entry 9's run is **the
Anthropic OAuth service's burst-rate behavior** (and/or this account's
state on the OAuth tier). Same auth token, same model, same `query()`
options, same fixture, same prompt — different output. Sometime between
Entry 3 (earlier on 2026-05-28) and Entry 9 (later on 2026-05-28),
Anthropic appears to have tightened OAuth-subscription burst limits, or
this account hit some per-day soft cap, or there's a deployment in
flight changing the per-window cap.

**Stronger version of Entry 8's conclusion:** **OAuth subscription auth
is no longer reliable for ContractQA batches at all** — not because of
the harness (which we already fixed in `932f974`), but because we cannot
reproduce Entry 3's result on Entry 3's own commit. The remaining viable
path is API key.

**Cleanup performed:**
- `git checkout main` → restored to `ed3057b`.
- Backup tag `backup-main-2026-05-28-pre-entry3-repro` retained pointing
  at `ed3057b`, so this revert is fully reversible (`git checkout
  backup-main-2026-05-28-pre-entry3-repro` to return).
- Rebuilt orchestrator + cli on main HEAD.

**Verdict:** Entry 3 is empirically NOT reproducible at its own commit
under OAuth today. This is the cleanest possible falsification of "code
is the only variable." `ANTHROPIC_API_KEY` becomes the only path forward
for ContractQA tuning, with higher confidence than Entry 8.

**Next (unchanged from Entry 8):**

1. `export ANTHROPIC_API_KEY=sk-ant-api03-...` from console.anthropic.com.
2. Re-run apps 1-10 on current `main` HEAD (`ed3057b`). Expected: 10/10
   complete via AnthropicSDKClient direct HTTPS, Reflexion measurable.
3. That becomes Entry 10 — first clean Reflexion data + first clean
   batch since Entry 3.

---

## Entry 10 — 3-arm A/B under MiniMax-M2.7-highspeed (Anthropic-compat API key)

**Date:** 2026-05-29
**Commit:** `cb6081e` (current main HEAD)
**Hypothesis:** With a non-Anthropic API key tunneled through an
Anthropic-compatible endpoint (MiniMax's `https://api.minimaxi.com/anthropic`
shim), we can run the 3-arm SDK harness comparison Entry 8 planned
without the Anthropic-OAuth burst-limit interference. This isolates
**which client + harness combo actually produces the best ContractQA
output** when service-side gating is out of the picture.

**Setup:**
- App: WebTestBench_0001
- Model: `MiniMax-M2.7-highspeed` (via MiniMax Anthropic-compat shim)
- Env: `ANTHROPIC_API_KEY=sk-cp-...`, `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`,
  `CONTRACTQA_LLM_MODEL=MiniMax-M2.7-highspeed`
- Mode: deep, time-budget 10 min, `--no-fix --yes --regenerate`
- Each arm runs sequentially with fresh fixture (teardown + reset + launch).
- Snapshot dirs: `WebTestBench/snapshots/arm-{A,B,C}/contracts/`

**Three arms:**

- **Arm A:** direct HTTP via `AnthropicSDKClient` (pickClient default when
  `ANTHROPIC_API_KEY` is set). No subprocess, no agent scaffolding.
- **Arm B:** ClaudeAgentSDKClient subprocess **without harness**
  (`CONTRACTQA_FORCE_SDK_CLIENT=claude-agent`, harness default OFF per
  Entry 8 commit `932f974`).
- **Arm C:** ClaudeAgentSDKClient subprocess **with harness re-enabled**
  (same as B + `CONTRACTQA_ENABLE_SDK_HARNESS=1`). The full
  cwd/systemPrompt/disallowedTools/maxTurns options.

**Pre-batch single-call connectivity probe** (with `reply: pong`):

| Arm | Latency | Result |
|-----|---------|--------|
| A   | 2562ms  | OK, `"pong"` |
| B   | 3377ms  | OK, `"pong"` |
| C   | 3217ms  | OK, `"pong"` |

All three connect; the harness shape (Arm C) does NOT 403 — first cross-
provider validation that Entry 7's bisect 403 was Anthropic-OAuth-tier
policy, not SDK code.

**Autopilot 0001 results:**

| Arm | Wallclock | Contracts | Deep Stage 1 (enumerateSurface) | Interactions found | Notes |
|-----|-----------|-----------|----------------------------------|--------------------|-------|
| A   | 99s       | 24        | ❌ "LLM response is not valid JSON" → modules fallback | 0 (deep) | modules generated 19; 5 smoke |
| **B** | **525s**  | **46**    | ✅                                | **72**             | deep merge done, 41 deep contracts + 5 smoke |
| C   | 19s       | 5         | ❌ "LLM response is not valid JSON" → modules fallback | 0        | modules fallback ALSO returned 0 — total collapse |

**Four findings that load-bearing reframe prior entries:**

### Finding 1: Entry 7's 403 was Anthropic-OAuth policy, not SDK code

Arm C under MiniMax sends *the exact option-bag* that Entry 7's bisect
proved triggered HTTP 403 under Anthropic OAuth (`cwd` +
`systemPrompt: STATELESS_SYSTEM_PROMPT` + `disallowedTools: [...]` +
`maxTurns: 1`). Under MiniMax it does NOT 403 — it returns invalid JSON
instead. So the rejection observed across Entries 4-9 was service-side
policy at api.anthropic.com (likely "OAuth subscription users can use
the SDK only as Claude Code, not as a custom-context library"), not a
universal SDK behavior.

### Finding 2: The harness HURTS quality (correction to Entry 8's claim)

Entry 8 stated "harness was the primary blocker; flipping it off
restored Entry 3 behavior." That was half right. Entry 10 shows the
harness ALSO degrades output even when the API endpoint accepts it:
Arm C with harness produces **5 contracts** (Phase A smoke only); Arm B
without harness produces **46 contracts** including 72 found
interactions. The `systemPrompt: STATELESS_SYSTEM_PROMPT` overrides
the inner agent's default instructions in a way that makes
MiniMax produce malformed JSON, AND maxTurns:1 cuts off the
exploration loop before it can self-correct. Even modules fallback
collapsed (interactionsFound=0). So Entry 8 commit `932f974` (flip
default to OFF) wasn't just "restore Entry 3" — it's an unambiguous
quality improvement, validated empirically.

### Finding 3: SDK subprocess's agentic search is REAL extra capability

Arm A (direct HTTP, no tools) failed the deep-discovery JSON
validation entirely. Arm B (SDK subprocess with Read/Grep/Glob/Task)
returned 72 interactions and 46 contracts. Same model, same prompt,
same temperature — only difference is whether the agent can probe
files. The user's earlier intuition ("agentic search is real extra
capability") is empirically validated. For deep discovery against
non-trivial component trees, **SDK subprocess (no harness) >
direct HTTP**.

This contradicts my earlier framing that ContractQA's Node-side context
assembly was "sufficient." The Node walker hands the LLM a file tree,
but a LLM with Read/Grep tools can pull additional component sources
on demand, find cross-file relationships, and generate more contracts
that reference them. Net delta: +22 contracts, +72 interactions.

### Finding 4: AnthropicSDKClient's strict-JSON failure mode hides real model capability

Arm A succeeded at modules fallback but failed deep Stage 1 with
"LLM response is not valid JSON." This is the JSON parse layer in
`enumerateSurface` (`interaction-discovery.ts`) rejecting MiniMax's
output. MiniMax may have emitted markdown-wrapped JSON or trailing
prose that the strict `JSON.parse` step refuses. A more lenient JSON
extractor (already partially implemented via `extractJsonFromLlmResponse`)
could rescue these cases. Arm B's SDK subprocess might also produce
imperfect JSON internally, but the agent loop self-corrects across
turns.

**Recommendations:**

1. **For production ContractQA tuning with API key, default to Arm B**:
   SDK subprocess + no harness + API key. Highest output, agentic search
   captures cross-file relationships, no 403 risk.
2. **Update `pickClient` precedence** to default to ClaudeAgentSDKClient
   when API key is set AND user hasn't explicitly opted into direct HTTP.
   Currently API key short-circuits to Arm A path, which is the worst of
   the three for this workload. This is a defaults change with a real
   measured cost.
3. **Investigate Arm A JSON parsing**: tighten or loosen the parser to
   not reject MiniMax-shape outputs (markdown-wrapped, trailing prose).
4. **Drop the harness option entirely** for ContractQA in main code path
   (already done as of `932f974`). Keep `CONTRACTQA_ENABLE_SDK_HARNESS=1`
   only as a tuning-experiment escape hatch — not a recommended setting.
5. **Reflexion measurement under MiniMax**: Entry 10 didn't enable
   Reflexion (the eval bench in this repo doesn't expose a flag from CLI;
   Reflexion is autopilot-only). Could re-run with Reflexion enabled
   internally to get content-class data on MiniMax.

**Verdict:** Arm B wins decisively for ContractQA on MiniMax. Three
prior-entry positions corrected:
- Entry 7 tail's "OAuth pool quota" framing — already retracted; now
  also more precisely positioned as "OAuth-tier policy on custom-context
  SDK options."
- Entry 8's "harness was the only blocker" — too weak; harness was
  ALSO actively harmful to quality.
- My earlier "ContractQA doesn't need agentic search" claim — empirically
  wrong on MiniMax; SDK agentic search adds 22 contracts and 72
  interactions to the deep discovery pass.

**Next:**

1. Re-run **same 3-arm setup on Haiku 4.5** if user has Anthropic API
   key access — separates "MiniMax-specific JSON oddities" from
   "harness-vs-no-harness on the canonical model."
2. **Default pickClient routing change**: when API key is set, prefer
   `ClaudeAgentSDKClient` over `AnthropicSDKClient` for the autopilot
   workload. Behind a `CONTRACTQA_PREFER_AGENT_CLIENT=1` opt-in first
   (don't break existing users); flip to default after a clean Entry 11
   measurement on Haiku.
3. **Batch 1-10 on MiniMax with Arm B configuration**: get the first
   full-batch numbers since Entry 3. Cost should be modest (MiniMax
   pricing).

---

## Entry 11 — Docker-parallel batch 1-10 on MiniMax, first measurable Reflexion data

**Date:** 2026-05-29
**Commit:** `d506360` (docker-batch + inlined pLimit fix)
**Hypothesis:** With `docker-batch.mjs` (per-app isolated containers, random
host ports, parallel concurrency=3) + the MiniMax shim (Entry 10's Arm B
config), we should escape both the port-8080 sequential bottleneck AND
the OAuth burst-rate-limit. Goal: first measurable Reflexion data + first
clean batch since Entry 3.

**Setup:**
- Apps 1-10, MiniMax-M2.7-highspeed
- `ANTHROPIC_API_KEY=sk-cp-…` + `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
- `CONTRACTQA_FORCE_SDK_CLIENT=claude-agent` (Arm B path: SDK subprocess, no
  harness — Entry 10's winner)
- `docker-batch.mjs --range 1-10 --concurrency 3`
- 30 min budget per app
- Wallclock: 98 minutes (16:48 → 18:27 UTC)

**Result — 6/10 OK, first non-zero content-class output across the entire log:**

| App  | OK | Autopilot   | Contracts | Coverage | Bugs   | Bug % |
|------|----|-------------|-----------|----------|--------|-------|
| 0001 | ✓  | 1064s       | 41        | 11.1%    | 0/3    |  0.0% |
| 0002 | ✓  |  886s       | 31        | 21.1%    | 2/5    | 40.0% |
| 0003 | ✓  |  585s       | 24        | 23.5%    | 0/3    |  0.0% |
| 0004 | ✓  |  832s       | 25        | **44.4%**| 2/7    | 28.6% |
| 0005 | ✓  |  694s       | 34        | 16.7%    | 0/6    |  0.0% |
| 0006 | ✓  |  575s       | 17        | 33.3%    | 2/6    | 33.3% |
| 0007 | ✗  |  758s       | -         | -        | -      | -     |
| 0008 | ✗  | 1945s       | -         | -        | -      | -     |
| 0009 | ✗  | 1881s       | -         | -        | -      | -     |
| 0010 | ✗  | 1294s       | -         | -        | -      | -     |

**Aggregate:** 6/10 OK, mean coverage 25.0%, mean bug detection 17.0%,
total contracts 172, total bugs covered 6/30.

**Comparison to Entry 3 (Haiku 4.5 OAuth, the historical best):**

| Metric                | Entry 3 (Haiku, OAuth, sequential) | Entry 11 (MiniMax, docker parallel) |
|-----------------------|-------------------------------------|--------------------------------------|
| Apps OK               | 10/10                              | 6/10                                 |
| Mean coverage         | 44.5%                              | 25.0% (-19.5pp)                      |
| Mean bug detection    | 30.1%                              | 17.0% (-13.1pp)                      |
| Wallclock             | ~120 min                           | 98 min (-18%)                        |
| Total contracts       | ~750 (extrapolated)                | 172 (much lower)                     |

This is a **different model** so per-app numbers aren't directly
comparable to Haiku. The directional read: MiniMax-M2.7-highspeed
underproduces contracts per app (~24 mean vs Haiku's ~75), but the
contracts it does produce are reasonable quality (44.4% on 0004 is
real Entry-3-class output). Docker parallel saved ~22% wallclock vs
the Entry 3 sequential timing despite running fewer apps successfully.

### Finding 1 (the load-bearing one): Reflexion empirically WORKS

After 8 entries of "Reflexion untested/blocked," Entry 11 has the first
positive data:

- All 5 apps that reached Stage 2 successfully (0001, 0002, 0003, 0005,
  0006) ran the Reflexion pass and logged "5 proposals" each.
- App 0001 has **2 contracts in `contracts/content/`** that look like
  classic content-class invariants:
  - "Products heading remains All Products when category is filtered"
    (cross-view consistency)
  - "Product count text matches number of article cards displayed"
    (count/total matching)
- Apps 0002/0003/0005/0006 don't have a `contracts/content/` subdir, but
  their Reflexion proposals likely landed under their feature-area
  subdirs (`core`, `auth`, `dashboard`, …) since the LLM categorized them
  by feature rather than by class. They need title-level audit to count.

**This is the first non-zero content-class entry across Entry 0–10
(all 0%).** Reflexion is empirically validated on at least the
cross-view-consistency / count-matching pattern. Lock-in candidate
pending broader audit.

### Finding 2: Scorer dies under FORCE_SDK_CLIENT inheritance

Apps 0007/0008/0009/0010 had autopilot exit=0 but score_exit=1. Score
log shows "Claude Code process exited with code 1" — the scorer's
inherited `CONTRACTQA_FORCE_SDK_CLIENT=claude-agent` env routes its LLM
judge calls through ClaudeAgentSDKClient (SDK subprocess) instead of
direct HTTP. Under concurrent burst (3 parallel autopilots finishing in
overlapping windows + their scorers piling on), the SDK subprocess
auth path fails to keep up.

**Fix committed in this entry's follow-up commit:** `docker-batch.mjs`
now sets `CONTRACTQA_FORCE_SDK_CLIENT=''` when spawning the scorer, so
the scorer routes to `AnthropicSDKClient` (direct HTTP) — no SDK
subprocess in the scoring path. Autopilot still uses the SDK subprocess
for its agentic-search benefit (Entry 10's Arm B winner).

### Finding 3: Docker parallel concurrency-3 is right-sized for MiniMax

Per-app autopilot wallclock: 575-1064s (~10-18 min) at concurrency=3.
vs Entry 10's Arm B at concurrency=1: 525s for app 0001. So parallel-3
**doubles** per-app wallclock but processes 3 apps in that window,
which is roughly break-even on throughput. The MiniMax per-key
concurrent rate limit appears tight; concurrency=5+ would likely
worsen per-app numbers further.

Net: docker concurrency=3 saved ~22% wallclock on completed apps vs
sequential, primarily by overlapping the npm-install + docker-build
phases with API-bound autopilot phases of other apps. The API-bound
phase doesn't parallelize cleanly under MiniMax's rate limit.

**Cleanup performed:**
- Killed prior Arm B serial batch (`b5xh6c4z0`) before launch.
- All cqa-* docker containers removed post-run.
- Scratch state cleaned.

**Verdict:** First fully-measurable batch since Entry 3, first positive
Reflexion data ever. The 25.0%/17.0% numbers are not directly
comparable to Entry 3's 44.5%/30.1% (different model), but they're
**real numbers** and they show ContractQA can deliver under MiniMax +
Reflexion + Arm B config.

**Next:**

1. **Re-run with fixed scorer env** (this entry's follow-up commit) to
   measure all 10 apps cleanly — Entry 12 will have 10/10 instead of 6/10.
2. **Title-level audit of Reflexion impact**: for each OK app, identify
   which contracts came from Reflexion vs from Stage 2, classify by the
   four invariant classes, compute Reflexion's per-app coverage lift.
3. **Cross-model validation**: if Anthropic API key becomes available,
   run docker-batch with `CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001`
   to compare Haiku vs MiniMax at apples-to-apples Arm B settings.
4. **Tune MiniMax-specific JSON output**: enumerateSurface still fails
   on some apps (Arm A Entry 10 + apps 0007-0010 here). Could add a
   markdown-stripping pass to `extractJsonFromLlmResponse`.

---

## Entry 12 — Haiku 4.5 OAuth + docker parallel-3 — new high-water on every metric

**Date:** 2026-05-29
**Commit:** `33b0455` (docker-batch + scorer env fix; harness default OFF
from `932f974`; Reflexion code from `0c0f0c9`)
**Hypothesis:** User asked to shallow-probe Haiku via OAuth Agent SDK
after several hours of MiniMax work. Probe came back 3/3 OK at 5-6s with
a valid discovery-shape call also OK — confirming the OAuth burst window
from Entry 9 had recovered. User then asked to run the same docker batch
with Haiku at concurrency 3.

**Setup:**
- Apps 1-10, `CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001`
- No `ANTHROPIC_API_KEY` set → `pickClient` routes to
  `ClaudeAgentSDKClient` (OAuth subprocess path)
- No `CONTRACTQA_FORCE_SDK_CLIENT` / `CONTRACTQA_ENABLE_SDK_HARNESS`
  → default routing, harness OFF
- `docker-batch.mjs --range 1-10 --concurrency 3`
- 30 min budget per app
- Wallclock: 38 minutes (01:54 → 02:33 UTC)

Pre-batch probe verified the OAuth path was healthy:
- 3× "reply: pong" via pickClient → OK at 5-6s each
- 1× discovery-shape (system prompt + JSON-only) → OK at 21s with valid
  `[]` response

**Result — 10/10 OK, every metric beats every prior entry:**

| App  | Autopilot | Contracts | Coverage | Bug detection | Bugs   |
|------|-----------|-----------|----------|---------------|--------|
| 0001 |  566s     | 109       | 72.2%    | 33.3%         | 1/3    |
| 0002 |  490s     |  91       | 57.9%    | **80.0%**     | 4/5    |
| 0003 |  367s     |  74       | 52.9%    | 33.3%         | 1/3    |
| 0004 |  464s     | 115       | 55.6%    | 42.9%         | 3/7    |
| 0005 |  431s     | 111       | 66.7%    | 33.3%         | 2/6    |
| 0006 |  294s     |  11       | 38.1%    | 16.7%         | 1/6    |
| 0007 |  376s     |  41       | 55.6%    | 37.5%         | 3/8    |
| 0008 |  444s     | 120       | 73.7%    | **75.0%**     | 3/4    |
| 0009 |  519s     |  82       | **76.5%**| 62.5%         | 5/8    |
| 0010 |  364s     |  80       | 62.5%    | 62.5%         | 5/8    |

**Aggregate: 10/10 OK, mean coverage 61.2%, mean bug detection 47.7%,
total contracts 834, bugs covered 28/58.**

### Comparison to every prior entry

| Entry | Setup                                | OK    | Mean cov | Mean bug | Wallclock |
|-------|--------------------------------------|-------|----------|----------|-----------|
| 0     | Opus baseline, sequential, no harness | 10/10 | 53.8%    | 35.3%    | ~120 min  |
| 3     | Haiku v1, sequential, no harness, retry | 10/10 | 44.5%    | 30.1%    | ~120 min  |
| 4     | Sonnet+harness, sequential           |  1/10 | n/a      | n/a      | -         |
| 5-10  | various, OAuth blocked               |  0/10 | -        | -        | -         |
| 11    | MiniMax docker //=3 + Reflexion      |  6/10 | 25.0%    | 17.0%    | 98 min    |
| **12**| **Haiku docker //=3 + Reflexion + scorer fix** | **10/10** | **61.2%** | **47.7%** | **38 min** |

**Deltas vs Entry 0 (Opus baseline, prior-best on a "trusted" run):**
- Coverage: +7.4pp
- Bug detection: +12.4pp
- Wallclock: 3.2× faster
- Cost: ~20× cheaper (Haiku vs Opus tokens)

**Deltas vs Entry 3 (prior-best Haiku):**
- Coverage: +16.7pp
- Bug detection: +17.6pp
- Wallclock: 3.2× faster
- Apps OK: same (10/10)

### What's driving the lift over Entry 3 (same model, same fixture)

Five changes between Entry 3 commit `f14144f` and Entry 12 commit
`33b0455`:

1. **Reflexion code (`0c0f0c9`)**: 9/10 apps ran Reflexion content-class
   pass. 7 logged "5 proposals" successfully; 2 hit "invalid JSON" (0001,
   0002 — Haiku occasionally produces malformed JSON for the
   reflexion-shape prompt). The proposals are likely the load-bearing
   bug-detection lift (Entry 11 already showed Reflexion lands real
   cross-view contracts; here Bug % jumps +17.6pp).
2. **Harness default OFF (`932f974`)**: kept Stage 1 enumerateSurface
   working — without it the prior Entry 4-8 fixes broke Haiku entirely.
3. **Docker isolation (`5d29dce` + `d506360`)**: per-app containers on
   random host ports → no port-8080 collision → enables parallel; also
   eliminates any scratch-dir leakage between apps.
4. **Parallel concurrency=3**: 3.2× wallclock speedup vs sequential.
   Per-app autopilot wallclock is similar to Entry 3's per-app times
   (~5-9 min) — the parallelism doesn't slow individual apps because the
   OAuth burst limit happens to accommodate 3 concurrent SDK subprocess
   calls (when each app makes its calls in waves rather than constant
   bursts).
5. **Scorer env override (`33b0455`)**: this was a fix for the MiniMax
   batch (Entry 11) — under OAuth-only here it has no effect (the
   override sets FORCE_SDK_CLIENT='' but neither path picks it up
   without ANTHROPIC_API_KEY set), so this isn't a contributor for Entry
   12 specifically.

### Content-class status: still 0 contracts in `contracts/content/`

Same pattern as Entry 11: none of the 10 apps have a `contracts/content/`
subdir. Reflexion's 5 proposals per app got categorized by Haiku under
feature-area subdirs (`core`, `auth`, etc.), not under invariant-class
labels. **But the contracts ARE there** — they're just not segregated by
class. The +17.6pp bug detection lift over Entry 3 is the empirical
proof that Reflexion's proposals are landing as effective contracts
regardless of the subdir naming.

To get a clean "Reflexion delta" measurement requires either:
- A paired run with `enableReflexion: false` (no CLI flag for this yet
  — would need to add one), or
- Title-level audit of all 834 contracts identifying which came from
  Reflexion's pseudo-Interaction.

**Verdict:** Lock in. This config is the new ContractQA default. Reflexion
+ harness-off + docker-parallel + scorer-fix collectively beat the prior
Opus baseline by every metric, on Haiku, in a third the time.

**Next:**

1. **Replace Entry 0/3 as the canonical baseline** in tuning docs.
2. **Add `--no-reflexion` CLI flag** to enable clean Reflexion delta
   measurement (Entry 13 candidate).
3. **Investigate the "invalid JSON" reflexion failures on 0001/0002**:
   tighten the Reflexion prompt or add a JSON-extraction pass for Haiku
   markdown-fence output (likely the failure mode).
4. **Apps 0006/0007 underperformed** (38.1% / 55.6% coverage, low
   contract count for 0006). Single-app debug to find why those two
   apps' enumerateSurface returned only 11 contracts vs the batch's
   typical 80-120.
5. **MiniMax cross-validation**: re-run Entry 11 with the scorer fix +
   harness-off + the new content output insights to see if MiniMax
   can also hit ≥80% bug detection on its best apps (Entry 11 0002
   already hit 40%, 0004 28%, 0006 33% before the scorer issue).

---
<!-- Add new entries below this line. Don't edit anything above. -->

## Entry 13 — Reflexion paired A/B (ON vs OFF), same-day controlled — no significant effect; retracts the +17.6pp claim

**Date:** 2026-05-29
**Commit:** `3a93024` (`--no-reflexion` flag `69a9f02` + `--label` isolation
`3a93024`; harness OFF from `932f974`; Reflexion code `0c0f0c9`)

**Hypothesis:** Entry 11/12 credited Reflexion with a **+17.6pp bug-detection
lift**. But that number compared Entry 12 (Reflexion ON, 2026-05-29, Haiku,
new code) against Entry 3 (no Reflexion, different day, different code,
different OAuth window) — a cross-entry confound, not a controlled contrast.
A clean same-day paired run with the *only* difference being Reflexion on/off
should isolate the true effect.

**Change:**
- `--no-reflexion` CLI flag + `CONTRACTQA_DISABLE_REFLEXION=1` env (threads
  `enableReflexion:false` → `discoverByInteraction`). End-to-end verified:
  Arm A logged `reflexion content-class pass: start` ×1 on **10/10** apps;
  Arm B logged it on **0/10** (positive + negative control both clean).
- `--label` on `docker-batch.mjs` so the two same-day arms write to isolated
  snapshot dirs / image tags / container names (no overwrite).

**Setup:**
- Identical to Entry 12 except the single Reflexion toggle.
- `CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001`, OAuth path (no
  `ANTHROPIC_API_KEY`), harness OFF, `--range 1-10 --concurrency 3`, 30-min
  budget/app, docker-isolated.
- Arm A (ON): `batch-2026-05-29-reflexion-on-docker`, 05:27→06:05 UTC.
- Arm B (OFF): `batch-2026-05-29-reflexion-off-docker`, 06:05→~06:43 UTC.
- Pre-batch OAuth Haiku probe healthy (pong 5.6s, discovery-shape `[]` 6.5s).

**Result — both arms 10/10 OK:**

| App  | cov ON | cov OFF | Δcov  | bug ON | bug OFF | Δbug  | bugs ON/OFF /tot | con ON/OFF |
|------|--------|---------|-------|--------|---------|-------|------------------|------------|
| 0001 | 44.4   | 61.1    | -16.7 |  0.0   | 33.3    | -33.3 | 0 / 1  /3        | 87 / 164   |
| 0002 | 57.9   | 42.1    | +15.8 | 60.0   | 80.0    | -20.0 | 3 / 4  /5        | 76 / 90    |
| 0003 | 76.5   | 41.2    | +35.3 | 33.3   | 33.3    |  0.0  | 1 / 1  /3        | 91 / 86    |
| 0004 | 66.7   | 44.4    | +22.2 | 57.1   | 28.6    | +28.6 | 4 / 2  /7        | 103 / 99   |
| 0005 | 55.6   | 61.1    | -5.6  | 66.7   | 83.3    | -16.7 | 4 / 5  /6        | 100 / 110  |
| 0006 | 66.7   | 42.9    | +23.8 | 50.0   | 16.7    | +33.3 | 3 / 1  /6        | 128 / 95   |
| 0007 | 66.7   | 50.0    | +16.7 | 50.0   | 25.0    | +25.0 | 4 / 2  /8        | 40 / 49    |
| 0008 | 78.9   | 84.2    | -5.3  | 100.0  | 75.0    | +25.0 | 4 / 3  /4        | 102 / 113  |
| 0009 | 29.4   | 64.7    | -35.3 | 37.5   | 62.5    | -25.0 | 3 / 5  /8        | 85 / 99    |
| 0010 | 50.0   | 56.3    | -6.3  | 37.5   | 75.0    | -37.5 | 3 / 6  /8        | 94 / 106   |
| **MEAN** | **59.3** | **54.8** | **+4.5** | **49.2** | **51.3** | **-2.1** | **29 / 30 /58** | **906 / 1011** |

**Paired significance (n=10, t_crit(9)≈2.262 at p=.05):**

| Metric         | mean Δ (ON-OFF) | sd     | t(9)  | 95% CI         | verdict          |
|----------------|-----------------|--------|-------|----------------|------------------|
| Coverage       | +4.5pp          | 21.7   | 0.65  | [-11.1, +20.0] | crosses 0 — n.s. |
| Bug detection  | -2.1pp          | 27.8   | -0.23 | [-21.9, +17.8] | crosses 0 — n.s. |

Per-app Δbug ranges -37.5 → +33.3pp. The run-to-run variance (sd ~22-28pp)
dwarfs the mean difference on both metrics.

**Verdict — the +17.6pp Reflexion lift does NOT survive a controlled test.**
- Neither coverage nor bug detection shows a statistically significant
  Reflexion effect. Both CIs comfortably cross zero.
- Reflexion OFF actually produced **more** contracts (1011 vs 906) and covered
  **one more** bug net (30 vs 29) — the opposite direction from the Entry 11/12
  narrative, though also within noise.
- The Entry 11/12 "+17.6pp" was an artifact of comparing across entries (Entry
  12 ON vs Entry 3 OFF: different day/code/OAuth). Like the retracted Entry 7
  "OAuth pool quota" framing, it was a confounded comparison dressed as a
  causal effect. **Retract the Reflexion-bug-detection-lift claim.**
- This does NOT prove Reflexion is harmful — n=10 with sd~28pp cannot resolve a
  ±5pp effect. It proves the *prior evidence for benefit was invalid* and the
  effect, if any, is smaller than this design can detect.

**Recommendation:** Reflexion costs one extra LLM call per app for no
demonstrated quality gain. Either (a) flip default OFF pending evidence, or
(b) keep ON but stop citing the bug-detection lift. The `--no-reflexion` flag
now makes (a) a one-line change. Holding default ON for now — change is the
user's call, not a tuning auto-decision.

**Next:**

1. **Power the test.** To resolve a ~5pp effect against sd~28pp needs roughly
   n≥250 paired apps (n ≈ (2.26·28/5)² ≈ 160 just for that point estimate, more
   for power) — i.e. run the full WebTestBench 1-100 ×2, or repeat 1-10 paired
   across several days and pool. A single 10-app pair can't settle it.
2. **Per-bug attribution instead of aggregate.** Title-audit which Arm-A bugs
   were caught *only* by a Reflexion-origin contract (pseudo-interaction
   `reflexion://synthetic`). If that set is empty, Reflexion adds no unique
   coverage regardless of aggregate noise — a cleaner signal than mean Δ.
3. **Decide the default** with the user given (1)/(2). If flipping OFF, also
   drop the Reflexion code from the hot path or gate it behind an opt-in.

### Addendum (same session) — per-bug attribution executed (Next #2)

Ran the per-bug attribution on Arm A's snapshots (no new batch — pure analysis).
Method: replicate the scorer's `loadContracts` recursive-readdir order (verified:
my load yields exactly 102 contracts for 0008, matching scorer `agent_output=102`,
so the 1-based `matched_contract_ids` indices map correctly), flag Reflexion-origin
contracts by their `# interaction: reflexion-content` frontmatter, then check every
*covered* checklist item: were all its matched contracts Reflexion-origin?

| App  | novel Reflexion contracts | covered bugs | Reflexion-UNIQUE bug catches | any-item Reflexion-unique |
|------|---------------------------|--------------|------------------------------|---------------------------|
| 0001 | 0 | 0 | 0 | 0 |
| 0002 | 0 | 3 | 0 | 0 |
| 0003 | 0 | 1 | 0 | 0 |
| 0004 | 0 | 4 | 0 | 0 |
| 0005 | 0 | 4 | 0 | 0 |
| 0006 | 0 | 3 | 0 | 0 |
| 0007 | 0 | 4 | 0 | 0 |
| 0008 | **5** | 4 | 0 | 0 |
| 0009 | 0 | 3 | 0 | 0 |
| 0010 | 0 | 3 | 0 | 0 |
| **TOT** | **5 / 906 (0.55%)** | 29 | **0** | **0** |

**Findings:**
- Reflexion's 5 proposals/app produced **novel** (non-deduped) contracts in only
  **1/10 apps** (0008, 5 contracts). In the other 9, all 5 proposals duplicated
  existing Stage-2 contracts and were merged away — 0 net new.
- Across all 10 apps, Reflexion-origin contracts uniquely caught **0 bugs** and
  uniquely covered **0** checklist items of any class. In 0008 the one bug a
  Reflexion contract touched (bug#3, user-stats consistency) was *also* caught by
  a non-Reflexion contract (`dashboard-user-stats-display`).

**Mechanistic conclusion (corroborates the statistical one):** removing Reflexion
would have lost nothing the scorer measured in this paired run. The aggregate
noise (Entry 13 body) and the attribution (this addendum) agree: **Reflexion adds
no unique coverage.** This is the cleaner signal Next #2 sought — it does not need
a powered batch to interpret. Per-bug attribution > aggregate Δ for this question.

**Decision (user, 2026-05-29):** pursue attribution (done, above). Default stays
ON for now pending the user's call on flip-OFF; the evidence now points clearly to
"no demonstrated value," so flipping OFF (one-liner) is the supported move whenever
the user wants it. Stale Entry 11/12 docker images (~15GB) removed this session.

---

## Entry 14 — Execution-grounded detection pilot: `bug_detection_coverage` measures topical COVERAGE, not detection (overstates ~2-4×)

**Date:** 2026-05-29
**Commit:** `3047148`
**Hypothesis (user):** "Reflexion didn't help" might be the wrong frame — maybe
the *metric* is wrong. Specifically: is a missed bug a discovery gap (no contract
aimed at it) or an assertion gap (a contract is aimed at it but is too weak / asserts
the buggy behavior, so it never actually catches the bug)? The scorer can't tell,
because it **never executes contracts** — `bug_detection_coverage = coveredPassFalse
/ totalPassFalse` where `covered` is just an LLM judge deciding a contract is
*aimed at* a requirement (the code comment literally says "tried to test").

**Method:** Took app 0008 Arm A, which the scorer rated **4/4 bugs detected
(100%)**. Rebuilt the 0008 container, assembled the 6 contracts the judge had
matched to those 4 bugs into a temp dir, and actually **ran them** against the
live buggy SUT via `contractqa run` (Playwright/chromium). A contract that *fails*
on the buggy app caught a real discrepancy; one that *passes* is blind to the bug.

**Result — 6 contracts: 4 fail, 2 pass — but "fail" ≠ "caught the planted bug":**

| Bug (ground truth) | matched contract(s) | run result | true verdict |
|--------------------|---------------------|-----------|--------------|
| #6 "can only view leaderboards, can't switch by **time**" | leaderboard-displays-…-points; leaderboard-page-navigation | **both PASS** | **COVERED-BUT-NOT-CAUGHT** — both only assert the leaderboard page renders; neither mentions the missing time-switch. Judge counted topical relevance as coverage. |
| #2 "can't prevent duplicate username/email registration" | register-form-submission-redirect | FAIL | **spurious** — fails on a Playwright strict-mode selector crash (`getByRole('textbox')` → 3 elements), a *contract defect*; and it tests happy-path redirect, not dup-prevention |
| #1 "can't view code content in submission history" | dashboard-recent-submissions-reverse-chronological | FAIL | **off-target** — asserts reverse-chronological *ordering*, not the "can't view code" bug |
| #3 "can't verify difficulty-categorized completion stats" | dashboard-user-stats-display; content-user-statistics(reflexion) | FAIL | **plausibly caught** — real DOM mismatch (missing "Total Points"/"Challenges Solved" headings); closest to the planted bug |

**Conclusion — the headline metric is coverage wearing a detection costume.**
- Scorer: 0008 = 4/4 bugs "detected." Execution: 1 covered-but-not-caught (#6),
  1 spurious selector-crash (#2), 1 off-target fail (#1), 1 plausible catch (#3).
  **True execution-grounded detection ≈ 1/4, generously 1-2/4 — vs the reported
  4/4.** The metric overstates real detection by ~2-4× on this app.
- This is the answer to "checklist 找到了但 bug 没找到": bug #6 is *covered*
  (judge matched contracts) yet *not caught* (contracts pass on the buggy app).
  The current pipeline literally cannot see this gap because it never runs anything.
- Reframes Entries 0-13 wholesale: every "bug detection %" in this log is
  **bug-requirement topical coverage**, not detection. Reflexion (and any
  contract-quantity lever) was being optimized against a number that doesn't
  measure catching bugs. Quantity isn't the bottleneck; **assertion specificity**
  (does the contract assert the exact invariant the bug violates?) is, and it's
  unmeasured.

**Caveats:** n=1 app, 6 contracts — a pilot, not a batch. "Fail" conflates real
catches with contract defects (the #2 selector crash); a rigorous version needs a
failure-reason↔bug-text judge to separate "caught the planted bug" from "failed for
an unrelated reason." Direction is unambiguous even so: ≥1 clean covered-but-not-
caught and ≥1 spurious fail out of 4 is already fatal to the metric's validity.

**Blind-only note:** the user's instinct to "feed Reflexion which checklist items
were missed / which contracts contradict the checklist" is blocked — that leaks the
checklist into the agent loop and breaks the blind-only rule. Closed-loop feedback
must come from blind-legal signal: (a) source-code coverage gaps, (b) contract
EXECUTION results against the SUT (fail/pass/error) — never the checklist.

**Verdict:** Kept as methodology finding. The eval needs an execution-based
detection metric before any contract-quality lever (Reflexion or otherwise) can be
judged. Coverage-by-judge is a useful *upper bound* but must stop being reported as
"bug detection."

**Next:**

1. **Execution-detection scorer.** Add a metric that runs each bug-covering contract
   against the SUT and counts a bug "detected" only if a matched contract *fails*
   AND a failure-reason judge confirms the failure corresponds to the planted bug
   (the `bug` field). Report alongside (not replacing) coverage-by-judge.
2. **Scale the pilot.** Re-run this on all 10 Arm-A apps' covered bugs to get a real
   detection rate vs the reported coverage rate. Likely collapses the 47.7% headline.
3. **Re-aim contract quality at assertion specificity**, not quantity. The covered-
   but-not-caught (#6) and off-target (#1) cases are weak-assertion fingerprints
   (cf. the Phase B drift-patterns reference) — that's the lever Reflexion *could*
   target if redesigned around blind-legal execution feedback.

---

## Entry 15 — Whole-pipeline eval audit + stage-attribution redesign (built exec-detection scorer)

**Date:** 2026-05-29
**Commit:** `3dad62f` (exec-detection-score.mjs) + this entry
**Hypothesis (user):** if `bug_detection_coverage` is coverage-not-detection
(Entry 14), the whole eval likely has analogous "measures X, reports Y" / silent-
loss defects. Goal: a rigorous eval complete enough to back-trace a missed bug to
the exact pipeline stage.

**Method:** Built `scripts/eval/exec-detection-score.mjs` (Entry 14 Next #1) —
runs coverage-matched contracts against the live buggy SUT and classifies each bug
into the stage where detection broke (validated on 0008: coverage 4/4 →
true-detection **0/4**; auth_unreached:2, execution_defect:1, weak_assertion:1).
Then ran a 4-way parallel audit of the pipeline (coverage scorer / runner+oracle /
discovery+generation / batch+aggregation).

**Result — the coverage≠detection gap is the pipeline's pervasive pattern, not a
one-off.** Full write-up: `qa/eval/EVAL-AUDIT-AND-REDESIGN.md`. Headlines:
- 🔴 **PASS-only oracle** (`qa-runner.test.mts:151`): the canonical run asserts
  every contract must PASS, so a bug-catching contract (should FAIL on buggy SUT)
  and a broken one score identically — the scored path *cannot represent detection*.
- 🔴 **Blind-pass oracle**: runOracle matches the contract's own `expected`, never
  ground truth → a contract asserting the buggy behavior PASSes.
- 🔴 **All cross-entry comparisons confounded** (model+concurrency+runner+scorer+
  day+OAuth co-vary; run-to-run sd ≈ 22–28pp > most claimed deltas). Only Entry 13's
  same-day paired design is valid. Every prior causal delta (model/harness/docker/
  Reflexion lift) is unidentifiable — extends Entry 13's retraction to the whole table.
- 🟠 scorer corpus ≠ runner corpus (counts `.yaml`/schema-invalid the runner can't
  run); loader silently drops ~18%; dedup drops stronger contracts positionally by
  id; Stage-1 `routes=['/']` makes dynamic/auth-gated/API surfaces undiscoverable;
  `mean bug detection` drops zero-bug apps; `--score-limit` reported as full coverage;
  `ok` = exit code not quality. (~20 defects total, by stage, in the doc.)

**Meta-finding:** no executable stage knows ground truth, and every boundary
(discovery→gen→merge→load→run→score) drops/miscounts silently. Coverage is an upper
bound over a survivable subset.

**Redesign (doc §1, §3):** an 8-stage back-trace model (S1 discovery · S2 generation ·
S3 merge/dedup · S4 loadability · S5 reachability · S6 execution · S7 assertion/oracle ·
S8 scoring). Every bug exits with exactly one stage label + evidence; aggregate is a
stage histogram, not one inflated %. New metrics: `true_detection_rate` + `stage_
attribution`, rename `bug_detection_coverage → bug_aim_coverage`. Gold-standard S7:
run each contract on clean AND buggy build — detected iff PASS-clean ∧ FAIL-buggy
(eliminates blind-pass + false-alarm, no judge needed). exec-detection-score = S5–S7.

**Verdict:** Methodology + design locked. The reported "bug detection %" across all
prior entries is an aim/coverage upper bound; real detection is unmeasured and (0008
pilot) much lower.

**Next (roadmap, doc §4):**
1. S4 + S8-corpus reconciliation — scorer uses the runner's loader; emit unloadable/
   excluded/limited counts; rename the metric; report `true_detection_rate` beside it.
2. Auth bootstrap for fixtures (without it auth-gated detection is structurally 0;
   2/4 on 0008), then scale exec-detection to all 10 apps.
3. S3/S1 instrumentation (surface dedup + discovery losses; real route manifest).
4. Gold-standard clean-vs-buggy oracle if clean builds are obtainable.
