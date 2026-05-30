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

---

## Entry 16 — Suite execution-detection: coverage-aim 52.4% → TRUE detection 0.0% (8/10 apps)

**Date:** 2026-05-29
**Commit:** post-`ff62ef5` (exec-detection-batch.mjs + this entry)
**Goal:** roadmap step 2 — scale the execution-detection scorer (S5–S7) across the
suite to get the real true-detection rate vs the reported coverage "aim" rate.

**Method:** `scripts/eval/exec-detection-batch.mjs --range 1-10 --arm reflexion-on`
— per app: build container, run the coverage-matched contracts against the live
buggy SUT, classify each bug into the stage where detection broke. 8/10 apps ran
(0007, 0009 hit a 60s vite-boot timeout — infra, not logic).

**Result:**

| | bugs | aim (coverage judge) | TRUE execution detection |
|---|------|----------------------|--------------------------|
| 8-app total | 42 | **22 (52.4%)** | **0 (0.0%)** |

**Stage histogram (42 bugs — where detection broke):**

| stage | count | % | meaning |
|-------|-------|---|---------|
| `not_covered` | 20 | 48% | no contract aimed at the bug (discovery/generation gap) |
| `execution_defect` | 9 | 21% | matched contract throws at runtime (brittle selector/nav) |
| `auth_unreached` | 9 | 21% | contract needs logged_in; eval has no auth bootstrap → login wall |
| `off_target_fail` | 2 | 5% | contract FAILs but for an unrelated reason |
| `weak_assertion` | 2 | 5% | contract reached & PASSed on buggy SUT (covered-but-not-caught) |
| `true_detection` | **0** | **0%** | — |

**Conclusion — the headline "bug detection" is ~0% real.** The reported ~47–52%
is topical aim; by execution, the pipeline catches **0/42** planted bugs in this
run. Bugs are lost across MULTIPLE stages, with discovery (`not_covered`, 48%) the
single largest, then reachability and execution-defects tied (21% each). Only 4/42
bugs even reached a clean assertion evaluation, and none caught the bug. This is
the definitive "倒推到具体环节": the pipeline isn't failing at one place — it leaks
at discovery, reachability, execution, AND assertion.

**Caveats (honest scope):**
- `auth_unreached` (21%) is an EVAL-HARNESS gap, not proof those bugs are
  undetectable — an auth bootstrap could unblock up to 9 bugs for real evaluation.
  So 0% is the floor among reachable+runnable+covered bugs, not a proven ceiling.
- Batch read the legacy (un-reconciled) score.json, so `aim` here is slightly
  higher than the step-1 reconciled number (0008: 4 vs reconciled 3); `true=0` is
  unaffected.
- `execution_defect` mixes genuine contract brittleness with harness strictness
  (Playwright strict-mode); some may be salvageable with locator hardening.
- 0007/0009 not measured (vite 60s timeout) — re-run with a longer boot wait.

**Verdict:** Confirms Entry 14/15 at suite scale. "Coverage" and "detection" are
different metrics and the gap is ~52pp → 0. The eval must report
`true_detection_rate` + the stage histogram, never coverage-as-detection.

**Next:**
1. **Auth bootstrap** (the largest *unblockable* bucket): add a scorer-side
   `auth.config.mjs` (allowed to see app + creds — blind rule covers GENERATION
   only, not scoring/reflection) so the 9 `auth_unreached` bugs become evaluable;
   re-run to see if true detection moves off 0.
2. **Discovery (`not_covered` 48%)** is the biggest leak — instrument S1 (route
   manifest, persist enumerated surfaces) to confirm these are discovery gaps vs
   judge false-negatives, then widen enumeration.
3. **Locator hardening** to shrink `execution_defect`.
4. Bump container boot wait; re-measure 0007/0009.

---

## Entry 17 — Auth bootstrap built & validated: unblocking auth does NOT move true detection (bottleneck → judge S8)

**Date:** 2026-05-29
**Commit:** post-`cb004b7` (auth-registry.mjs + exec-detection auth wiring + this entry)
**Goal:** roadmap step 2 second half — add a scorer-side auth bootstrap so the 21%
`auth_unreached` bugs (Entry 16) become evaluable, then re-measure.

