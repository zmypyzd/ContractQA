# ContractQA tuning log

Record of tuning experiments against the WebTestBench eval set (buggy-source web apps).

**Pruned 2026-05-31.** The SDK/OAuth infrastructure saga (old Entries 2, 4–9, 11, 12, 23, 24) was collapsed into "Infrastructure lessons" below, and the coverage-era numbers that Entry 14 later invalidated (Entries 0–13) were compressed to their durable findings. Nothing is lost — full history is in git.

## How to read

One entry per experiment: **Date · Commit · Hypothesis · Change · Setup · Result · Verdict · Next.**

New entries: append at the end. If a later entry overturns an earlier one, say so in the later entry (don't silently rewrite a result). This log was append-only until the 2026-05-31 prune; dead infra-debugging and invalidated coverage numbers were removed and are recoverable from git.

## Model selection

ContractQA picks an LLM via `pickClient()`.

| Env var | Effect |
|---|---|
| `CONTRACTQA_LLM_MODEL`   | model id for autopilot (the generator) |
| `CONTRACTQA_JUDGE_MODEL` | model id for the scorer judge (falls back to `CONTRACTQA_LLM_MODEL`) |
| `CONTRACTQA_CLAUDE_EXECUTABLE` | path to the installed `claude` binary — **required under OAuth**; the SDK's bundled `cli.js` 403s (see Infrastructure lessons) |

Current tuning default: **Haiku 4.5 generator + Haiku judge**, deep discovery, routed through the installed `claude` binary (not the SDK's bundled cli.js). Sonnet/Opus are stronger generators but were historically unusable on the OAuth SDK path — re-test only with the installed-binary fix (Entry 25).

Valid IDs: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` (long-form `claude-…-YYYYMMDD` also works).

---

## Entry 0 — baseline (deep mode), 2026-05-28

Deep discovery default (vs modules): 7.4× more contracts and 2.5× coverage head-to-head on app 0001. Suite 1–10: 22/58 bugs "covered". **Historical anchor only** — every "coverage"/"bug detection" number in Entries 0–13 is topical *aim*, not detection (proven in Entry 14), and all cross-entry deltas are confounded (Entry 15).

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

## Entry 3 — retry-with-backoff shipped, 2026-05-28

`generateWithBackoff` (3× exponential backoff on 429/503/5xx/SDK-exit/conn-errors) wrapped autopilot Stage 1+2 and the scorer judge; restored 10/10 batch completion after transient SDK failures. The era's coverage/detection numbers are invalidated (Entry 14/15) — the durable artifact is the retry wrapper itself, still in the hot path.

---

## 🔧 Infrastructure lessons (resolved — collapses old Entries 2, 4–9, 11, 12, 23, 24)

A long 2026-05-28→30 saga chasing `Claude Code process exited with code 1` / HTTP 403 under OAuth. Several intermediate diagnoses ("transient crash", "Sonnet rate-limit ceiling", "shared OAuth session-quota") were **wrong and are retracted**. The durable lessons:

- **Root cause + fix (Entry 25):** `@anthropic-ai/claude-agent-sdk@0.1.77` spawns its OWN bundled `cli.js` (frozen ~May 17) which gets `403 "Request not allowed"` under OAuth; the locally-installed `claude` binary does not. Fix: resolve the installed binary via `pathToClaudeCodeExecutable` (`CONTRACTQA_CLAUDE_EXECUTABLE` / `command -v claude`). No API key needed. Memory: [[reference_deep_mode_sdk_crash]].
- **Harness options hurt twice:** passing `cwd` / `systemPrompt` / `disallowedTools` to `query()` both (a) 403s under OAuth (server-side *option-validation*, proven by bisect — not quota) and (b) degrades output even where accepted (MiniMax: 5 vs 46 contracts). Harness default is OFF.
- **SDK subprocess agentic search is real capability:** with Read/Grep/Glob the agent finds +72 interactions / +22 contracts vs direct-HTTP on deep discovery. So for Stage-1: SDK subprocess (no harness) > direct HTTP.
- **MiniMax can't drive Stage-1 deep discovery** — returns invalid JSON for the large surface-enumeration output → falls back to shallow modules → ~0 coverage. Usable as a *judge*, not as the *generator* here.
- **Methodology that would have saved weeks:** (1) bisect an option-bag before theorizing about state — A/B/C-OK + D/E/F-FAIL within seconds disproves "quota". (2) Only same-day paired arms are valid; cross-entry deltas co-vary model+concurrency+runner+day+OAuth (run-to-run sd ≈ 22–28pp), so every cross-entry causal claim in Entries 0–13 is unidentifiable.

---

## Entry 10 — MiniMax 3-arm: two durable findings, 2026-05-29

Cross-provider A/B (direct-HTTP vs SDK-no-harness vs SDK-with-harness) on app 0001:

- **Harness HURTS quality:** harness arm = 5 contracts (smoke only); no-harness = 46 contracts / 72 interactions. (Also the first cross-provider proof that the 403 was Anthropic-OAuth *policy*, not SDK code — MiniMax accepts the harness shape without 403.)
- **Agentic search is real:** SDK subprocess (Read/Grep/Glob) ≫ direct HTTP on deep discovery (+22 contracts, +72 interactions, same model/prompt). Direct HTTP failed Stage-1 JSON validation entirely.

Locked in: API-key / MiniMax path → SDK subprocess, harness OFF. (Both findings also live in Infrastructure lessons above.)

---

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

## Entry 19 — discovery is NOT the bottleneck; assertion quality is, 2026-05-29

Split Entry 18's 29 `not_covered` bugs: only **3/58 (5%) are true discovery gaps** — ~95% of bug surfaces already HAVE a contract. The agent explores the right surfaces; it fails by asserting weak/wrong things there.

**Partially corrected by Entry 21:** Entry 19's looser `surface_exists` judge first labeled 26 bugs "coverage-judge false-negative"; the hardened coverage judge (Entry 21) shows they are a real **aim-gap** ("on the page" ≠ "aimed at the requirement"), not judge error. Durable conclusion (survives the correction): **discovery is not the leak — generation aim + assertion specificity is.** Widening Stage-1 discovery is shelved.

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

## Entry 27–29 — Navigation completeness: icon targeting + reach-path + known routes, 2026-05-30

Three PoCs that make generated contracts actually arrive at the bug's surface (app-2's checkout journey is gated behind ticket selection, so no-`goto` contracts could never reach the form):

- **`target.icon`** (core `contract.schema.ts` + runner `compile.ts`): targets icon-only `<button>`s (e.g. a lucide `plus` stepper with no text/aria/test-id). Correct resolution after two wrong tries: `getByRole(role).filter({has: page.locator('svg[class*="<icon>"]')})` → the 3 visible controls, not the 6 incl. hidden responsive dupes. Verified live: click stepper → quantity "1".
- **Reach-path prompt** (cli `interaction-discovery.ts`): every contract's `actions` must begin with the full path to the element (goto route + any reveal steps the source shows are required). PoC produced real journeys and USED `{icon:"plus"}`. Remaining gap: the LLM guessed the route wrong (`/events/1` vs real `/event/1`) because the component window doesn't reveal its mount.
- **Known-routes → generate prompt:** thread the project's real routes (derived generically from enumeration, `[...new Set(interactions.map(i=>i.route))]`) into the generate prompt. Anti-overfit verified: app-4 (never hand-examined) correctly picked `/venues` from its own route list. Route accuracy closed.

Outcome measured in Entry 30: `execution_defect` 5→2 (the fix works) but `true_detection` unchanged at 1/15.

## Entry 30 — Full regen with navigation completeness: execution_defect 5→2 (fix works) but true_detection UNCHANGED 1/15 (wall not broken)

**Date:** 2026-05-30 · label `priors-h-nav` (apps 2-4, priors+Haiku, reach-path+icon+routes).
Manual-judge exec-detection (dump-mode).

| metric (apps 2-4) | priors-h (E26) | priors-h-nav (E30) |
|---|---|---|
| **true_detection** | **1/15** | **1/15** (unchanged) |
| execution_defect | 5 | **2** down |
| not_covered | 8 | 11 up |
| off_target_fail / true | 1 / 1 | 1 / 1 |

**Reading:** the nav/icon/route work did exactly what it was built for — `execution_defect` halved
(5→2): contracts now reach gated surfaces (checkout) and the generator emits real journeys using
`{icon:"plus"}` + correct routes. But **detection did NOT move** — recovered bugs landed in
`not_covered`, not `true_detection`; `weak_assertion` stayed 0. The one catch is again the
intent-vs-behavior gap (0004 bug#12: View Details doesn't redirect). Caveat: fresh generation,
N=15, single sample — the not_covered rise (8→11) is partly generation variance.

**Conclusion (confirms the wall analysis):** navigation completeness is NECESSARY-not-sufficient.
It removes a *reachability* confound and de-noises the buckets, but does not touch the **oracle** —
assertions are still generated from the running buggy app, so they don't encode correct behavior.
The blind-from-buggy-source wall stands at ~1/15; selector/nav tuning has hit its ceiling.

**Decision (user):** PAUSE the in-agent oracle-fix line (generic invariants / metamorphic /
declarative-intent). PIVOT to a clean-vs-buggy **differential oracle** via WebTestPilot as the
primary eval set ([[reference_external_eval_datasets]]) — Task A (adopt + run), then Task C (swap
scoring to F2P: FAIL-on-buggy ∧ PASS-on-clean). The CLEAN run is the correct reference, so the
agent never infers correct behavior from buggy source — structurally past the wall.

**WebTestPilot orientation (parallel):** cloned to
`/Users/zmy/intership/qa-eval-fixtures/WebTestPilot`. Test case = `name`+`setup_function`+`steps[]`;
each step has `action`/`expectation`/`ground_truth` (Playwright assertion, isomorphic to our
contract `expected`). **Bug = runtime JS DOM mutation** (`benchmark/<app>/bugs/*.js`:
`isConditionMet`/`onConditionMet`), toggled by `baselines/bug_injector.py` merging into
`bug_injector.js` — app SOURCE stays clean (clean = no injection, buggy = injected). Scoring in
`baselines/evaluate.py`. 4 heavy real apps via Docker Compose (`webapps/`, needs `uv`+`docker-compose`,
app images + mysql/redis/nginx). Because bugs are runtime-injected, the differential oracle measures
REAL detection without blind-source contamination.

## Entry 31 — Task A: WebTestPilot brought up + differential oracle VALIDATED end-to-end (bookstack)

**Date:** 2026-05-31 · WebTestPilot at `/Users/zmy/intership/qa-eval-fixtures/WebTestPilot`.

**Bring-up (4 heavy Docker-Compose apps, sequential):**
| app | port | status |
|---|---|---|
| indico | 8080 | ❌ FAILED — "not ready after 60s" (heaviest app: DB migrate + celery; 60s wait too short, or compose error masked by the `>/dev/null \| tee` pattern). Retry with longer wait. |
| bookstack | 8081 | ✅ up + seeded |
| invoiceninja | 8082 | ✅ up + seeded |
| prestashop | 8083 | ⏳ finishing |

Cross-platform fix applied: `webapps/start_app.sh` seed used GNU `date -d "yesterday"` → patched to
`date -v-1d` (BSD/macOS) with GNU fallback, else prestashop/bookstack seed aborts under `set -e`.

**Differential oracle VALIDATED (bookstack, `count_recently_created_books`):** replicated
`bug_injector.py` in Node Playwright (merge bug's isConditionMet/onConditionMet into
`bug_injector.js`, inject via `addInitScript`), logged in (admin@admin.com/password), and ran the
consistency assertion "no phantom book in Recently Created Books":
- **clean** → phantom count 0 (assertion PASSES)
- **buggy** (injected) → phantom count 1, fake "Custom Book Title" appears (assertion FAILS)
- ⇒ **TP = FAIL-on-buggy ∧ PASS-on-clean.** This is the differential oracle that structurally
  escapes the blind-from-buggy-source wall: the CLEAN run is the correct reference; the agent
  never infers correct behavior from buggy source.

**Integration learnings:** (1) bug triggers are **test-case-page-specific** — this bug fires on the
user PROFILE page (`/user/admin`, `h2#recent-pages`), NOT home (home shows different "Recently
Updated Pages" markup). So a faithful run needs the per-test navigation to reach each bug's trigger
(their runner / our agent provides it). (2) Bug selectors are DOM/version-coupled — keep the
pinned `webapps/` images. (3) The Node-side injection replica works, so we can run the differential
with OUR runner without their Python agent.

**Next:** Task C — adopt F2P scoring (`baselines/evaluate.py`口径: TP fail-on-buggy ∧ pass-on-clean,
FP fail-on-clean, FN pass-on-buggy) and design how ContractQA generates contracts → runs them
clean/buggy → scores F2P. Retry indico with a longer readiness wait.

## Entry 32 — STRATEGY PIVOT: WebTestPilot demoted; un-freeze the oracle line; method = declarative-intent-from-buggy-source

**Date:** 2026-05-31 · cli `interaction-discovery.ts` — added `CONTRACTQA_GEN_PROMPT=intent` variant.

**User's decisive critique:** WebTestPilot has **no substantive effect** on our core problem. Its
bugs are RUNTIME JS injections, so the **source stays clean** — an agent generating from clean
source trivially produces correct contracts; it never faces our actual wall ("infer correct intent
from a BUGGY product"). Clean-vs-buggy differential is only a SCORING tool (real-dev analog =
baseline/last-good version for regression testing); it does not make a blind agent detect. Agreed.

**Decision:** (1) demote WebTestPilot to a SECONDARY regression/runner-robustness sanity set (it
also validated our Node bug-injector replica + F2P harness works — Entry 31, not wasted). (2)
**UN-FREEZE the in-agent oracle line as primary.** (3) Keep measuring on our buggy-SOURCE
WebTestBench via exec-detection.

**Grounding diagnostic (app-2 source) — the pivotal finding:** for our buggy apps the DECLARATIVE
intent is often CLEAN in source; the bug lives in the IMPERATIVE layer.
- **bug#9 (no confirmation toast):** `CheckoutForm.handleSubmit` literally calls
  `toast({title:'Reservation Confirmed!'})` (line 57, reached). Intent = clean & in source →
  assertable. The SAME handler also `navigate('/')` (line 64). **The wall bites only if the agent
  mirrors the imperative `navigate('/')` → asserts url=/ (buggy app also does this → weak_assertion).
  Asserting the DECLARATIVE toast string → catches the bug.** Same source, two layers; the layer you
  assert decides detect-vs-miss.
- **bug#10 (>10 cap):** `const maxQuantity = Math.min(ticket.quantity, 10)` — the `10` constant +
  the "N tickets available" text are declarative signals to triangulate against.
- **bug#12 (no phone-format validation):** source only has `required` (non-empty); the format rule
  is genuinely ABSENT → declarative extraction can't recover it → needs a domain prior.

**Reframed wall statement:** the wall is NOT "you read buggy source" — it is "you mirrored the
buggy IMPERATIVE behavior." Reading the source's DECLARATIVE intent layer (string literals,
constants, schemas/types, enums, labels/ARIA/placeholders, route names) recovers correct intent
FROM a buggy product, no clean version needed.

**`intent` prompt variant (built):** directs the generator to (a) assert declared intent signals,
(b) explicitly NOT mirror imperative behavior (the `navigate("/")` trap), (c) triangulate across
signals, (d) fall back to a domain prior when intent is absent from source. Two legs: declarative
extraction (Part II, primary) + domain priors (Part I family-3, fallback).

**Next:** cheap PoC (gen one contract for bug#9 checkout-submit with `intent` vs `priors` — does
`intent` assert the toast string vs the imperative url?), then exec-detection on apps 2-4 if promising.

**PoC result (intent vs priors, bug#9 checkout-submit):** BOTH variants generated the
declarative-intent contract (`contains_text: ["Reservation Confirmed!", "have been reserved"]`) AND
a separate imperative `url: ^/$` contract. So: (a) the toast-intent assertion IS produced — the
declarative path is viable; (b) `intent` ≈ `priors` on this interaction and did NOT suppress the
imperative url contract (the "avoid the trap" instruction only partially followed); (c) **key
implication — generation is likely NOT the bug#9 bottleneck** (the right contract is already
generated under priors). The 0-detection must come from coverage/reachability OR from bug#9 not
actually manifesting as a missing toast at runtime (source HAS the reached `toast()` call).
**Decisive next check (cheap, before any full regen): run the toast contract against the LIVE buggy
app-2 — does "Reservation Confirmed!" actually fail to appear (bug real → detection) or appear
(bug not here → my grounding example was wrong)?** Don't invest in `intent` regen until this is known.

**DECISIVE RUNTIME CHECK — my grounding example was WRONG:** drove the full checkout journey on
the live buggy app-2 (goto /event/1 → add ticket → Continue to Checkout → fill → Confirm) →
**"Reservation Confirmed!" toast DOES appear** (count 2; "have been reserved" also visible; URL → /).
So bug#9 does NOT manifest as a missing toast — a toast-intent contract would correctly PASS (no
detection, no false alarm). **Methodological lesson:** we've been reasoning about detectability from
checklist+source WITHOUT verifying bugs actually MANIFEST at runtime. Part of the stubborn low
true-detection may be bugs that don't observably deviate (or deviate differently than the checklist
says), NOT only the oracle wall. **Before any more oracle/prompt tuning, empirically audit which
app bugs actually manifest at runtime** (drive each bug's flow, observe deviation vs intent) to get
a trustworthy ground truth. Tuning detection methods against bugs that don't manifest is wasted.

## Entry 33 — Direction locked: codebase-intent (NOT instruction) + observation-gated tiered grounding + multi-oracle redundancy

**Date:** 2026-05-31 · design decision (from `5-25/webtest` reference study + user direction).

**Studied `/Users/zmy/intership/5-25/webtest`** (a WebTester/codegen impl on the SAME friedrichor
WebTestBench). Its method: intent from the **developer `instruction`** (clean spec) + **live-app
exploration** (Playwright-MCP observes real routes/elements) → checklist → per-category test scripts
→ execute. It never reads source, so it sidesteps the wall — BUT via the instruction.

**User decision (firm):**
- **REJECT instruction-based intent.** The goal is the harder one: **infer correct product intent
  from the CODEBASE alone** (no instruction crutch). So the `priors`/`intent` declarative-extraction
  line is NOT wasted — keep optimizing it. (I over-pivoted to the reference's instruction approach;
  retracted.)
- The reference's REUSABLE idea for us = **exploration-based grounding**, not its intent source.

**Tiered grounding (B-axis: element-targeting + reachability), the CRITICAL refinement:**
- Naive design "static-first, escalate LOW-CONFIDENCE to exploration" is BROKEN — static can be
  **confidently WRONG** (e.g. it guessed route `/events/1`), and self-assessed confidence can't
  detect its own errors → silent miss. **Drop confidence as the gate.**
- **Gate escalation on OBSERVED reality, not predicted confidence:** static-ground → RUN the
  contract on the live app → if it can't resolve (element not found / 404 / timeout =
  `execution_defect`) → that's the objective signal static grounding was wrong → escalate to
  exploration & reground. (Reality judges. This would have caught `/events/1`, which failed live;
  confidence-gating would not.) `execution_defect` becomes the escalation trigger, not a dead end.

**Two distinct "miss" types — do not conflate:**
| miss | cause | defense |
|---|---|---|
| grounding-wrong (can't reach/find) | wrong route/selector | **observation gate** → throws → escalate to explore |
| intent-wrong (reached, but asserts buggy behavior as OK) | the blind wall | **multi-oracle redundancy**, NOT confidence |

**Multi-oracle redundancy (A-axis defense against confident-wrong intent):** per interaction emit
SEVERAL independent oracles — declarative-intent (constants/strings/schemas) + metamorphic
(add↔remove, reversibility, conservation) + generic invariants (nav must navigate, no error strings,
no 500). **A bug is caught if ANY oracle FAILs on buggy.** No single confident-wrong guess gates
detection. (Research: triangulate / multi-modal / loop-until-dry.) Plus honest observation-based
verification, not shallow text checks (the bug#9 lesson).

**One-line invariant:** static-first only to save exploration cost; correctness is NEVER decided by
self-confidence — only by observed reality (grounding) and oracle redundancy (intent).

**PoC design (next):** demonstrate redundancy catches what a single static-intent oracle misses, on
a VERIFIED-manifesting bug. Candidate: app-2 bug#10 (`maxQuantity = Math.min(ticket.quantity, 10)`,
a ≤10 ticket cap). A declarative oracle that reads the `10` constant encodes "max 10" → PASSES on
buggy → MISS; a CONSISTENCY oracle ("can select up to the displayed 'N tickets available'") FAILS on
buggy when N>10 → CATCH. First verify bug#10 actually manifests (a ticket with availability >10), then
show oracle-A-misses / oracle-B-catches on the live app.

**PoC RESULT (app-2 bug#10, live):** `/event/1` shows "500 tickets available"; the stepper caps
`max_selectable=10` (blocked). Two codebase-derivable oracles:
- **Oracle A — declarative constant** (`Math.min(qty,10)` → "max 10"): `PASS (miss)` — the buggy app
  honors 10, so reading the constant as intent ENCODES the bug → misses. (The wall, in miniature.)
- **Oracle B — consistency** ("selectable up to the displayed availability"): `FAIL (catch)` — "500
  available" vs capped-at-10 is an inconsistency = the bug; never trusted the buggy constant.
- **REDUNDANCY_CATCHES = true.** Validated: a single declarative oracle misses when the bug lives in
  the very signal it reads; a CROSS-SIGNAL consistency oracle (displayed value vs actual behavior)
  catches it. So the agent must emit MULTIPLE oracle types per interaction and prioritize cross-signal
  consistency/metamorphic relations over single-constant assertions.

**Implementation implication (next):** extend generation so each interaction yields a *set* of
independent oracles — (1) declarative-intent, (2) **cross-signal consistency** (displayed count/limit/
total vs rendered/selectable reality), (3) metamorphic (add↔remove, reversibility), (4) generic
invariants — and count a bug detected if ANY fires. Then measure exec-detection on apps 2-4 with
observation-gated escalation for grounding failures. Do NOT let a single constant-reading oracle be
the sole assertion.

**PoC-2 (prompt-only multi-oracle, ticket stepper interaction) — NEGATIVE, wall at generation:**
upgraded `intent` prompt to demand a SET of oracles + "assert the UI-DISPLAYED value, NOT the code
constant (the constant may be the bug)". The agent STILL did not generate the cross-signal
consistency oracle; it produced 3 stepper-mechanics contracts, one literally *"Plus disables when
reaching availability cap or 10-ticket limit"* — i.e. it read `Math.min(qty,10)` and ENCODED the
10-cap as expected (PASS on buggy → miss), even conflating availability with the buggy 10. (Good:
the new `icon` target WAS used.) **Conclusion: prompt-only instruction can't stop the LLM anchoring
on the buggy imperative line when it's in the code window — the wall bites at generation.** A
prompt is too weak; need a STRUCTURAL mechanism:
  (A) FIREWALL the generator from imperative logic — feed it declarative signals + the displayed-
      value bindings (`{ticket.quantity} tickets available`) + UI structure, but strip the imperative
      handlers (`Math.min`, disabled-conditions) so there is nothing to mirror; or
  (B) TEMPLATE-INSTANTIATED consistency oracles — programmatically detect displayed count/limit/total
      bindings and emit a fixed "interaction must reach the displayed value" contract (ATUSA-style
      generic backbone), not LLM-freeform.
Next: prototype (A) or (B) — structural cross-signal consistency, since prompting alone fails.

**B PROTOTYPE — WORKS (`scripts/eval/consistency-oracles.mjs`):** template-instantiated, LLM-free
cross-signal consistency oracle. Template `displayed-limit-vs-stepper`: find a displayed
availability/stock count N next to a +/- stepper; drive the +; if it caps BELOW min(N,15) → flag.
On live buggy app-2 `/event/1`: **3/3 violations** — steppers cap at 10 while UI displays 500 / 100 /
20 available. **Caught bug#10 deterministically, never reading the buggy `Math.min(qty,10)` constant**
→ immune to the source-anchoring that made the LLM miss (PoC-2). This realizes the ATUSA-style generic
invariant/consistency backbone. Caveats: (1) coverage = template-catalog breadth (this one template
only covers the stepper-vs-availability class); (2) FP risk if a legit "max N per order" is intended —
templates must stay conservative. **Next: grow the template catalog (count == rendered rows, shown
total == Σ items, "showing N of M" == rendered, value-shown-in-two-places match), then run the
consistency layer across apps 2-4 alongside LLM contracts and measure added true detections.**

**SWEEP RESULT (2 templates × apps 2-4, 12 routes):** app-2 `/event/1` → 3 violations (bug#10, real);
apps 3 & 4 → **0**. **Zero false positives anywhere** (conservative templates safe, incl. un-tuned
apps 3/4). But count-vs-rendered grounded NOWHERE (apps don't expose `role=article/listitem`
uniformly → skipped). **Net: high precision, ~zero recall beyond bug#10.** Bottleneck = generic
DETECTION: a pure-static template only fires on the exact structural pattern it hardcodes (lucide
steppers, specific ARIA roles); per [[feedback_no_overfit_generalize]] we must NOT bolt on narrow
per-app detectors to juice apps 3/4.

**Synthesis / next direction — split IDENTIFICATION from CHECKING:** the wall-immune part is the
deterministic relation CHECK (displayed value vs reality — never trusts a buggy constant). The part
that needs generalization is IDENTIFYING which two signals should be consistent (this count ↔ that
collection; this total ↔ those items). Use the LLM/exploration for IDENTIFICATION only — "value X at
locator A should relate (==,>=,⊆) to reality B (rendered count / Σ / selectable max)" — and emit a
parameterized consistency assertion the runner checks DETERMINISTICALLY. The LLM never asserts a
(possibly buggy) value; it only proposes WHICH cross-checks to run. Combines LLM generalization
(detection across diverse markup) with source-anchor-proof verdicts (wall defense). Needs a new
relational assertion type (`expected.consistency: {signalA, relation, signalB}`) in the runner.
That is the next build.

## Entry 34 — Built `expected.dom.consistency` relational assertion (LLM-identifies / runner-checks); agent generates it

**Date:** 2026-05-31 · core schema + oracle `dom-classifier.ts` (+4 unit tests, 47/47) + cli generate prompt.

Implements the Entry-33 synthesis: a relational assertion comparing TWO runtime-observed signals,
never a code constant. `expected.dom.consistency: [{ left, relation: eq|lte|gte|lt|gt, right }]`
where each Signal ∈ { count: Target | number_in: Target | sum_of: Target } (count of matches /
first number in matched text / sum of numbers across matches). The oracle reads both from the live
DOM snapshot (`dom.elements`) and checks the relation; if EITHER signal can't be grounded it SKIPS
(conservative — no false positive). Unit-verified both ways + skip + sum_of.

**The LLM-identifies / runner-checks split WORKS end-to-end:** with the `intent` prompt surfacing
`consistency`, the agent (Haiku) GENERATED — for the app-4 venues list — exactly:
`{ left: number_in{text:"Showing"}, relation: eq, right: count{role:article} }`
("displayed venue count must match rendered card count"). It IDENTIFIED which two signals should
agree and emitted the relation WITHOUT hardcoding a (possibly buggy) value; the runner will verify
deterministically → source-anchor-proof. This is generalizable (mechanism-level, per
[[feedback_no_overfit_generalize]]) — works on the un-tuned app-4.

Two consistency layers now exist: (a) `consistency-oracles.mjs` static templates (interaction-capable,
catches the stepper class / bug#10); (b) `expected.dom.consistency` (snapshot count/number/sum,
LLM-generated). Both check deterministically; bug caught if ANY fires.

**Next: measure RECALL on apps 2-4** — regenerate with `CONTRACTQA_GEN_PROMPT=intent` (now emits
consistency) + run the static template layer, then exec-detection, and report the true-detection
increment vs priors 1/15. Increment depends on how many apps-2-4 bugs are count/total/limit
inconsistencies (snapshot- or interaction-observable); report honestly which classes it adds.

## Entry 35 — Recall measure (intent + consistency, apps 2-4): true_detection still 1/15; consistency added 0; bottleneck shifted to COVERAGE + GROUNDING

**Date:** 2026-05-31 · label `intent-h` (apps 2-4, `CONTRACTQA_GEN_PROMPT=intent`, manual-judge exec-det).

| metric (apps 2-4) | priors-h | priors-h-nav | **intent-h** |
|---|---|---|---|
| exec-det true_detection | 1/15 | 1/15 | **1/15** |
| stage totals | nc8 ed5 ot1 t1 | nc11 ed2 ot1 t1 | **nc11 ed1 ot2 t1** |

**The one detection (0004 bug#12, View Details no-redirect) is a url/intent-gap catch — NOT a
consistency assertion.** Consistency assertions added **ZERO** exec-det detections: apps 2-4 simply
don't have the snapshot count/total/value-inconsistency bug class, and the consistency contracts that
WERE generated grounded to null (conservative skip → correct, no FP). The static template layer
separately catches app-2 bug#10 (stepper cap, interaction-based — exec-det's snapshot consistency
can't express "select up to N"). Union of both layers = 2 distinct bugs (bug#10, bug#12); net-new
from the whole consistency effort over priors = just bug#10 (via the template).

**Honest plateau finding:** across priors → nav-completeness → icon/text targeting → intent →
consistency, exec-det true_detection has stayed ~1/15. Each addition is individually SOUND and
generalizable, but recall hasn't moved because the binding constraint is no longer the oracle:
- **not_covered = 11/15** (dominant): the coverage judge matched NO contract to the bug — the agent
  isn't producing a contract that targets that bug's surface.
- **grounding failures** ("no element matched target" — app-3 bug#9 email field, app-4 search box):
  contracts whose locators don't resolve on the live app → can't test anything.
So the frontier has shifted from INTENT (oracle) to **COVERAGE (generate a contract that targets each
bug surface) + GROUNDING (locators that actually resolve)**. The consistency/oracle machinery is built
and wall-proof, but it can only fire where a contract exists, reaches, and the bug is of its class.

**Implication for next lever (was deferred): the observation-gated exploration / Tier-2 grounding is
now the highest-value work** — explore the live app to (a) discover the real surfaces (raise coverage)
and (b) ground locators in observed elements (kill the "no element matched" misses). Also revisit
whether some apps-2-4 bugs manifest at all (bug#9 toast precedent). Oracle tuning has hit diminishing
returns at ~1/15; coverage+grounding is the lever.

## Entry 36 — Grounding step 1: live-app exploration reveals "no element matched" root cause = placeholder-only inputs; added `placeholder` Target

**Date:** 2026-05-31 · `scripts/eval/explore-app.mjs` (observed-surface map) + `placeholder` Target field
(core schema + runner compile + oracle classifier + probe snapshot + generate prompt + unit test, 42/42).

Built a deterministic live-app **observer** (`explore-app.mjs`): drives each route, records the REAL
interactive elements (role + accessible name + placeholder/type/test_id/icon). Observes STRUCTURE, not
intent. On app-3 it immediately explained the Entry-35 grounding misses: the search input is
`{role:textbox, name:"", placeholder:"Search jobs, companies, or skills…"}` — **empty accessible name**,
so the agent's `role=textbox` / `name=/Email/` locators match NOTHING ("no element matched"). Most real
inputs are placeholder-only.

**Fix (general, not app-specific): `placeholder` Target field** → Playwright `getByPlaceholder` (runner)
+ placeholder-attr match (classifier) + placeholder captured in the snapshot. Verified live via the real
runner: `{placeholder:"Search jobs"}` fill resolved (input got "designer") where `name`-based targeting
failed. Generate prompt now tells the agent to prefer `placeholder` for unlabeled inputs.

**Next (continue the order):** step 1 cont'd — coverage: extend the observer to drive GATED flows (click
to reveal dialogs/forms — e.g. app-3's apply form, app-2's checkout) so generation gets those surfaces;
feed the observed surface map into generation as grounding; then re-measure recall on apps 2-4. Step 3:
re-audit bug manifestation.

## Entry 37 — Observed-surface grounding PoC: prompt guidance already covers FLAT surfaces; the real lever is GATED-FLOW exploration

**Date:** 2026-05-31 · added `observedSurface` option to `generateContractFor` (prompt injection) + PoC.

PoC (app-3 job-search input, with vs without injecting the observed surface):
- WITHOUT observed surface → agent already grounds on `placeholder` (placeholder literal is in the
  source window + Entry-36 prompt guidance). uses_placeholder=true, uses_name_on_textbox=false.
- WITH observed surface → uses_placeholder=true BUT also emitted a name-on-textbox locator (+1
  proposal) — marginal / slightly regressive.

**Honest finding:** for FLAT, source-visible elements the placeholder PROMPT GUIDANCE (Entry 36,
committed) is sufficient; injecting the flat observed surface adds ~nothing. Observed-surface
injection only pays off for elements the SOURCE WINDOW doesn't reveal — i.e. GATED/dynamic surfaces
— but the *flat* observer doesn't reach those either. So neither the flat observer nor the
observed-surface injection moves the needle on the dominant `not_covered` bucket.

**The binding lever is GATED-FLOW EXPLORATION** — intelligently driving multi-step flows (select
ticket → checkout; click Apply → form dialog) to REACH the bug surfaces that static source-walking
+ flat observation both miss. That requires an LLM-driven explorer (cf. `5-25/webtest`'s Playwright-
MCP explorer), a substantial build, and its payoff is bounded by how many apps-2-4 bugs live on
reachable-but-currently-unreached surfaces. The `observedSurface` plumbing is kept (built, harmless)
to feed that explorer's output when it exists.

**Session ceiling (honest):** committed, sound, generalizable capability this session — SDK exec
fix; text/icon/placeholder/route targeting; reach-path; `expected.dom.consistency` + static
consistency templates; live-app observer. true_detection plateaued ~1/15 (+bug#10 via template);
the remaining gain requires the gated-flow-exploration build (coverage), whose payoff is uncertain.
Recommend deciding explicitly whether to invest in that build vs. bank the committed gains.

## Entry 38 — Bug-manifestation audit (apps 2-4, all 15 bugs driven live): only ~8/15 are winnable; ~7/15 are unfalsifiable. The 1/15 plateau is HALF benchmark + HALF coverage.

**Date:** 2026-05-31 · Path A from the session handoff. Drove every `pass:false` checklist item on the
live apps with Playwright (scripts: `scripts/eval/_audit-app{2,3,4}.mjs`, run from the qa-agent repo so
`@playwright/test` resolves; apps launched one-at-a-time on :8080 via the fixture `runner/`). For each
bug I recorded ACTUAL runtime behavior + the source mechanism, then classified: **N** = does not manifest
as the checklist describes (benchmark mislabel); **C** = unrealizable premise / wrong oracle class;
**T** = manifests but only under adversarial input (oracle-trap); **M** = genuinely manifests + catchable.

### The 15 bugs, classified

**N — does NOT manifest at runtime; UNWINNABLE for any blind-from-source agent (5/15):**
- app2 id9 "no success notification on booking" → **toast `Reservation Confirmed!` DOES fire** (CheckoutForm L57). Confirmed bug#9 precedent. The `navigate('/')` does not kill it fast enough to matter.
- app2 id16 "ticket count stuck at 1" → header reads **`Total (10 tickets)`**, updates correctly (EventDetail `totalTickets` sum, L40).
- app4 id3 "venue list shows no name/location/price/type" → first card renders **all four**: `Garden | Luxury ($$$) | Rosewood Garden Estate | Napa Valley, CA` (VenueCard).
- app4 id4 "supplier list missing price range" → vendor card renders **`Luxury ($$$)`** badge (VendorCard L42).
- app4 id16 "specific price not displayed correctly" → price range renders fine; the data model has **only a `priceRange` enum** (budget/moderate/luxury), no numeric price ever existed → nothing to display "incorrectly".

→ A blind agent generating contracts from this source correctly encodes the WORKING behavior as expected.
These bugs can never be detected because **there is no runtime deviation** — exactly the [[blind-from-buggy-source-wall]] failure, but the root cause here is that the benchmark label is wrong, not the agent.

**C — unrealizable premise / wrong oracle class (1/15):**
- app3 id12 "'Post a Job' still shows after switching to job-seeker profile" → there is **no role/profile system at all** in the app; `Header` renders `Post a Job` unconditionally (no `isJobSeeker` anything). You cannot "switch to a job-seeker profile" — the control doesn't exist. Bug premise is unrealizable; agent has no in-app signal to act on.

**T — manifests but only under adversarial input; an oracle-TRAP (1/15):**
- app3 id9 "can submit with incorrect email" → `<input type=email required>`. Runtime: `"abc"` is **blocked** (native HTML5 invalid), but `"a@b"` (no TLD) **passes & submits**. An agent that probes with a typical bad value like `notanemail` sees it blocked → concludes validation works → MISSES the bug. Catching it requires choosing an input that passes HTML5 but is semantically invalid. Subtle oracle-design requirement, not a coverage problem.

**M — genuinely manifests + catchable; THIS is the real ceiling (8/15):**
| bug | mechanism | reach | oracle needed |
|---|---|---|---|
| app2 id11 past-date | organizer create-event `#date` has no `min` | gated (Organizer → New Event form) | constraint: reject past date |
| app2 id12 invalid-phone | checkout phone `type=tel`, **no `pattern`** → `not-a-phone-xyz` reserves | gated (select ticket → checkout dialog) | constraint: phone format |
| app2 id10 cap-at-10 | `Math.min(qty,10)`, + disables at 10 | flat (event page) | **debatable** — a 10-cap is plausibly correct product behavior |
| app3 id11 dup-application | `handleSubmit` has no dedup → 2nd identical submit succeeds | flat (apply form) | **stateful**: 2 submits, assert 2nd blocked |
| app4 id8 budget>0 | planning modal budget `type=number`, no `min` → `-5000` saves | gated (Get Started modal) | constraint: budget>0 |
| app4 id9 guests≥0 int | planning modal guests no `min`/`step` → `-10` saves | gated (Get Started modal) | constraint: guests≥0 int |
| app4 id11 future-date | planning modal date no `min` → `2020-01-01` saves | gated (Get Started modal) | constraint: future date |
| app4 id12 View-Details | button has **no `onClick`/no `Link`** → click does nothing (URL unchanged) | flat (venue list) | interaction: click → URL/route change |

### Verdict — answers the handoff's open question 2

The 1/15 plateau is **not** mostly "agent can't." It is roughly **half-and-half**:
- **7/15 are structurally unwinnable** for a blind-from-source agent: 5 don't manifest (benchmark mislabels) + 1 unrealizable premise + 1 oracle-trap. No amount of coverage or "assert harder" recovers these. **Realistic ceiling on this set is ~8/15, not 15/15.**
- **8/15 genuinely manifest and are catchable.** Their blockers are concrete, not mysterious:
  1. **Coverage of GATED surfaces** — 5 of the 8 live behind a click-to-open form/modal (create-event, checkout dialog, the "Get Started" planning modal). Static source-walking + flat observation (Entry 36/37) never reach these. This is exactly the **gated-flow explorer (path B)** lever.
  2. **Constraint & stateful oracles** — 6 of the 8 need "invalid input is rejected" or "2nd submit blocked" assertions, which a blind agent under-specifies (it encodes the happy path it sees in source). The `expected.dom.consistency` work (Entry 34) doesn't cover these classes; **constraint/negative-path oracles** do.

### Implication for next move
- **Do NOT** invest in stronger assertions against the N/C/T bucket — those 7 are noise w.r.t. this agent's achievable detection. (Reinforces: don't "assert harder" — [[blind-from-buggy-source-wall]].)
- The **gated-flow explorer (B)** now has a *quantified* payoff: it unlocks the 5 gated-surface bugs (app2 id11/id12, app4 id8/id9/id11), and pairs with constraint oracles to also bag app3 id11 + app4 id12. Plausible path from **1/15 → ~7–8/15** — the first real movement past the wall.
- **Caveat (anti-overfit, [[feedback_no_overfit_generalize]]):** these 8 mechanisms (missing `min`, missing `pattern`, no dedup, inert button, gated modal) are generic web-form defects, not app-2-4 trivia — encode the explorer + constraint oracles at that mechanism level and validate on an un-tuned app before trusting the number.

**Artifacts:** `scripts/eval/manifestation-audit-app{2,3,4}.mjs` (committed live drivers; reproducible — launch app NNNN on :8080 via the fixture `runner/`, then `node scripts/eval/manifestation-audit-appN.mjs` from repo root). `_probe_watch.mjs` (OAuth probe) remains scratch — not committed.

## Entry 39 — Gated-flow explorer (path B) DESIGNED then KILLED by two independent reviews: the gated-5 are MISSING-ATTRIBUTE bugs invisible to blind-from-source. Corrects Entry 38's "~8" ceiling DOWN to ~1-3.

**Date:** 2026-05-31 · Design-phase only (no code shipped). Brainstormed path B (reach the 5 gated bugs), ran TWO independent adversarial Opus reviews of the design. Both converged on the same kill-shot. Net: the "1→~8" target in Entry 38 was too optimistic; the gated-5 are not a coverage problem, they are the [[blind-from-buggy-source-wall]] again.

**What was designed (and abandoned):** (v1) LLM-driven Playwright-MCP explorer ported from `5-25/webtest`; rejected by review #1 for an untested OAuth+MCP+30-turn path on our installed-binary auth, plus the causal flaw below. (v2) deterministic depth-1 reveal-crawler (pure Playwright, no SDK) + gated surfaces become first-class `Interaction`s carrying a structured `reachPath` prepended into contract `actions[]` + a bundled "negative-path oracle" generate directive. Review #2 killed v2 on the oracle.

**The kill-shot (review #2, file-grounded) — the negative-path oracle is the load-bearing piece and it cannot fire:**
1. **Not expressible in the schema.** `contract.schema.ts` + `dom-classifier.ts` expose only POSITIVE presence/value primitives (`contains_text`, `role_count`, `input_value`, `attribute_equals`, `consistency`, …). There is **no** "input rejected / value not persisted / error appeared / navigation blocked" primitive. The buggy apps have no validation → no error text → nothing to assert. "Assert it is rejected" is unimplementable today; the agent falls back to `contains_text:["error"]` which PASSES green on the broken app.
2. **Missing-attribute ≠ positive constraint evidence.** All 5 gated bugs are an ABSENT attribute (`min`/`pattern`/`step`): app2 past-date (`type=date`, no min), app2 phone (`type=tel`, no pattern), app4 budget>0 / guests≥0 / future-date (`type=number`/`date`, no min). A blind agent reading `<input type=number>` with no `min` has two equally-valid readings — "unbounded (correct)" vs "should have a floor (bug)" — and **nothing in the source disambiguates**; the disambiguation lives only in the unseen checklist. (Verified: even the dev `instruction` does NOT state these constraints — they exist ONLY in the scorer-side checklist.) This is exactly Entry 22's epistemic wall.
3. **It's the `priors` directive that already plateaued.** "For number/date/tel fields also assert numbers-positive / dates-future / phone-formatted" IS the shipped `priors` variant (`interaction-discovery.ts:481-517`), measured at **1/15** (Entry 25/26). §4 is a re-skin, not new mechanism.

**The positive corollary — WHY app4 id12 is the one blind-detected bug:** the "View Details" inert button has POSITIVE evidence (a button *labelled* "View Details" with no `onClick`/`Link`). **Pattern: blind detection works only when intent is POSITIVELY declared** (a label, route, string, type, Zod schema, comment) and the runtime violates it; it fails when the intended constraint is an ABSENT attribute. This sharpens [[blind-from-buggy-source-wall]] from "needs an independent reference" to a testable predicate: *is the violated intent positively present in source, or only in the spec?*

**Revised realistic blind ceiling on apps 2-4: ~1-3, not ~8.** Of Entry 38's "8 catchable": the 5 gated are missing-attribute → invisible (this entry); leaving the positive-evidence set — app4 id12 inert button (already caught), app3 id11 dup-submit (metamorphic, weak), maybe app2 id12 phone (placeholder-as-format prior, brittle). Entry 38's "8" conflated *manifests at runtime* with *blind-detectable*; only the latter matters for our agent.

**Other review findings (logged, now moot since unbuilt):** synthetic gated `Interaction`s would duplicate the enumerate-stage interaction for the same source file and **content-hash dedup (`mergeContracts`) would NOT collapse them** (different title/actions → different hash) → contract bloat; app4 inputs have no `id`/accessible-name/test_id so the grep-back-link to source fails → DOM-fallback breaks the intent firewall; `observedSurface` is **never threaded** into `generateContractFor` in the live deep flow (`:1316-1324`) — it's dead plumbing; depth-1 reset must be per-candidate re-goto (ESC won't undo destructive/stateful clicks); the negative-path directive's 4 violation types ARE the apps-2-4 bug families ([[feedback_no_overfit_generalize]] risk).

**Decision (user):** accept + document the wall's true depth; do NOT build path B. The crawler (coverage) was sound and cheap, but coverage without an expressible + source-groundable oracle just manufactures green-on-broken contracts. Moving past this needs an independent correct-reference for the constraints — and those constraints are absent from both source AND dev instruction, present only in the forbidden checklist, so the only blind-legal lever is common-sense priors, which already failed (Entry 26). **Blind-from-source detection on missing-attribute constraint bugs is a hard ceiling.** Possible future levers (all require relaxing a current constraint, user-gated): (a) a genuine metamorphic negative primitive (fill-illegal → two-snapshot diff → value silently mutated/lost) — new schema work, catches only silent-mutation not missing-validation; (b) relax pure-blind and admit a stronger-model common-sense prior pass; (c) a differential/clean-reference oracle (cf. WebTestPilot, but its bugs are runtime-injected so source-clean → doesn't exercise this wall).

## Entry 40 — Priors failure-localization + decisive oracle experiment: Entry 39 OVER-ROTATED. The numeric omission bugs are blind-catchable; the 1/15 plateau is a MECHANICAL confound, not the epistemic wall.

**Date:** 2026-06-01 · Before evaluating "relax-blind" routes, ran the cheap diagnostic Entry 38/39 should have run first: dissected the existing `priors-h`/`priors-h-nav` snapshots (apps 2-4) per-bug, then a live oracle experiment on app4. Both reverse Entry 39's pessimism for the numeric subset.

**Part 1 — priors failure-localization (per gated omission bug, from the 2026-05-30 snapshots):**
| bug | reached the surface? | negative contract generated? | actual failure mode |
|---|---|---|---|
| app2 id11 past-date | yes (event form) | no — only `event-date-accepts-value` / `-persists` | prior not applied |
| app2 id12 phone | **no** — `checkout-form-submits-with-phone-data` ERROR'd: `locator.click timeout` on the Checkout button (2-step gate: must select a ticket first) | no (happy-path, valid phone) | reach + prior not applied |
| app4 id8 budget>0 | **yes** — modal reached (`save-persists-wedding-details`, `hero-setup-form-appears` exist) | **no** — only happy-path persist | prior not applied |
| app4 id9 guests≥0 | yes (same modal) | no | prior not applied |
| app4 id11 future-date | yes (same modal) | no | prior not applied |
| **control:** app2 ticket-price | yes (organizer form) | **YES** — `ticket-price-input-rejects-negative` | **unloadable** (in `score.json.unloadable_files` — generated but never ran) |

Key observations that demolish Entry 39's "missing-attribute is epistemically unreadable":
1. The agent **DID author a negative-numeric contract** (`ticket-price-input-rejects-negative`, fill `-50` → `input_value matches "^[0-9]+..."`). So the prior is **readable and applicable** — Entry 39's "unreadable ⇒ hard wall" was wrong.
2. It applied the prior **inconsistently** — fired on ticket-price (a `min=0`, NON-buggy field) but NOT on budget/guests (no-`min`, the actual bugs). Wrong field.
3. The one time it fired, the contract was **unloadable** (never ran).
4. So **no negative contract ever ran to completion on a target buggy field** — the 1/15 plateau is a STACK of mechanical failures (inconsistent prior application + wrong oracle shape + unloadable + 2-step reach), NOT a clean test of the epistemic wall.

**Part 2 — decisive live oracle experiment (app4, `scripts/eval/manifestation-audit`-style drive, committed as `_probe-negative-budget-oracle.mjs` evidence):** hand-drove the exact logic a contract would run — open the gated planning modal → fill an illegal value → Save → inspect the dashboard stat card (an `expected.dom.not_contains_text`-style OUTCOME oracle, NOT `input_value` which can't distinguish `min` since the browser keeps the typed `-5000`):
- **id8 budget −5000** → dashboard shows **`Budget $-5,000`** → `not_contains_text:["-5,000"]` **FAILS on buggy app = CATCHES**. (Sanity: a valid 30000 reaches + shows `$30,000`.)
- **id9 guests −10** → **`Guest Count -10`** → **CATCHES**.
- **id11 past date 2020-01-01** → date persisted + shown, BUT the correct assertion is RELATIVE ("date must be before today") → **NOT generically expressible** as static `not_contains_text` → a genuine EXPRESSIBILITY gap (needs a computed/relative-date primitive) — distinct from, and much smaller than, an epistemic wall.

**Revised verdict (correcting Entries 38 + 39):**
- **Numeric "missing-min" omission bugs (budget>0, guests≥0) ARE blind-detectable.** The constraint ("budgets/guests are non-negative") is a common-sense prior the agent already holds (proven: it tried it on ticket-price), and the OUTCOME oracle to express it (`fill illegal → Save → not_contains_text[negative]`) is already in the schema and CATCHES when run (proven live). The blockers are 100% MECHANICAL: (a) apply the negative prior **consistently** to no-`min`/no-`pattern` fields, (b) steer it to the **OUTCOME** shape (fill→act→assert-not-persisted) not the `input_value` shape (which can't distinguish validated from not), (c) fix **loadability**, (d) **reach** gated surfaces (the modal IS reachable for app4; only app2's 2-step checkout reach failed — a reach-path/coverage fix, which partially REVIVES the killed crawler idea but only for its reach-path role).
- **Date omission bugs need a small NEW oracle primitive** (relative "before/after today") — an expressibility gap, not epistemic. **Phone** is outcome-expressible (bad phone → assert NOT "Reservation Confirmed") but reach-gated.
- **So "relax pure-blind" (R1/R2/R3) is NOT warranted for the numeric subset** — those bugs are winnable blind via mechanical fixes. Entry 39's "blind ceiling ~1-3" is too low; the manifesting-bug ceiling is plausibly much higher once the mechanical confounds are removed. The honest next test is a GENERATION experiment: can the agent be steered (prompt/oracle-shape) to consistently emit the outcome-shaped negative contract for no-`min`/no-`pattern` fields, loadably — then re-measure true_detection on apps 2-4.

**Caveat (don't over-claim again — the Entry 39 lesson):** Part 2 proves the oracle CATCHES when hand-authored + run. It does NOT yet prove the *generator* can be made to emit it consistently and loadably — that's the untested mechanical step. Validate on an un-tuned app per [[feedback_no_overfit_generalize]].

## Entry 41 — GENERATION experiment: `priors-neg` variant makes the agent emit the outcome-shaped negative contract, which CATCHES the budget bug end-to-end (generate→load→run→FAIL). Residual = grounding nameless inputs. NO relax-blind needed.

**Date:** 2026-06-01 · Closes the Entry 40 open step. Added a new gen variant `CONTRACTQA_GEN_PROMPT=priors-neg` = `priors` block + a **NEGATIVE-PATH OUTCOME ORACLE** recipe (`interaction-discovery.ts` `genVariantBlock`): for any field carrying a CLASS-level domain prior (amount/price ≥0; count/guests/age non-negative int; future-only date; well-formed email/phone) — even when the code has no `min`/`pattern` — emit a 3-step contract (reach incl. opening the gating modal → fill ILLEGAL → commit) and **assert the illegal value is NOT in the post-commit DISPLAYED state via `not_contains_text`/`element_text_equals`, NOT `input_value`** (the raw input keeps the typed value regardless of validation). Mechanism-level, no apps-2-4 trivia. cli builds + 261 tests pass.

**Generation result** (single `generateContractFor` on the app4 planning-modal interaction, `priors-neg`): emitted `planning-budget-rejects-negative` + `planning-guests-rejects-negative` — both correctly shaped (goto `/` → click `Get Started|Update Details` → fill `-5000`/`-10` → click `Save` → `not_contains_text:["-5,000"…]/["-10"]`) + a happy-path round-trip control. Agent rationale verbatim: *"the bug is a MISSING guard — assert on the committed/displayed outcome, not the raw input."* Plain `priors` generated NO such contract (Entry 40 snapshots) → **the steer is causal**.

**End-to-end run on live app4** (`scripts/eval/run-contract-against-live.mjs`, real `loadContractsFromDir`+`compileContract`+`runOracle`):
- **Loadability: PASS.** (Contrast: the snapshot's `ticket-price-input-rejects-negative` was UNLOADABLE only because it used `within: { text: "Ticket" }` — but `within` must be a STRING naming an ancestor ARIA role, not an object; the object form is schema-invalid. That single agent bug-pattern explains the Entry-40 unloadable confound.)
- **Verdict = FAIL = BUG CAUGHT**: `dom.not_contains_text: unexpectedly contains "-5,000"` — the negative budget was displayed; the contract flags it. (Required fixing the locator — see residual.)

**Residual blocker (the LAST mechanical mile) = GROUNDING nameless inputs.** The agent emitted `name_regex:"[Bb]udget"`, which does NOT resolve — app4's budget/guests inputs have no accessible name, no `placeholder`, no `test_id`, and a non-associated sibling `<label>`. Substituting `{role:"spinbutton", first:true}` (budget = 1st spinbutton) made it run + catch. So: (a) the agent needs **observed-surface grounding** to pick `first`/positional over a non-resolving `name_regex` (the `observedSurface` lever, Entry 35/37 — now clearly justified); (b) guests (the 2nd nameless spinbutton) is **not addressable** by the current Target vocab (`role/name_regex/test_id/text/icon/placeholder/first/within`) — it lacks `nth` — so a small `Target.nth` addition (or a label-proximity locator) is needed.

**Conclusion (settles the arc, Entries 38→41):** the numeric "missing-attribute" omission bug (budget>0) is **blind-detectable end-to-end** — generate (`priors-neg`) → load → run → catch — with **NO relax-of-pure-blind**. The remaining work is a concrete MECHANICAL roadmap, all blind-legal:
1. ✅ ship `priors-neg` (done, tested) — consistent negative-prior application + correct outcome-oracle shape.
2. feed `observedSurface` into `generateContractFor` (currently never threaded, `:1316-1324`) so the agent grounds nameless inputs by position instead of a hallucinated name.
3. add `Target.nth` (or a label-proximity locator) for the 2nd+ nameless sibling field.
4. fix the agent's `within:{text}`→`within:<role-string>` schema error (or add a text-scoping locator) to stop self-inflicted unloadables.
5. date bugs still need a relative-date primitive; phone needs the 2-step reach (select ticket → checkout).

**Caveat / anti-overfit ([[feedback_no_overfit_generalize]]):** n=1 generation run on a TUNED app (app4). Before trusting generalization, run `priors-neg` on an un-tuned app (0005/0006) and confirm it emits loadable, catching outcome-negative contracts there too. The `priors-neg` recipe is class-level (amount/count/date/format), not app-2-4-specific, but that must be empirically confirmed off the tuning set.

## Entry 42 — Anti-overfit validation of `priors-neg` on UN-TUNED apps 0005/0006: NUMERIC class generalizes (+ no false positives); DATE/RELATIONAL class does NOT. Gate PASSED with a scoped known-limitation.

**Date:** 2026-06-01 · Ran `priors-neg` `generateContractFor` on two never-tuned apps with DIFFERENT constraint classes than app4's numeric: app5 (resume builder — ExperienceForm: end-before-start id9, future-time id10) and app6 (bookkeeping — TransactionDialog: future-date id14; amount). Live-ran the app6 amount contract.

**Result 1 — NUMERIC single-field prior GENERALIZES (not overfit):** on app6 (unseen), `priors-neg` emitted `transaction-amount-not-negative` — correctly OUTCOME-shaped (open Add-Transaction dialog → fill amount `-91337` → Save → `not_contains_text:["-91337","-91,337"]`) + a round-trip control. Same mechanism it produced for app4 budget/guests, on different source it never saw → the recipe is class-level, not app4 trivia.

**Result 2 — the OUTCOME oracle is SELF-CALIBRATING (refutes the false-positive worry):** app6's amount input has `min="0"` (+ a separate income/expense type), so "amount ≥ 0" IS the correct intent and the app ENFORCES it. Live run: the contract LOADED, ran cleanly (app6 uses proper `<Label htmlFor>` → `name_regex:"Amount"` resolved with NO grounding hack, unlike app4), and **verdict=PASS**. So the oracle fails ONLY when the illegal value actually persists (app4 budget, no `min` → FAIL/catch) and PASSES when the field is validated (app6 amount, `min=0` → no negative persists). It does not assert "a min must exist"; it asserts "the illegal value must not end up displayed" — true regardless of how/whether validation is implemented. This directly answers review #2's "missing-min ⇒ should-reject is a guess that false-positives on legitimately-unbounded fields": the OUTCOME shape makes it self-calibrating, so it does NOT false-fire.

**Result 3 — DATE/RELATIONAL class does NOT generalize (the real, scoped gap):** for app5 (end<start id9, future-time id10) AND app6 (future-date id14, start>end id15), `priors-neg` emitted only HAPPY-PATH date contracts (start-date round-trip, current-disables-end) — NO negative/relational contract for any of the actual date bugs. So the steer reliably fires the numeric single-field prior but NOT relational ("end after start") or relative-to-now ("not future") date constraints. Confirms Entries 40/41: dates need (a) a relative/relational oracle primitive AND (b) stronger recognition/prompting — the current `not_contains_text` outcome shape can't express "before today" or "end > start" anyway.

**Verdict:** anti-overfit gate **PASSED for the numeric single-field prior class** — `priors-neg` generalizes to an unseen app, is loadable/runnable, and (crucially) does not false-positive on properly-validated fields. **Known limitation (scoped, not overfit):** date/relational constraints are out of `priors-neg`'s reach and need a separate primitive + recognition pass. Roadmap implication: proceed to integrate the numeric mechanism (grounding: thread `observedSurface` for app4-style nameless inputs + `Target.nth`); treat date/relational as a distinct follow-up, not a blocker.

**Artifacts:** `scripts/eval/gen-experiment-negative-outcome.mjs` (now parametrized: `app4-budget` | `app5-experience` | `app6-transaction`).

## Entry 43 — Roadmap grounding step: `Target.nth` + a grounding directive close the FULL generate→ground→catch loop for app4 numeric bugs (id8 budget + id9 guests), automatically.

**Date:** 2026-06-01 · Roadmap item (Entry 41 step 2/3). The last mechanical blocker for the numeric bugs was GROUNDING name-less inputs (Entry 41: the agent emitted `name_regex:"Budget"` which doesn't resolve — app4's `<Label>`/`<Input>` aren't `htmlFor`-wired, so neither `getByRole(name)` nor `getByLabel` matches). Chose a blind-legal primitive over a live-crawl: the agent can infer field ORDER from source, so it can target by role + index.

**Shipped:**
1. **`Target.nth`** (`contract.schema.ts` + `compile.ts` resolver via a `pick()` helper applied at every locator branch; generalises `first` = nth 0). Unit test added (`compile.test.ts`: `{role:spinbutton, nth:1}` → `getByRole(spinbutton).nth(1)`, not `.first()`). runner 43 tests pass.
2. **Grounding directive in the `priors-neg` block**: if the source shows an input has no usable name/placeholder/test_id/wired-label, target it by ROLE + `nth` in source-declared order (budget before guests → nth 0 / nth 1); scope with `within` if needed; prefer a real handle when the source provides one. cli 261 tests pass.

**Full-loop confirmation (regenerated app4 with `priors-neg`, no manual edits):** the agent emitted `planning-budget-non-negative` `{role:spinbutton, first:true}` AND `planning-guests-non-negative` `{role:spinbutton, nth:1}` — i.e. it CORRECTLY grounded the 2nd nameless field by source order. Live run (Entry-43 hand-mirror + the agent's own locators): budget → **FAIL (id8 caught)**, guests → **FAIL (id9 caught)**; app6's `min=0`-validated amount still PASSES (no false positive, Entry 42). So **generate → ground → catch** is now automatic for the numeric omission class.

**Score impact (principled, pending a full-pipeline run):** app4 numeric bugs id8 + id9 become true detections; with the already-caught id12 (inert View-Details button, positive-evidence), app4 true_detection moves **1 → 3**. The non-numeric app4 bugs (id3/id4/id16 don't manifest — Entry 38; id11 future-date needs the date primitive) stay out.

**Remaining roadmap (unchanged priorities):**
- (P1) **Full-pipeline re-measure** on apps 2-4 with `CONTRACTQA_GEN_PROMPT=priors-neg`: confirm app4 1→3 in the real autopilot run (not just isolated `generateContractFor`), and read off app2/app3.
- (P2) **Date/relational primitive** (relative "before today" / "end after start") — unlocks app4 id11, app2 id11, and the app5/app6 date bugs (Entry 42 gap).
- (P2) **app2 phone (id12)**: 2-step reach (select ticket → checkout) so the checkout form is reachable, then the outcome oracle (bad phone → NOT "Reservation Confirmed").
- (P3) the agent's `within:{text}`→`within:<role-string>` schema slip (Entry 41) — add a text-scoping locator or prompt-guard.

**Anti-overfit:** `nth` is a generic positional primitive; the grounding rule is source-order inference (blind-legal, not app-specific). The negative mechanism's generalization was already gated on un-tuned apps (Entry 42).

**Artifacts:** `scripts/eval/gen-experiment-negative-outcome.mjs` (A/B generateContractFor harness), `scripts/eval/run-contract-against-live.mjs` (single-contract live runner), `genVariantBlock` `priors-neg` branch.
