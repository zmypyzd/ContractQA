# Session Handoff

**Saved:** 2026-05-31T06:22:01Z (UTC) / 2026-05-31 14:22 Asia/Shanghai (CST)
**Branch:** eval/sdk-exec-fix-and-priors-entry25 (NOT yet merged to main; ~12 commits ahead)
**Head:** a3ffb5c — feat(gen): observedSurface grounding option + Entry 37 (gated-flow exploration is the real lever)

## Current task
Tune the ContractQA agent toward real bug **detection** on WebTestBench apps 2-4, attacking the
blind-from-buggy-source wall by **inferring product intent from the codebase** (NOT the dev
instruction) + multi-oracle redundancy; true_detection has plateaued at ~1/15 and the diagnosis is
that the binding constraint is now COVERAGE + GROUNDING (gated surfaces unreached), not the oracle.

## Next concrete step
**Decide which of three the user picked (was the open question when we paused):** (A — recommended)
run the cheap **bug-manifestation audit** — drive a sample of the 11/15 `not_covered` bugs on the
live apps and check whether they actually deviate at runtime (bug#9 precedent: its toast DOES appear,
so it doesn't manifest as "missing toast"); (B) build the **gated-flow LLM explorer**; (C) bank gains
+ merge the branch. If (A): start by driving app-2 `/event/1` checkout + app-3 apply-form bugs with
`scripts/eval/explore-app.mjs`-style observation and compare to each checklist `bug` string.

## Status of play (this session)
- [x] Root-caused + FIXED the OAuth blocker: SDK spawned its own bundled cli.js (403); now uses installed `claude` via `pathToClaudeCodeExecutable` (Entry on memory [[deep-mode-sdk-crash]]). No API key needed.
- [x] Verified `priors` exec-detection = **1/15** (apps 2-4) via manual-judge dump mode; built `--dump-judge` mode.
- [x] Runner targeting: added `text`, `test_id`, `icon`, `placeholder` Target fields (+ tests) — all live-verified.
- [x] Generation: reach-path requirement + known-routes feeding (route accuracy, anti-overfit checked on app-4).
- [x] Built `expected.dom.consistency` relational assertion (count/number_in/sum_of, eq/lte/…); oracle eval + 4 tests; the `intent` agent GENERATES it.
- [x] Built `scripts/eval/consistency-oracles.mjs` (static templates; catches bug#10 deterministically, 0 FP across apps 2-4).
- [x] Re-measured `intent`+consistency on apps 2-4: still **1/15**; consistency added 0 (apps lack that bug class); bottleneck shifted to not_covered 11/15 + grounding misses.
- [x] Built `scripts/eval/explore-app.mjs` (live-app observer); PoC showed flat-surface grounding already handled by prompt guidance → gated-flow exploration is the real (uncommitted) lever.

## WIP / uncommitted
- Working tree clean except `docs/session-handoff.md` (this file) and untracked `_probe_watch.mjs` (OAuth probe helper, not load-bearing). All code/eval work is committed on the branch.
- WIP is **conceptual/decision-stage**: no partial edits — the next move is a user decision (A/B/C above), not a half-finished file.

## Decisions made
- **Intent MUST come from the codebase, NOT the dev `instruction`** — user's explicit, harder research goal; the `5-25/webtest` reference uses instruction-intent (rejected). Don't reintroduce instruction-based intent. See [[feedback_no_overfit_generalize]].
- **No overfit to eval samples** — extract mechanism-level heuristics, validate on un-tuned apps. (Standing rule, memory `feedback_no_overfit_generalize`.)
- **The wall is self-inflicted by mirroring IMPERATIVE behavior**; assert DECLARATIVE intent + cross-signal consistency instead. Confidence-gating is rejected (confident-wrong = silent miss) → gate escalation on OBSERVED reality + multi-oracle redundancy.
- **WebTestPilot demoted to secondary** — its bugs are runtime-injected (source clean) so it doesn't exercise our wall; cloned at `/Users/zmy/intership/qa-eval-fixtures/WebTestPilot` (bookstack+invoiceninja up).
- **bug#9 does NOT manifest as "missing toast"** at runtime — verify bugs manifest before tuning against them.
- **exec-detection LLM k-vote is too slow under OAuth** → main-agent (me) judges via `--dump-judge`.

## Open questions
- Which path: (A) manifestation audit [recommended], (B) gated-flow explorer build [big, bounded payoff], (C) bank + merge branch? — ASK THE USER before acting.
- Is the ~1/15 plateau mostly "agent can't" or "bugs don't manifest / not its oracle class"? (the audit answers this.)
- Merge `eval/sdk-exec-fix-and-priors-entry25` → main? (12 commits, all green; user decides.)

## Read these first
1. `qa/eval/tuning-log.md` — Entries 25-37 (the whole arc; start at Entry 35 plateau + 37 ceiling).
2. `qa/eval/ORACLE-FREE-DETECTION-RESEARCH.md` — Part I (oracle-free) + Part II (intent-from-code) research.
3. `packages/cli/src/autopilot/interaction-discovery.ts` — `genVariantBlock()` (`intent` variant), reach-path, knownRoutes, observedSurface.
4. `packages/oracle/src/dom-classifier.ts` + `packages/core/src/schemas/contract.schema.ts` — `expected.dom.consistency` + Target fields.
5. `scripts/eval/explore-app.mjs` + `scripts/eval/consistency-oracles.mjs` — the observer + static consistency templates.

## Already invoked this session
- **Deep research (2× workflows)** — synthesized into `qa/eval/ORACLE-FREE-DETECTION-RESEARCH.md` (Parts I & II). Don't re-run.
- **Many docker-batch + exec-detection runs** — snapshots in `/Users/zmy/intership/qa-eval-fixtures/WebTestBench/snapshots/*-{priors-h,priors-h-nav,intent-h}-docker/`; transient logs in `qa/eval/entry13-logs/` (gitignored).
- **WebTestPilot cloned + 2 apps brought up** — `/Users/zmy/intership/qa-eval-fixtures/WebTestPilot` (bookstack:8081, invoiceninja:8082; indico failed, prestashop partial). Containers may be down now.
- **4 new/updated memories** — `feedback_no_overfit_generalize` (new), `deep-mode-sdk-crash` (corrected), `reference_external_eval_datasets`, blind-wall.

## Verify state on resume
```
cd /Users/zmy/intership/5.10+/qa-agent && git log --oneline -3 && \
  pnpm --filter @contractqa/runner test 2>&1 | grep -E "Tests " && \
  grep -c "Entry 3[0-7]" qa/eval/tuning-log.md
```