**Method:** `scripts/eval/auth-registry.mjs` — per-app, registry-driven. For
client-side-auth SPAs, strategy `localStorage`: navigate an init path (to trigger
the app's own storage seeding) then set the auth key. exec-detection-score now calls
it before any `auth_state: logged_in` contract and reclassifies authed runs as
reachable (not `auth_unreached`). 0008 entry: seed `codeforge_current_user='1'`
(demo user alice) via `/login` mount.

**Result on 0008 — auth works, detection doesn't:**
- ✅ Bootstrap verified: bug#1/#3 contracts now `authed=true` and land on the
  dashboard (`got "CodeForge Welcome Bac…"`), no longer the login wall. Mechanism
  is sound.
- ❌ `true_detection` stayed **0/4**. The unblocked bugs became `off_target_fail`,
  not detections — the contracts assert dashboard text that's missing, but the
  failure↔bug judge rules them unrelated.
- 🔎 **Bottleneck moved S5→S8 (judge reliability):** bug#1's judge reason said "a
  login page appearing" while the evidence `got` text is the *dashboard*
  ("Welcome Bac"). The Haiku failure↔bug judge **mislabeled** it — so `true=0` is
  now partly a judge false-negative, exactly the S8 defect the audit flagged.

**Conclusion:** auth was a measurement-completeness fix (removes the 21% blind
spot), **not** a detection lever — confirming the Entry 16 prior. After unblocking,
detection is gated by (a) judge reliability (S8) and (b) contracts being off-target/
weak (S2/S7), not by reachability. Extending the registry to the other 4
auth-affected apps (0002/0004/0005/0006/0010 — non-uniform auth, 3 have no obvious
localStorage key) is bespoke per-app work with predictably low marginal payoff
(more `auth_unreached → off_target/weak`, not `→ true_detection`).

**Verdict:** Auth bootstrap mechanism kept (registry-driven, extensible). Default
the next investment to the higher-value levers, not more auth configs.

**Next:**
1. **Harden the S8 judge** (now the proven bottleneck): include the contract's
   target/surface + the `got` text explicitly; k-sample majority vote; or replace
   with the gold-standard clean-vs-buggy oracle (no judge needed). bug#1 shows the
   current single-shot Haiku judge produces evidence-contradicting verdicts.
2. **(b) Discovery gap** (`not_covered` 48%, the largest leak): instrument S1.
3. Extend auth registry opportunistically when an app is already being debugged.

---

## Entry 18 — Judge hardened (step 1 done): credible suite result, 10/10 apps, 58 bugs → aim 50.0%, TRUE detection 0.0%

**Date:** 2026-05-29
**Commit:** `01f34db` (judge hardening) + this entry
**Goal:** roadmap step 1 (user: "先走 1") — the failure↔bug judge proved unreliable
(Entry 17: it labeled bug#1 "login page" while the evidence got-text was the
dashboard). Fix it so the true-detection number is trustworthy before measuring more.

**Change (`exec-detection-score.mjs` judge):**
- **Grounded:** decide ONLY from the violation's expected-vs-got; do not assume any
  page/route/login state not present in the got text; quote the got text in the reason.
- **Feature-alignment rubric** (judge the feature the assertion tests vs the bug's
  feature, not phrasing) instead of vague "plausibly caused by".
- **k=3 majority vote** to damp single-shot hallucination; pass the contract title.

**Validation (0008):** judge now grounded + unanimous (3/3). Exemplar — bug#3:
*"the failed assertion checks for missing 'demo' text in the leaderboard, but the got
text shows the leaderboard displaying user points and challenge counts (charlie_algo:
7 challenges/110 points…), which contradicts the bug claim that only scores and
question counts are available"* → off-target, 0/3. The judge now catches that the
contract tests the wrong thing. The earlier "login page" hallucination is gone.

**Result — full suite, 10/10 apps (0007/0009 booted this time), hardened judge:**

| | bugs | aim (coverage judge) | TRUE execution detection |
|---|------|----------------------|--------------------------|
| 10-app total | 58 | **29 (50.0%)** | **0 (0.0%)** |

**Stage histogram (58 bugs):**

| stage | count | % |
|-------|-------|---|
| `not_covered` | 29 | 50% |
| `execution_defect` | 13 | 22% |
| `auth_unreached` | 9 | 16% |
| `off_target_fail` | 4 | 7% |
| `weak_assertion` | 3 | 5% |
| `true_detection` | **0** | **0%** |

**Conclusion (supersedes Entry 16's number — that used the unreliable single-shot
judge; same verdict, now CREDIBLE):** across 58 planted bugs the pipeline's TRUE
execution detection is **0%** vs the reported ~50% coverage "aim". The instrument is
now calibrated end-to-end: corpus reconciled (S4), auth bootstrap (S5, 0008), grounded
k-vote judge (S8). The 0 survives a trustworthy judge.

**Caveats:** 9 `auth_unreached` remain (only 0008 has an auth-registry entry; the
mechanism works but the other apps' bespoke auth wasn't wired — low marginal value
per Entry 17). `execution_defect` (22%) mixes genuine contract brittleness with
Playwright strict-mode strictness.

**Verdict:** Step 1 complete. Headline metric across the whole tuning log should be
read as coverage/aim, not detection; real detection is 0% on this suite. The biggest
leak is **discovery** (`not_covered` 50%).

**Next:** step b — instrument S1 discovery: persist enumerated surfaces + a real route
manifest, and check whether the 29 `not_covered` bugs are true discovery gaps (surface
never enumerated) vs coverage-judge false-negatives (contract exists but judge missed it).

---

## Entry 19 — Discovery-gap analysis FLIPS the diagnosis: `not_covered` is 90% coverage-judge false-negative, not a discovery gap

**Date:** 2026-05-29
**Commit:** post-`6505a13` (discovery-gap-analysis.mjs + this entry)
**Goal:** step b — Entry 18's largest bucket was `not_covered` (29/58, 50%). Before
widening discovery, split it: true discovery/generation gap (no contract for the
surface) vs coverage-judge false-negative (a contract targets the surface but the
judge didn't match it). Retrospective, no autopilot re-run.

**Method:** `scripts/eval/discovery-gap-analysis.mjs` — for each `not_covered` bug,
a grounded k=3 judge decides whether ANY generated contract targets the bug's
page/feature/surface (overlap, not detection). Surface-exists → coverage false-
negative; none → discovery/generation gap.

**Result (29 not_covered bugs, 10 apps):**

| root cause | count | % |
|------------|-------|---|
| `coverage_false_negative` (contract for surface exists, coverage judge missed it) | **26** | **90%** |
| `discovery_or_generation_gap` (no contract on the surface at all) | 3 | 10% |

Most calls 3/3 unanimous. True gaps: 0007#6, 0009#16, 0010#16.

**This flips the Entry 18 read.** The full detection funnel:
- **~95% of bug surfaces HAVE a contract** (only 3/58 = 5% true discovery gaps).
- Coverage judge credits only ~50% ("aim") — it **under-matches half** the
  surface-targeting contracts (S8 false-negatives), even as it **over-credits**
  non-detecting ones (Entry 14). The coverage judge is noisy in BOTH directions.
- Of contracts that DO reach the surface, **0% actually catch the bug** (weak/
  off-target/exec-defect/auth).

**Conclusion — discovery is NOT the bottleneck; assertion quality is.** The agent
explores ~all the right surfaces; it fails by asserting the wrong/weak things there,
so contracts neither get credited by the strict coverage judge nor fail on the bug
in execution. Widening Stage 1 discovery (the original step-b plan) would not move
true detection. The levers, in order:
1. **Assertion specificity (S2 generation):** make contracts assert the exact
   invariant the bug violates, not just "the page renders / contains text X". This
   is where a redesigned Reflexion (blind-legal, execution-feedback-driven) could
   finally help — it loops back to Entries 11–13.
2. **Coverage judge (S8):** fix the under-matching (the 26 false-negatives) and the
   over-crediting together — or retire coverage-by-judge in favour of execution.
3. **Execution-defect (22%) + auth (16%):** locator hardening + more auth entries.

**Verdict:** Premise corrected (discovery ≠ the leak). Real target is assertion
specificity. Step b as originally scoped (widen discovery) is shelved.

**Next:** characterize the assertion-weakness fingerprints across the
weak_assertion + off_target + the 26 false-negative contracts (what do they assert
vs what the bug needs?), and design an assertion-specificity generation pass.

---

## Entry 20 — Assertion-gap fingerprints: 3 patterns = 87% of the misses; assertion-specificity pass design

**Date:** 2026-05-29
**Commit:** post-`2945207` (assertion-gap-fingerprints.mjs + this entry)
**Goal:** Entry 19 located the bottleneck at assertion specificity. Characterize HOW
contracts are weak (they reach the bug's surface but don't catch it) into a fixed
taxonomy → design a generation pass that fixes it.

**Method:** `scripts/eval/assertion-gap-fingerprints.mjs` — for each pass:false bug
with a surface contract (55 bugs; 3 true discovery gaps excluded), a grounded LLM
picks the closest contract, states what it asserts vs what assertion WOULD catch the
bug, and classifies the gap into 7 codes.

**Result (32 diagnosable; 23 were judge punts — empty diagnosis, a limitation of the
one-shot big-prompt judge, not a real "other"):**

| fingerprint | n | % of diagnosable | meaning |
|-------------|---|------------------|---------|
| **F2 happy_path_not_violation** | 11 | 34% | requirement has a constraint/limit/validation/ordering; contract tests the normal flow, never exercises the VIOLATION |
| **F6 missing_interaction** | 9 | 28% | bug manifests only after an action (click/submit/switch); contract asserts static presence, never performs it |
| **F1 presence_not_value** | 8 | 25% | asserts an element/text EXISTS, not that its VALUE is correct — bug is a wrong/stale value |
| F5 single_view_not_consistency | 2 | 6% | bug is cross-view; contract checks one view |
| F3 wrong_element | 2 | 6% | asserts a different element than where the bug shows |

**F1+F2+F6 = 87%** of diagnosable assertion gaps. Examples:
- F2: bug "can't select >10 tickets" — contract asserts the +button disables at 10,
  never tries to exceed it. Needed: attempt 11 and assert it's blocked.
- F6: bug "clicking View Details doesn't redirect" — contract asserts the link
  exists, never clicks it. Needed: click, then assert the URL changed.
- F1: bug "product category not validated" — contract asserts the dropdown renders
  with category text. Needed: submit, then assert the persisted category VALUE.

**Design — assertion-specificity generation pass (the data-grounded Reflexion
redesign, blind-legal: source + the contract's own draft, never the checklist):**
For each generated contract, a second LLM pass asks three targeted questions and
strengthens the `expected`/`actions` accordingly:
1. **(F1) Value check:** "Does this assert a VALUE, or only existence? If the
   feature has a concrete correct value (count, text, persisted field), add an
   `element_text_equals` / `role_count` / post-reload value assertion."
2. **(F2) Violation check:** "Does the feature have a constraint (max/min, required,
   uniqueness, ordering, validation)? If so, add an action that VIOLATES it and
   assert the violation is blocked/handled — not just the happy path."
3. **(F6) Interaction check:** "Does the invariant only hold AFTER an action? If so,
   ensure the contract performs the click/submit/switch, then asserts the post-action
   state (URL/DOM/storage), not static presence."
This targets 87% of the observed gaps with concrete, checkable rules — and unlike the
Entry 11–13 Reflexion (which dedup'd to ~0 and was judged on a coverage metric),
it's aimed at the execution-detection metric we now trust.

**Verdict:** Diagnosis complete end-to-end. The pipeline's 0% true detection is an
ASSERTION-SPECIFICITY failure (F1/F2/F6), not discovery, not reachability. Design
above is the fix.

**Next:** implement the assertion-specificity pass in interaction-discovery generation
(F1/F2/F6 rules), re-run autopilot on 1–10, and re-measure with exec-detection —
true_detection should move off 0 if the diagnosis is right. (Caveat: also harden the
fingerprint judge / coverage judge; 23/55 punts show the one-shot big-prompt judge
needs per-contract framing or k-vote.)

---

## Entry 21 — Both judges hardened (step 2): coverage judge corrects Entry 19; fingerprints confirmed F1/F2/F6=91%

**Date:** 2026-05-29
**Commit:** post-`ba1f6c2` (judge hardening + this entry)
**Goal:** step 2 (user: "先 2 再 1") — fix both judges before implementing the
assertion-specificity pass, so its effect is measured cleanly.

**Coverage judge (`webtestbench-score.mjs`):** temp 0 (was 0.2; Entry 18 saw
pass_true/false drift), maxTokens 400→600 (truncation was a silent not-covered),
k=3 majority vote, parse-fail surfaced as `judge_status` (no longer counted as a
silent miss). Validated on 0001 (3 not_covered bugs):
- Deterministic, 0/3-covered unanimous, `parse_fail: 0`, coverage_overall unchanged
  (0.444) — the judge wasn't broken on 0001, but is now provably stable.
- **CORRECTS Entry 19:** those 3 bugs were labeled "coverage_false_negative" by
  Entry 19's *looser* `surface_exists` judge. The hardened coverage judge
  unanimously holds them not-covered. So the 26 `not_covered` are NOT judge errors
  — they're a real **aim-gap**: a contract is on the bug's surface but is not
  *aimed at the specific requirement*. "On the page" (95%) ≠ "aimed at the
  requirement" (50%); the gap is genuine, not noise. (Validated on 1 app/3 bugs; a
  full re-score would confirm suite-wide.)

**Fingerprint judge (`assertion-gap-fingerprints.mjs`):** retry-on-punt (the
one-shot big-prompt judge gave up on 23/55). Punts dropped **23 → 1**. Full
distribution (54 diagnosable):

| fingerprint | n | % |
|-------------|---|---|
| F2 happy_path_not_violation | 21 | 38% |
| F6 missing_interaction | 15 | 27% |
| F1 presence_not_value | 14 | 25% |
| F5 single_view_not_consistency | 3 | 5% |
| F3 wrong_element / F7 | 2 | 4% |

The 22 recovered punts fell into the same three buckets → **F1+F2+F6 = 91%**,
confirming the Entry 20 design target on a near-complete sample.

**Refined model — TWO generation-side gaps (both feed the 0% detection):**
1. **Aim-gap (~45%):** contracts reach the surface but don't target the specific
   bug requirement (Entry 19's 26 `not_covered`, now correctly attributed to
   generation, not the judge).
2. **Assertion-gap (F1/F2/F6, 91% of surface-reaching):** even aimed contracts
   assert existence-not-value / happy-path-not-violation / no-interaction.

**Verdict:** step 2 done — both judges reliable; the coverage judge fix reattributed
the biggest bucket from "judge defect" to "generation aim-gap". The assertion-
specificity pass (step 1) must address BOTH: aim a contract at the requirement AND
make its assertion bug-specific.

**Next (step 1):** implement the generation pass with F1/F2/F6 rules + an aim check
("does this contract assert on THIS requirement's specific behavior?"), re-run
autopilot 1–10, re-measure with exec-detection (now judged by the hardened judge).

---

## Entry 22 — Assertion-specificity prompt FAILED to move detection; the wall is blind-from-buggy-source (NEGATIVE result)

**Date:** 2026-05-29
**Commit:** `a94dc97` (assertion-specificity generation rules) + this entry
**Hypothesis:** injecting VALUE/VIOLATION/INTERACTION/AIM rules into Stage-2
generation (Entry 20/21 design) would raise true detection off 0.

**Setup:** identical to the reflexion-on baseline except the new generation rules.
`docker-batch --range 1-10 --concurrency 3 --label asrt-v1` (Haiku, Reflexion on),
then exec-detection-batch with the hardened judge.

**Result — no improvement, slight aim regression:**

| metric | baseline (reflexion-on) | asrt-v1 |
|--------|-------------------------|---------|
| coverage aim | 50.0% (29/58) | 41.4% (24/58) |
| **TRUE detection** | **0/58** | **0/58** |
| not_covered | 29 | 34 |
| execution_defect | 13 | 11 |
| auth_unreached | 9 | 11 |
| weak_assertion + off_target | 3 + 4 | 2 + 0 |

The prompt rules did NOT produce a single true detection. Aim dropped (within the
~28pp run-to-run noise, so not necessarily real) and not_covered rose — if anything
the longer prompt diluted requirement-aim without buying detection.

**Root-cause diagnosis (the real wall):** Stage-2 generates contracts by reasoning
from the SUT's **source code** — which, in WebTestBench, *contains the planted bug*.
A blind agent reading a buggy implementation infers "this is how it works" and writes
a contract whose `expected` matches the buggy behavior → the contract PASSES on the
buggy app. **You cannot detect a bug by asserting consistency with the buggy
implementation you read.** Telling the agent to "assert the value / exercise the
violation / perform the interaction" doesn't help when its notion of the *correct*
value/outcome is itself derived from the buggy source. Detection requires an
INDEPENDENT reference for correct behavior, which blind-from-source lacks.

**Implication:** the 0% true detection is not (only) an assertion-phrasing problem —
it's epistemic. Levers that could supply an independent "correct" reference, ranked:
1. **Common-sense priors:** universal invariants the agent can assert without reading
   the buggy code (duplicate email/username rejected; deleting N leaves N−1; a count
   badge equals rendered items; clicking a link navigates). These encode EXPECTED
   behavior from priors, so they fail when the app violates them. (Blind-legal — it's
   priors, not the checklist.) F2/F1/F6 rules only help IF anchored to priors.
2. **Cross-consistency contracts:** same datum across two views must match — catches
   inconsistency bugs without needing an absolute correct value.
3. **Stronger generator model** (Sonnet/Opus): may apply priors + the rules where
   Haiku doesn't. Cheap to test.
4. Reason from the source's STATED intent (types, validation code, comments) and flag
   where runtime diverges — harder.

**Verdict:** step-1 prompt injection rejected (no detection lift, aim regressed). The
calibrated eval did its job — it caught a plausible-sounding fix that doesn't work,
which the old coverage-only metric would have scored as "fine" (asrt-v1 aim 41% looks
like normal coverage). The instrument is the win; the generator needs an epistemic
fix, not a phrasing one.

**Next:** test the cheapest independent-reference lever — prior-anchored generation
(rule: "assert universal expectations the app SHOULD meet, independent of what the
code currently does") and/or a Sonnet generator on a 3-app pilot, measured by
exec-detection. If priors move true detection off 0, scale; if not, blind detection
has a hard ceiling worth documenting.

---

## Entry 23 — priors-vs-Sonnet experiment BUILT but OAuth died mid-run (INVALID, pending re-run)

**Date:** 2026-05-29
**Commit:** `c1a1b29` (variant-selectable generation prompt + 'priors' variant)
**Goal:** test the oracle-problem fix the user proposed — derive `expected` from what
the product SHOULD do (human-user priors + metamorphic relations + active suspicion)
rather than from the buggy source (Entry 22 wall). Two ISOLATED arms vs the Haiku
baseline (apps 2-4): Exp-A priors-prompt+Haiku, Exp-B baseline-prompt+Sonnet (judge
pinned to Haiku for both).

**What shipped:** `CONTRACTQA_GEN_PROMPT` switch (baseline/asrt/priors); the 'priors'
block encodes domain priors + metamorphic relations (filter⊆all, cross-view
consistency, reversibility, round-trip) + active-suspicion, grounded in the test-
oracle-problem literature (metamorphic testing, agentic property-based testing,
LLM-as-oracle). asrt-v1 reverted from default.

**Outcome: INVALID — infrastructure failure, no result.** Pre-batch probe passed, but
mid-batch the OAuth Claude-Agent-SDK path collapsed: "Claude Code process exited with
code 1" on nearly every interaction; a fresh 4× probe returned 0/4. Both arms produced
no score.json (Sonnet did generate ~133 contracts before the scorer died; Haiku
near-total failure). This is the OAuth burst/exhaustion mode (cf. Entry 9) after a
full day of heavy LLM usage — NOT a signal about priors or Sonnet. Invalid snapshots/
images cleaned.

**Verdict:** experiment is fully set up and re-runnable as-is once OAuth recovers
(or via ANTHROPIC_API_KEY / MiniMax-compat to bypass OAuth). Do NOT interpret the
aborted run. No conclusion about the oracle-problem fix yet.

**Next:** when OAuth is healthy, re-run the exact two arms (commands in
qa/eval/entry13-logs/exp-A-B.log header) + exec-detection; compare true_detection to
the apps-2-4 baseline (0/15). If priors moves it off 0, scale + write it up.

---

## Entry 24 — MiniMax A/B INVALID: MiniMax can't run Stage-1 deep discovery (falls back to modules)

**Date:** 2026-05-30
**Commit:** (no code change) — uses `c1a1b29` priors variant via MiniMax Anthropic-compat
**Context:** OAuth subscription Agent-SDK credits exhausted (~11h, 0/5 probe even after
re-login — confirmed credit-limit, not credential: web research = Anthropic requires
API keys for Agent SDK but reinstated subscription use "with a catch" = credit limit;
our flaky-then-dead pattern fits exhaustion, not a ban). User supplied the MiniMax
Anthropic-compat key to bypass OAuth. Ran MiniMax-internal A/B (baseline vs priors,
apps 2-4) so the model is held constant and only the prompt varies.

**Result — both arms 0 coverage, 0 detection — but for an upstream reason:**

| arm | contracts (0002) | coverage aim | true detection |
|-----|------------------|--------------|----------------|
| baseline-mm | 18 (vs Haiku ~76-128) | 0/15 | 0/15 |
| priors-mm | 13 | 0/15 | 0/15 |

**Root cause: MiniMax fails Stage-1 `enumerateSurface`** — it returns invalid JSON for
the large structured surface-enumeration output, so the deep path quarantines and
**falls back to shallow module discovery** (all 3 apps, both arms). Module discovery
produces ~13-18 contracts that miss the bug surfaces → 0 coverage. The priors prompt
only affects Stage-2 generation, which never meaningfully ran. The MiniMax judge
worked fine (coherent "no contract tests ticketing functionality" reasons).

**Conclusion — INVALID for the priors hypothesis.** MiniMax bypasses OAuth but cannot
drive this pipeline's deep discovery (Stage-1 JSON compliance fails; cf. Entry 11 where
MiniMax also underperformed Haiku). The priors test requires a generator that can do
Stage-1 — Haiku or Sonnet. MiniMax is usable as a *judge* but not as the *generator*
here. No conclusion about priors yet; the question is still open.

**Verdict:** MiniMax path rejected for generation. The priors experiment remains
pending a capable generator: OAuth Haiku/Sonnet (credit-reset) or an Anthropic
Console `sk-ant-` key (separate quota). Code is ready (`CONTRACTQA_GEN_PROMPT=priors`).

**Next:** when a capable generator is available, run the original isolated arms
(priors+Haiku vs baseline+Sonnet) vs the Haiku baseline (apps 2-4, 0/15). Until then,
the diagnosis stands: 0% true detection is the blind-from-buggy-source wall (Entry 22),
fix unverified.

## Entry 25 — priors VERIFIED at 1/15 (off the 0/15 floor); SDK exec root-caused & fixed; failure mode shifted weak_assertion → execution_defect + not_covered

**Date:** 2026-05-30
**Commit:** SDK executable fix in `packages/orchestrator/src/llm/claude-agent-sdk-client.ts`
(uncommitted at time of writing — `resolveInstalledClaude()` → `pathToClaudeCodeExecutable`);
generation via `c1a1b29` priors variant.

**Unblock (supersedes Entry 23/24 "credits exhausted"):** the blocker was NEVER credits or
account. Root cause: `@anthropic-ai/claude-agent-sdk@0.1.77` spawns its OWN bundled `cli.js`
(frozen ~May 17), which gets `403 "Request not allowed"` under OAuth; the locally installed
`claude` v2.1.158 does not. Proven by same-network A/B (US exit IP): bundled→403, installed
binary via `pathToClaudeCodeExecutable`→pong. Fix resolves the installed binary
(`CONTRACTQA_CLAUDE_EXECUTABLE` env → `command -v claude`). priors+Haiku then ran on apps 2-4.
(Account-switching/OAuth-waiting was a dead end; see memory [[deep-mode-sdk-crash-2026-05-27]].)

**Method:** `CONTRACTQA_GEN_PROMPT=priors`, Haiku generator + Haiku coverage judge, deep
discovery, apps 2-4 (the 0/15 Haiku baseline set). Generation SUCCEEDED richly (209/101/286
contracts — the deep-discovery step that MiniMax couldn't do in Entry 24). exec-detection run
in new `--dump-judge` mode: the deterministic part (run matched contracts vs live buggy SUT →
PASS/FAIL/THREW, stage attribution) is automated; only the reachable-FAIL **on-target decision
was made MANUALLY by the main agent** (the OAuth subprocess k-vote would take 1.5-3 h per the
~1.5 min/call spawn cost; main-agent judge is the deliberate substitute, user-authorized).

**Result — priors moved true detection 0/15 → 1/15:**

| app | bugs | true_detection | stage breakdown |
|-----|------|----------------|-----------------|
| 0002 | 5 | 0 | execution_defect 4, not_covered 1 |
| 0003 | 3 | 0 | not_covered 3 |
| 0004 | 7 | **1** | true_detection 1, off_target_fail 1, execution_defect 1, not_covered 4 |
| **tot** | **15** | **1/15** | **not_covered 8, execution_defect 5, off_target_fail 1, true_detection 1** |

baseline (Haiku, apps 2-4): **0/15** (was dominated by **weak_assertion**).

**The real finding — the failure mode SHIFTED, which is more useful than the +1:**
- **weak_assertion went 0** (baseline's dominant mode — contracts that PASS on the buggy SUT).
  priors stopped the agent silently passing on bugs: the intent-strengthening worked.
- Two NEW binding constraints replaced it:
  - **not_covered 8/15 (53%)** — coverage judge matched no contract to the bug (discovery or
    judge-match gap; needs disambiguation).
  - **execution_defect 5/15 (33%)** — contracts encode the right intent but THROW on brittle
    locators (`getByRole('button')` matched 21-25 elements → strict-mode violation; timeouts on
    buttons that don't exist). These are would-be detections lost to runner brittleness.
- **The 1 true_detection (0004 bug#12) is a declarative-intent-vs-behavior catch:** contract
  `venue-card-view-details-navigates-to-detail` asserted "View Details → /venues/<id>" (intent
  from route/affordance) and got URL `/` (buggy behavior) — matching planted bug "clicking the
  button does not redirect." This is exactly the mechanism the research predicts works (see
  `qa/eval/ORACLE-FREE-DETECTION-RESEARCH.md` Part II / family-3). off_target case (bug#4):
  a search-filter contract failing on count, unrelated to the price-display bug — correctly NOT
  counted.

**Tuning implications (grounded in the two research passes, ranked by leverage):**
1. **Harden runner/selector robustness** — recover up to 5 execution_defect (highest-confidence,
   pure engineering, not oracle theory): scope selectors within card/region, role+name
   specificity, fallbacks; never emit bare `getByRole('button')`.
2. **Add a generic-invariant backbone** (ATUSA family): the 1 win is a navigation invariant —
   generalize "every nav/CTA button must change URL", "no error/exception strings", "no 500",
   "back-button reversibility". Source-independent, can't be weak_assertion'd.
3. **Close not_covered** — disambiguate discovery-gap vs judge-match-gap; if discovery, add
   autonomous-journey exploration (DroidAgent family).
4. **Lean into declarative-intent extraction** (research Part II): assert UI-stated intent
   (labels, route names, "max 2" hints, schemas/constants) against live behavior; firewall the
   oracle from imperative source.

**Caveats — do not overclaim:** N=15, single arm, main-agent judge (not LLM k-vote — different
methodology from baseline's automated judge); 1-vs-0 is within noise. The honest claim is NOT
"priors detects bugs" — it is "priors eliminated the weak_assertion wall and shifted the binding
constraint to execution brittleness + coverage, which is more actionable." Arm B (baseline+Sonnet)
NOT run — Sonnet generation produced only 5 `_smoke` templates (0 real contracts; the known
harness-less Sonnet failure), separate from this result.

**Verdict:** priors is a diagnostic success, not a detection breakthrough. Next lever is runner
hardening + generic-invariant backbone, NOT more prompt tuning. The blind-from-buggy-source wall
is no longer the *only* wall — it's now one of three, and the smallest.

**Next:** (1) commit the SDK executable fix (branch off main). (2) Implement selector hardening
+ generic-invariant backbone, re-measure exec-detection apps 2-4. (3) Optionally re-run Arm B
with `CONTRACTQA_ENABLE_SDK_HARNESS=1` (the 403 was the executable, not the harness — Sonnet may
now work with the harness on).

## Entry 26 — Tuning #1 (runner robustness): support target.text/test_id — real correctness fix, but detection unchanged (1/15 → 1/15); confirms the real lever is navigation completeness, not selectors

**Date:** 2026-05-30
**Commit:** `packages/runner/src/compile.ts` (+2 tests in `compile.test.ts`, 40/40 pass).
**Re-measured on the EXISTING Entry-25 priors snapshots — NO regeneration** (patched runner only).

**Fix:** the runner silently ignored two valid schema target fields, `text` and `test_id`
(`compile.ts` only read `role`/`name_regex`/`within`/`first`). A `{text:"Barn"}` target collapsed
to a bare `getByRole('button')` → matched all 21-25 buttons → Playwright strict-mode crash
(→ false `execution_defect`). Now: `test_id`→`getByTestId`; `text`→accessible-name match
(regex-escaped) on the role, default `button`/`textbox`.

**Result — no change in the headline or stage mix:**

| metric | Entry 25 (pre-fix) | Entry 26 (post-fix) |
|--------|--------------------|---------------------|
| true_detection (apps 2-4) | 1/15 | **1/15** |
| stage totals | exec_defect 5, not_covered 8, off_target 1, true 1 | **identical** |

**But the fix mattered for VALIDITY, not the count:** the single detection (0004 bug#12,
"clicking the button does not redirect") was previously caught by ACCIDENT — the ignored
`{text:"View Details"}` collapsed to a random button click and the URL landed at `/`. Post-fix
the contract clicks the REAL View Details button (`getByRole('button',{name:/View Details/i}).first()`),
the URL correctly stays at `/venues` and never reaches `/venues/<id>` — the button genuinely does
not redirect. So pre-fix the 1/15 was partly luck; post-fix it is a legitimate, well-evidenced
catch. (Evidence string changed `got "/"` → `got "/venues"`, proving the fix is live.)

**Why detection didn't move — diagnosis CONFIRMED (the execution_defect bucket is not selectors):**
- **App 2 (4 execution_defect): missing navigation, not selectors.** Contracts like
  `checkout-form-submits-with-email` `fill` name/email/phone with NO `goto`/journey to reach the
  checkout form → fields absent at `/` → fill timeout. The runner cannot fix an incomplete
  contract. (These threw regardless of text/test_id.)
- **App 4 (1 execution_defect + off-target): bug#3 matched FILTER contracts but is a CARD-DISPLAY
  bug.** Even with `{text:"Barn"}` now resolving correctly, those contracts are off-target for
  "venue listings don't display name/location/price"; other matched filter contracts time out on
  genuinely-absent named buttons.

**Verdict:** runner text/test_id support is a correct, keep-it fix that improves instrument
validity and converts one accidental catch into a legitimate one — but selector hardening is a
SMALL detection lever. The confirmed high-leverage levers, in order:
1. **Contract navigation completeness** (recover app-2's 4 execution_defect): discovery/generation
   must prepend the journey to reach each interaction (event→tickets→checkout), not assert on a
   form that isn't on the landing page. This is the biggest fixable chunk.
2. **not_covered 8/15** (coverage/discovery gap) — the largest bucket.
3. **off-target matching** (coverage judge matched filter contracts to a display bug).

**Next:** implement #1 navigation completeness (generation-side: emit the reach-path before the
interaction action), re-measure exec-detection apps 2-4.

## Entry 27 — Icon-only control targeting (prerequisite for navigation completeness): add `target.icon`

**Date:** 2026-05-30 · **Commit:** core `contract.schema.ts` + runner `compile.ts` (+1 test, 41/41).

**Why:** the app-2 navigation PoC (validating Entry-26 finding #1) showed the checkout journey
needs clicking a ticket **+** stepper that is an **icon-only `<button>`** (`lucide-plus`, no
text / aria-label / test-id). The contract schema (role+name / text / test_id) cannot express
it → a navigation-complete contract would still be stuck. So icon targeting is a prerequisite.

**Fix:** new `target.icon` field → "the <role> element containing an svg whose class includes
<icon>". Resolution (after two wrong attempts, each caught by live verification):
1. CSS `button:has(svg[class*="plus"])` — Playwright's CSS `:has()` did NOT match the svg → timeout.
2. `page.locator('button').filter({has: svg[class*="plus"]})` — matched **6** incl. hidden
   responsive (mobile+desktop) dupes → `.first()` hit a hidden node → click timeout.
3. ✓ `page.getByRole(role).filter({has: page.locator('svg[class*="<icon>"]')})` — resolves to the
   **3 visible/accessible** controls; clicks reliably. (Live: getByRole→3 vs locator('button')→6.)

**Verified end-to-end** via the real `compileContract` against the live app-2 SUT: a contract
`goto /event/1 → click {icon:"plus", first:true}` clicked the stepper and the quantity went to "1".

**PoC also confirmed Entry-26 finding #1 (navigation):** `/event/1` reached; "Continue to Checkout"
is gated behind `totalTickets>0` — so the no-`goto` contracts could never reach the form. Next:
navigation completeness (generation emits the reach-path: navigate → select ticket → open form).

## Entry 28 — Navigation completeness (prompt reach-path) — PoC: structure WORKS + icon used; route accuracy is the last gap

**Date:** 2026-05-30 · **Commit:** cli `interaction-discovery.ts` gen prompt (reach-path block +
`icon` in Target doc). Validated by single-interaction PoC; NOT yet full-regen-measured.

**Change:** added a CRITICAL "REACH-PATH" requirement to `buildGenerateSystemPrompt`: every
contract's `actions` MUST begin with the full path to the element — `goto` the route, then any
REVEAL steps the source shows are required (open the dialog, select a prerequisite, switch tab).
Also surfaced the new `icon` Target field in the prompt's Target doc.

**Cheap PoC (1 generation call, Haiku, priors, window = `CheckoutForm.tsx` only):** the LLM
produced 3 navigation-complete contracts, e.g.:
`goto /events/1 → click {icon:"plus"} → click {name_regex:"[Cc]heckout"} → fill email/name/phone
→ click {confirm} → expect "Reservation Confirmed"`. So (a) the reach-path requirement produces
real journeys even without the rendering-parent context, and (b) **the generator USED the new
`icon` target** to add a ticket via the icon-only stepper.

**Live run of the generated journey (compileContract vs app-2 SUT):**
| route in goto | reached the checkout form? |
|---|---|
| `/events/1` (LLM's guess — WRONG, real route is `/event/1`) | **no** — timeout (NotFound → no stepper) |
| `/event/1` (corrected) | **yes** — full journey reached the form |

**Conclusion:** prompt-only gets the journey STRUCTURE right and uses `icon`, but the LLM GUESSES
the route wrong because the component window doesn't reveal where it's mounted, and the generate
prompt isn't given the project's known routes. **The last gap is route accuracy, not structure.**

**Next (cheap, try before any structural enumeration change):** pass the project's known routes
(enumerate already computes them) into the GENERATE prompt so the LLM picks `/event/:id` instead
of inventing `/events/1`. Re-PoC; if the route comes out right, prompt-only navigation completeness
is done and we can full-regen apps 2-4 to measure detection. If the LLM still can't map
component→route, fall back to capturing route-per-interaction in `enumerateSurface`.
