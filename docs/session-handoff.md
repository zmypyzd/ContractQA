# Session Handoff

**Saved:** 2026-06-01T01:39:18Z (UTC) / 2026-06-01 09:39 Asia/Shanghai (CST)
**Branch:** main (synced with origin/main; eval/manifestation-audit-entry38 == main)
**Head:** 1e7714a — feat(oracle,runner,gen): lever A date_constraint primitive + Target.css + lever C schema hardening (Entry 46)

## Current task
Break the blind-from-buggy-source detection wall on WebTestBench apps 2-4 by catching MISSING-ATTRIBUTE
omission bugs fully blind (no checklist). Numeric class is DONE (app4 true_detection 1→3, full-pipeline
confirmed). The remaining open work is to **land the date-class end-to-end catch** — the `date_constraint`
oracle + recognition are built, but the live catch is blocked by snapshot coverage.

## Next concrete step
Extend the probe snapshot in `packages/probes/src/browser-snapshot.ts` to capture TEXT-BEARING elements
(plain `<p>`/`<span>` with visible text, not just roled/interactive els + headings) into `DomShape.elements`,
so `expected.dom.date_constraint` with a `{text:"2020"}` target can ground onto the dashboard's displayed
date. Then verify live: launch app4 (`/Users/zmy/intership/qa-eval-fixtures/WebTestBench/runner/launch.sh 0004`),
hand-run the date contract (open Get Started modal → `css:"input[type=date]"` fill `2020-01-01` → Save →
`date_constraint {target:{text:"2020"}, rule:"future"}`) and confirm verdict=FAIL (app4 id11 caught).

## Status of play (this session)
- [x] Levers B/A/C implemented, merged to main (1e7714a), pushed to origin (02f758e..1e7714a, 33 commits / Entry 38–46).
- [x] **B** — `priors-neg` fills PRESENT-but-malformed (not empty) + source-gated format negatives; hand-authored 2-step reach catches app2 phone id12 live (url stays /event/ vs buggy → /).
- [x] **A** — `expected.dom.date_constraint` primitive (rule future/past/today_or_*; relational after/before) in schema+classifier (4 unit tests, no-match→skip self-calibrating) + `Target.css`/`Target.nth` grounding; agent generates `wedding-date-must-be-future`.
- [x] **C** — system-prompt schema guards: `within` is a role string (`within:{text}` was the unloadable cause); documented css/nth/date_constraint + valid action types.
- [x] Acceptance: core 58 / oracle 51 / runner 43 / cli 261 / orchestrator 62 / repro 3 / dogfood 5 / dashboard 1 — all green.
- [x] Diagnosed the ONE red (e2e `phase1-loop`) as PRE-EXISTING on main + unrelated (stale dogfood fixtures use legacy `api_call`/`http_status`/`response_body`).

## WIP / uncommitted
- Working tree CLEAN except untracked `_probe_watch.mjs` (OAuth probe scratch, not load-bearing). All lever code committed + pushed; next step (snapshot extension) not started.

## Decisions made
- **Date catch's blocker is snapshot coverage, NOT the oracle** — the `date_constraint` primitive is built + unit-proven; the live miss is that plain `<p>` dates aren't in `DomShape.elements`. Fix the snapshot, don't re-design the oracle.
- **`Target.css` is the grounding handle for role-less `<input type=date>`/`time`** (no ARIA role → role/name/placeholder can't fill them). Don't add per-input-type targeting.
- **Format-negatives are gated on the source showing NO guard** (skip `type=email`/`pattern`) — their residual (e.g. `a@b`) is spec-ambiguous and over-fires; phone (`type=tel`, no pattern) is the clean case.
- **The e2e red is pre-existing + non-regressing** (strict schema 23988fd + http_status fixtures 82213b2 both predate this work, both on main) — do NOT treat it as caused by these levers.
- **Numeric outcome oracle self-calibrates** — passes on validated fields (app6 min=0 amount), fails only when the illegal value persists; no false positives (Entry 42). Same skip-on-no-match logic applied to date_constraint.

## Open questions
- Land the date catch via the snapshot extension (next step), OR also clean the stale `qa/contracts/*` dogfood fixtures (api_call/http_status → current schema) to fix the pre-existing e2e red? Both are scoped; ask user which to prioritize.
- Is a full fresh autopilot run + LLM coverage-judge worth running to formalize the suite-level true_detection score (mechanism already confirmed at contract level)?

## Read these first
1. `qa/eval/tuning-log.md` — Entries 38→46 (the whole arc; start at Entry 40 plateau-overturn, 44 full-pipeline, 46 levers).
2. `packages/oracle/src/dom-classifier.ts` — `date_constraint` block + `parseDateFrom` (no-match→skip).
3. `packages/probes/src/browser-snapshot.ts` — the snapshot that must capture text-bearing elements (the next-step file).
4. `packages/cli/src/autopilot/interaction-discovery.ts` — `genVariantBlock()` `priors-neg` recipe + reach/grounding directives + schema description.
5. `packages/core/src/schemas/contract.schema.ts` + `packages/runner/src/compile.ts` — `Target.css`/`Target.nth` + `date_constraint` schema/resolver.

## Already invoked this session
- **2× independent Opus design reviews** (general-purpose subagents) — killed the gated-flow explorer design (Entries 39); findings synthesized into Entry 39/40. Don't re-run.
- **Full autopilot deep run on app4** (priors-neg, 927s, 130 contracts) — snapshot transient in `scratch/0004/qa/contracts`; results in Entry 44. Don't re-run unless re-measuring.
- **Many isolated `generateContractFor` + live-run harnesses** — `scripts/eval/{gen-experiment-negative-outcome,run-contract-against-live,remeasure-app4-negatives,probe-negative-outcome-oracle,manifestation-audit-app{2,3,4}}.mjs` (committed, reproducible).
- **Memory updated** — `reference_blind_from_buggy_source_wall.md` (full 38→46 chain + the date snapshot-coverage follow-up).

## Verify state on resume
```
cd /Users/zmy/intership/5.10+/qa-agent && git log --oneline -1 && \
  grep -c "date_constraint" packages/oracle/src/dom-classifier.ts && \
  pnpm --filter @contractqa/oracle test 2>&1 | grep -E "Tests "
```
