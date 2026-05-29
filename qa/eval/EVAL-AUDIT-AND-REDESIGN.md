# WebTestBench Eval — Audit & Redesign for Stage-Attributable Measurement

**Date:** 2026-05-29 · **Commit:** post-`3dad62f`
**Why this doc:** Entry 14 proved the headline `bug_detection_coverage` measures
LLM-judged *topical coverage*, not whether a contract actually catches the bug
(0008: coverage 4/4 → execution true-detection 0/4). A 4-way audit of the whole
pipeline then found the same failure pattern at every stage boundary. This doc is
the consolidated audit + a redesign whose goal is the user's requirement: an eval
**rigorous and complete enough to back-trace a missed bug to the exact stage that
failed.**

---

## 0. The meta-finding

> The pipeline has **no notion of ground truth at any executable stage**, and it
> **silently drops or miscounts data at every boundary**. So a "bug detected"
> number is an upper bound built on hidden losses, and a "bug missed" tells you
> nothing about *which* stage failed.

Two structural root causes:
1. **Coverage ≠ detection.** Nothing executes contracts against the buggy SUT in
   the scored path; the canonical `contractqa run` path that *does* execute asserts
   "every contract must PASS", which is the wrong oracle for catching bugs.
2. **Lossy, unsurfaced boundaries.** Discovery→generation→merge→load→run→score each
   drop items (schema-invalid, dedup collisions, null-filtered apps, score-limit
   slices) with at most a `console.warn` — never a first-class count. Coverage is
   therefore computed over a self-selected survivable subset.

---

## 1. The 8-stage pipeline & the back-trace model

For any planted bug, a complete eval must answer **which stage broke**. The stages
and the question each must answer:

| # | Stage | Question | Failure label | Instrument |
|---|-------|----------|---------------|------------|
| S1 | **Discovery** (enumerateSurface) | Was the buggy surface enumerated at all? | `discovery_gap` | dump enumerated interactions; check bug surface ∈ set |
| S2 | **Generation** (per-interaction LLM) | Was a contract generated for it, with a *non-vacuous* assertion? | `generation_gap` / `weak_contract` | count proposals/interaction; flag contains_text-only |
| S3 | **Merge/dedup** | Was a generated contract dropped by id-collision/dedup? | `dedup_loss` | surface `merged.skipped[]` w/ reasons |
| S4 | **Loadability** | Does the contract survive the runner's schema loader? | `unloadable` | surface loader `skipped[]` w/ reasons |
| S5 | **Reachability** (auth/route/env) | Can the contract reach the surface? | `auth_unreached` / `route_unreached` | precondition + post-nav URL check |
| S6 | **Execution** | Does it run without throwing? | `execution_defect` | try/catch around the thunk |
| S7 | **Assertion/Oracle** | Does it FAIL on the buggy SUT (PASS = blind), and on-target? | `weak_assertion` / `off_target_fail` / `true_detection` | runOracle + failure↔bug judge |
| S8 | **Scoring/Judge** | Does the coverage judge label correctly & is the metric named honestly? | `judge_false_pos` / `judge_false_neg` | id-validation + k-vote + rename |

