# Session Handoff

**Saved:** 2026-06-01T06:48:34Z (UTC) / 2026-06-01 14:48 Asia/Shanghai (CST)
**Branch:** main (synced with origin/main, 0/0)
**Head:** 620c73e — eval: Entry 48 — blind full-pipeline audit of app4 (baseline 1/7 vs priors-neg 4/7)

## Current task
Just shipped: a full blind-autopilot eval of app4 (0004) + an oracle false-positive fix (Entry 48). The
eval surfaced THE production gap — **the catcher machinery is gated behind `CONTRACTQA_GEN_PROMPT=priors-neg`,
default `baseline`, so the shipped default detects ~1/7 vs 4/7 with the recipe on.** The natural next task is
the Entry-48 improvement plan, starting at **P0: promote the priors-neg recipe to the default gen prompt**.

## Next concrete step
Implement **P0** — make the negative-outcome + date_constraint recognition the DEFAULT in
`packages/cli/src/autopilot/interaction-discovery.ts`: either change `genVariantBlock()` (~L469-518) so the
`priors-neg` block runs under `baseline`, or flip the default at L470 (`process.env.CONTRACTQA_GEN_PROMPT || 'baseline'` → `'priors-neg'`). Then re-run the blind autopilot on app4 + `scripts/eval/stage-c-exec-0004.mjs` for execution truth, confirming default detection goes 1→4 with no FP regression. **P0 must ship with P1 FP controls** — the oracle no-match→SKIP fix (done, 49439fb) is P1a; remaining FP source is modal-opener reach (P1b).

## Status of play (this session)
- [x] Ran two full blind autopilot arms on app4: baseline (default) vs priors-neg, stage-by-stage tuner-audited vs GT (golden checklist, 7 bugs: id3,4,8,9,11,12,16).
- [x] Baseline true detection **1/7** (only id12); priors-neg **4/7** (id8,9,11,12). Root cause = catcher recipe gated behind non-default env var.
- [x] Validated the Entry-47 text-pass END-TO-END: 5 `date_constraint` contracts all caught id11 in the full pipeline (not just isolated verify).
- [x] Shipped oracle FP fix (`dom-classifier.ts`): `isGroundableTarget` (empty/css-only target → match nothing) + no-match→SKIP for the 4 property evaluators + ungroundable `count`→null. FPs 24→15 (−37.5%), zero detection loss. Committed `49439fb`.
- [x] Wrote tuning-log Entry 48 + `scripts/eval/stage-c-exec-0004.mjs` harness. Committed `620c73e`.
- [x] All acceptance green: oracle 53 / runner 43 / core 58 / cli 261. Pushed to origin/main.

## WIP / uncommitted
- Working tree clean except `docs/session-handoff.md` (this file — session machinery, auto-churns; not part of any task). All eval+fix work committed + pushed (49439fb, 620c73e).

## Decisions made
- **Committed direct to local main, no PR/feature branch** — user explicitly chose this near-path twice this session; solo repo. Don't re-propose the PR flow unless asked.
- **no-match → SKIP is principled, not overfit** — extends the existing date_constraint/consistency "no grounding → no violation" rule to the 4 property evaluators; none of the 4 true positives depend on no-match→FAIL, so zero detection loss. Don't re-litigate as "masking real failures" — missing-element bugs belong on role_count/contains_text.
- **Coverage judge (webtestbench-score) is NOT a detection proxy** — proven unreliable BOTH directions this session (over-counts id3/4 baseline, under-counts id8 priors-neg). Use `stage-c-exec-0004.mjs` execution truth.
- **"app4 3→4" holds ONLY under priors-neg** — default-product detection is 1 until P0 lands. Honesty note already in Entry 48.
- **Left `docs/session-handoff.md` + `_probe_watch.mjs` churn out of feature commits** — unrelated session machinery (user committed them once explicitly earlier; default is to leave them).

## Open questions
- P0 risk: promoting priors-neg to default brings its false positives into every run. Is the −37.5% from the oracle fix enough, or should P1b (modal-opener reach via `observedSurface`) land FIRST? Ask the user the order before flipping the default.
- Should P0 be a hard default flip (L470) or a softer "fold date_constraint + negative-outcome directives into the baseline block, keep priors-neg as the aggressive variant"? Taste call — confirm with user.

## Read these first
1. `qa/eval/tuning-log.md` — Entry 48 (the whole eval + the P0→P3 plan; start there).
2. `packages/cli/src/autopilot/interaction-discovery.ts` — `genVariantBlock()` ~L469-518 + the `CONTRACTQA_GEN_PROMPT || 'baseline'` default at L470 (the P0 edit site).
3. `packages/oracle/src/dom-classifier.ts` — the shipped FP fix (`isGroundableTarget`, no-match→skip); reference for the skip pattern.
4. `scripts/eval/stage-c-exec-0004.mjs` — live execution harness (loads scratch/0004/qa/contracts, runs vs :8080, FAIL→GT mapping).
5. `/Users/zmy/.claude/projects/-Users-zmy-intership-5-10--qa-agent/memory/reference_blind_from_buggy_source_wall.md` — Entry-48 note (default-prompt gap + the arc 38→48).

## Already invoked this session
- **Full blind autopilot ×2 on app4** (baseline + priors-neg, deep mode, ~13min each) — contracts in `WebTestBench/scratch/0004/qa/contracts` (currently the priors-neg set); baseline snapshot at `/tmp/baseline-0004`. Logs `/tmp/ap-0004-*.log`. Don't re-run unless re-measuring.
- **Stage C execution ×3** (`stage-c-exec-0004.mjs`) + **webtestbench-score ×2** (coverage judge) — results `/tmp/stage-c-0004*.log`, `/tmp/score-0004-*.log`, `scratch/0004/score.json`.
- **Memory updated** — `reference_blind_from_buggy_source_wall.md` (Entry 48), `feedback_chinese_cute_ceo_duck.md` (new: always use Chinese cute CEO duck voice).
- **App4 fixture torn down** — :8080 free; `cd WebTestBench && ./runner/reset.sh 0004 && ./runner/launch.sh 0004` to bring back.

## Verify state on resume
```
cd /Users/zmy/intership/5.10+/qa-agent && git log --oneline -2 && \
  grep -n "CONTRACTQA_GEN_PROMPT || 'baseline'" packages/cli/src/autopilot/interaction-discovery.ts
```
