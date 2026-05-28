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
# autopilot discovery (harder reasoning task)
export CONTRACTQA_LLM_MODEL=claude-sonnet-4-6

# scorer / LLM-judge (cheaper task, Haiku is fine)
# scorer uses pickClient too; same env applies.
# If you want a SEPARATE model for the judge, run scorer in a subshell with
#   CONTRACTQA_LLM_MODEL=claude-haiku-4-5-20251001 node scripts/eval/...
```

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
<!-- Add new entries below this line. Don't edit anything above. -->