**Already built:** `scripts/eval/exec-detection-score.mjs` covers **S5–S7** (and
reads S8's matched ids). 0008 output: `auth_unreached:2, execution_defect:1,
weak_assertion:1, true_detection:0`. The redesign extends instrumentation to
S1–S4 and S8.

---

## 2. Defect inventory (from the 4-way audit)

Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low. Each cites file:line.

### Stage S7/S6 — Execution & Oracle (the scored-vs-real gap)
- 🔴 **PASS-only oracle.** `qa-runner.test.mts:151` `expect.soft(verdict.verdict).toBe('PASS')`. No per-contract `expected_verdict`, so a bug-catching contract (correct outcome = FAIL on buggy SUT) is scored identically to a broken one, and a blind PASS reads as a green test. The canonical run cannot represent detection.
- 🔴 **Blind-pass oracle.** `declared-fields.ts:173-275` — the oracle matches the contract's own `expected`, never ground truth. A contract that asserts the *buggy* behavior PASSes. This is the dominant detection-inflation driver (the S7 `weak_assertion` class).
- 🟠 **Exceptions == FAIL.** `qa-runner.test.mts:111` runs the thunk unguarded; a selector strict-mode crash / nav error throws before `runOracle`, indistinguishable from an oracle FAIL. (Our exec scorer fixes this via try/catch → `execution_defect`.)
- 🟠 **INCONCLUSIVE/FLAKY collapse to "not PASS".** `verdict.ts:30-43`; only one run is ever executed (`fixtures.ts:33`) so FLAKY is unreachable — nondeterminism becomes a coin-flip PASS/FAIL with no flake signal.
- 🟡 **Empty noise profile → spurious FAIL.** `qa-runner.test.mts:74-84` + `declared-fields.ts:194-219`: benign app-written storage/cookies trip `no_key_matches` → false-alarm FAILs that read as detections.
- 🟡 **`within` unimplemented in oracle.** `dom-classifier.ts:48-67` ignores `target.within` (compile honors it) → `within`-scoped DOM assertions always "no element matched" → false FAIL on correct apps.
- 🟡 **compile drops `test_id`/`text` targets & no-ops `contains_all`/`not_contains_any`.** `compile.ts:98-113`; a contract whose only assertion is an unimplemented alias has an empty oracle → unconditional PASS.

### Stage S4 — Loadability
- 🟠 **Loader silently drops ~18% schema-invalid contracts** (`loader.ts:24-54`, "loaded 84, skipped 18"), surfaced only as a console.warn; nothing downstream reads `skipped`. Rejection categories: unknown `expected.*` keys (LLM-hallucinated shapes), `.strict()` action typos, bad id regex, unsafe regex, empty actions. The LLM tends to hallucinate exotic `expected.*` for the *harder* assertions → drop correlates with bug-catchers.
- 🟠 **Scorer corpus ≠ runner corpus.** `webtestbench-score.mjs:68-70` counts `.yml`+`.yaml` raw-parsed (no schema), while the runner runs only schema-valid `.yml`. Coverage credits contracts that can never execute.

### Stage S3 — Merge/dedup
- 🟠 **id-collision dedup is positional, not quality-aware.** `interaction-discovery.ts:947` first-writer-wins on `id`; Stage 2 generates per-interaction with no shared id namespace, so a later proposal with a *stronger* assertion is dropped as a "collision". `skipped[]` is never returned (`:1198`).
- 🟠 **`contractsWritten` counts files, not invariants; `skipped` discarded.** A Reflexion pass emitting 5 all-deduped proposals reports `generated += 0` with no diagnostic (explains Entry 13's "5 novel across 10 apps").

### Stage S2 — Generation
- 🟡 **Weak/vacuous contracts accepted.** `interaction-discovery.ts:561,484` — the prompt's cheapest class-satisfying output is a broad `dom.contains_text` needle that "silent-passes on most pages"; nothing rejects a contract whose only assertion is one unscoped `contains_text`. Generation-side analog of coverage inflation.
- 🟡 **Per-interaction failures drop to `null` silently.** `runPool:703-707` + `generateContractFor` error returns; one bad item rejects the *entire* proposals array (no per-item tolerance, `:679-682`). "Generation failed" is indistinguishable from "no invariant here".
- ⚪ **Provenance unreliable.** Frontmatter `# interaction:` is a YAML comment (invisible to loader); Reflexion → `reflexion-content`, fallback → `fallback`, and `area` (LLM free-form) overrides module for the on-disk dir → area-based back-tracing breaks.

### Stage S1 — Discovery
- 🟠 **Static-only enumeration.** `bootstrap.ts:150-153` hardcodes `routes=['/']`; `loadEntryFiles` reads only 5 file *contents* (`:256`); file list truncated at 80% tail (`:343-346`). Dynamic routes (`[id]`), auth/role/flag-gated views, and API-only behaviors are never enumerated → guaranteed bug-class misses that look like "nothing there".
- 🟡 **Stage-1 failure silently downgrades to module discovery.** `enumerateSurface` returns null on LLM/JSON/zod failure → `fallbackToModuleDiscovery` (weaker), surfaced only as `fallbackUsed` + warn; no raw-response quarantine, no repair retry.
- (blind spot) **No multi-step/stateful flow discovery.** Each contract is from a ±40-line single-interaction window; cross-page/cross-request invariants (the CONTENT/consistency bug class) are left to the one-shot Reflexion pass that dedups to ~0.

### Stage S8 — Scoring/Judge & aggregation
- 🔴 **All cross-entry comparisons are confounded.** Entry 0/3/11/12 differ in model+concurrency+runner+scorer-env+day+OAuth simultaneously; Entry 13 shows run-to-run sd ≈ 22–28pp > nearly every claimed delta. Only same-day single-variable paired arms (Entry 13's `--label` design) are valid. Every causal claim built on a cross-entry delta is unidentifiable.
- 🟠 **Unvalidated matched ids.** `webtestbench-score.mjs:143-144,217` — judge is primed with both ordinal `[i+1]` and `id=`, returns either/hallucinated; no membership check; `covered` taken at face value → judge false-positives inflate coverage.
- 🟠 **`mean bug detection` drops zero-bug apps.** `bug_detection_coverage` is `null` when `totalPassFalse===0` (`:294`), then `.filter(v=>v!==null)` before the mean → average over a self-selected subset (upward bias). Same for `mean_coverage` on empty checklists.
- 🟠 **`--score-limit` scores first-N items, reported as full coverage.** `:248` `slice(0,limit)`; `checklist_total` set to the truncated count → loss invisible; ordering puts functionality/pass:true first, so limited runs over-weight easy items and can zero-out the bug metric.
- 🟡 **Single-sample judge at temp 0.2** (`:188-193`) → non-reproducible `covered` booleans run-to-run; undermines A/B.
- 🟡 **`maxTokens:400` truncation → silent "not covered"** (`:192,210-223`): verbose/cut-off judge replies become misses, contaminating both metrics downward.
- 🟡 **`ok` = scorer exit code, not quality.** `docker-batch.mjs:261` — "10/10 OK" means "scorer exited clean", not "produced meaningful tests"; an 11-contract 38%-coverage app counts as OK.
- 🟡 **Unweighted mean-of-ratios.** `docker-batch.mjs:361` — a 1-bug app (100%) weighs equal to a 10-bug app (50%); pooled `Σcovered/Σtotal` is computed elsewhere but not the headline.
- 🟡 **Scorer env differs between arms.** docker-batch sets `CONTRACTQA_FORCE_SDK_CLIENT=''` (`:237`); serial batch doesn't → judge-routing/model can differ between compared runs.
- 🟡 **No per-app autopilot-budget gate.** A 30-min-budget-truncated app scores on a partial corpus and counts as complete.
- 🟡 **Same-day collision** unless `--label` remembered; serial batch has no label at all → silent snapshot overwrite.

---

## 3. Redesign — a stage-attributing eval

**Principle:** every planted bug exits the eval with exactly one terminal stage
label (S1–S8 above) and the evidence for it. Aggregate = a histogram over stages,
not a single inflated %. "Where is the pipeline losing bugs?" becomes answerable.

### 3.1 New metrics (replace the confounded ones)
- **`true_detection_rate`** = bugs with an on-target FAIL on the buggy SUT / total bugs. The honest headline. (Needs S7 + ground-truth judge — exec-detection-score already computes it.)
- **`stage_attribution`** = histogram `{discovery_gap, generation_gap, weak_contract, dedup_loss, unloadable, auth_unreached, execution_defect, weak_assertion, off_target_fail, judge_false_pos/neg, true_detection}` over all bugs. The back-trace deliverable.
- Keep `coverage_overall` but **rename** the bug one to `bug_aim_coverage` (it's topical aim) and always report it *beside* `true_detection_rate` so the gap is visible.
- Report **pooled** rates (Σ/Σ) as headline; per-app mean as secondary; **always print dropped/excluded/limited counts**.

### 3.2 Required instrumentation (close the silent boundaries)
1. **S4 loadability gate (cheap, do first).** Make the scorer load via the *runner's* `loadContractsFromDir({lenient:true})` and emit `unloadable_count` + reasons. Reconcile scorer corpus == runner corpus. (Fixes coverage#2 + surfaces loader#1.)
2. **S3 surface `merged.skipped[]`** through `DiscoverByInteractionResult` → Phase B counters (dedup_loss, by reason). Namespace generated ids by interaction id to stop positional drops.
3. **S2 weak-contract flag** at merge time: reject/flag proposals whose only assertion is one unscoped `contains_text`.
4. **S1 discovery dump:** persist enumerated interactions + the real route manifest (glob `app/**/page.tsx`, `app/api/**/route.ts`, `pages/**`) instead of `routes=['/']`; quarantine Stage-1 raw response on parse failure.
5. **S5/S6/S7 = exec-detection-score.mjs** (built). Add: an **auth bootstrap** (`auth.config.mjs` per fixture) so `logged_in` bugs are reachable — without it, auth-gated detection is structurally 0 (2/4 on 0008). Normalize the `auth_state` vocabulary (schema enum) so non-`logged_in` strings don't slip into `reachable`.
6. **S7 oracle correctness:** add `expected_verdict` to contracts (or run each contract against a **bug-free reference build** too: detection = PASS on clean ∧ FAIL on buggy — the gold standard, eliminates blind-pass and false-alarm in one move). Implement `within` in the oracle; wire `test_id`/`text`; synthesize a per-SUT noise baseline.
7. **S8 judge hardening:** show only real `id`, reject `covered:true` with non-member ids; k-sample majority vote at temp 0; distinguish parse-failure from "not covered"; stratified/seeded `--limit`; emit `by_class`/`by_pass` breakdowns.

### 3.3 Methodology guardrails
- **Only same-day, single-variable, paired arms** (Entry 13 `--label` design) may be compared. Never a cross-entry delta table. Bake a `run_id` (timestamp+label) into every snapshot; forbid date-only keys.
- **Gate `ok`** on `autopilot_exit===0 ∧ budget-not-exhausted ∧ min-quality`, separate from "pipeline completed".
- **Pin the judge** client+model across compared arms; log resolved `modelHint` per app.
- Report **n, sd, and CI**; with sd≈28pp, a ±5pp claim needs n≈160+ paired apps — say so or don't claim it.

### 3.4 The gold-standard detection oracle (highest-value, larger build)
Run every bug-covering contract against **both** a clean reference and the buggy
SUT. A bug is *truly detected* iff some matched contract **PASSes clean AND FAILs
buggy**. This single change:
- kills blind-pass (contract asserting buggy behavior PASSes both → not detection),
- kills false-alarm (brittle contract FAILs both → not detection),
- removes the need for an LLM failure↔bug judge (the clean/buggy delta *is* ground truth).
WebTestBench ships buggy apps; the clean reference is the missing input (the bug
descriptions imply the intended behavior). If a clean build per app is obtainable,
this becomes the canonical S7.

---

## 4. Prioritized roadmap

1. **(done)** S5–S7 exec-detection scorer with stage attribution.
2. **S4 + S8-corpus reconciliation** — scorer uses runner's loader; emit unloadable/excluded/limited counts; rename `bug_detection_coverage → bug_aim_coverage`; report `true_detection_rate` beside it. *(cheap, removes the biggest inflations)*
3. **Auth bootstrap** for the fixtures so `auth_unreached` bugs become testable; re-run exec-detection across all 10 apps → real true-detection rate vs the 47.7% aim rate. *(Entry 14 Next #2)*
4. **S3 + S1 instrumentation** — surface dedup/discovery losses; route manifest into Stage 1.
5. **Gold-standard clean-vs-buggy oracle** (§3.4) if clean builds are obtainable.
6. **S8 judge hardening** + methodology guardrails baked into the batch runner.

Each step makes one more stage observable; after all of them a missed bug always
lands in exactly one S1–S8 bucket with evidence — the "倒推到具体环节" goal.
