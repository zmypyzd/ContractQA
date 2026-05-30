# External Eval Dataset Survey (for tuning ContractQA)

> Date: 2026-05-30. Research note — selecting an external evaluation set best suited to
> *tuning* the ContractQA agent. Companion to [`EVAL-AUDIT-AND-REDESIGN.md`](./EVAL-AUDIT-AND-REDESIGN.md)
> and [`ORACLE-FREE-DETECTION-RESEARCH.md`](./ORACLE-FREE-DETECTION-RESEARCH.md).

## Selection criterion (derived from our actual bottleneck)

ContractQA's wall is **true detection**, not coverage:

- **Blind-from-buggy-source wall**: the agent generates contracts from *buggy* source, so it
  encodes buggy behavior as "expected". Those contracts PASS on the buggy SUT → true
  detection **0/58**.
- Our internal eval (also confusingly named "WebTestBench") scores **topical coverage** via
  LLM judge, not whether a contract actually fails. `bug_detection_coverage` = "does any
  contract mention the surface", not detection.
- Audit's prescribed fix: a **clean-vs-buggy differential oracle** (TP = contract FAILS on
  buggy AND PASSES on clean) + content/consistency bug class + reachable auth.

**Therefore the deciding criterion is NOT size — it is: does the dataset provide clean/buggy
pairs so we get a real detection gradient to tune against?**

## Ranked candidates

### 1. (TOP PICK) WebTestPilot — only one matching {differential oracle + Playwright assertions + real apps}
- Ships **clean AND buggy versions** (toggleable bug function mutating runtime state).
  Step-level metric: TP = assertion fails on buggy, FP = fails on clean, FN = passes on buggy.
  **This is exactly the differential oracle that breaks our blind-source wall.**
- Ground truth = **Playwright assertions** → isomorphic to our contract format; scoring口径 aligns directly.
- 4 **real** apps (BookStack / Indico / InvoiceNinja / PrestaShop), 100 test cases,
  Docker Compose, **MIT license**.
- 4 bug classes hit our blind spots: **Data inconsistency (= the content/consistency class we
  score 0% on)**, No-op actions, Navigation failures, Missing UI.
- Cost: only 4 apps / 100 cases → low domain diversity. But tuning wants signal *quality*, not
  count: 100 real bugs with a clean reference >> 100 single-version apps scored on coverage.
- Reported baseline: 96% precision / 96% recall (vs PinATA 26% / 69%).
- Paper: https://arxiv.org/abs/2602.11724 · Code: https://github.com/code-philia/WebTestPilot
- **Reusable methodology > using it as a target**: its toggleable bug-function pattern can be
  applied to OUR apps (poker fixture, internal WebTestBench 100) to convert single buggy apps
  into clean/buggy pairs. That's the architectural move that kills the blind-source wall generally.

### 2. (breadth complement) WebTestBench — friedrichor version (⚠️ NAME COLLISION with our internal fixture; different thing)
- 100 apps / 1750 cases, 7 domains, includes **Content class (251 cases)** — our weakest dimension.
  Checklist-free E2E. Paper https://arxiv.org/abs/2603.25226 · Code https://github.com/friedrichor/WebTestBench
- **Same disease as our current setup**: NO clean version — defects baked into a single buggy
  app, LLM semantic-match scoring → still a coverage paradigm, does NOT cure the blind-source wall.
- Use as a breadth / content-class stress test, NOT the primary tuning set.

### 3. (borrow methodology only, not a usable web target) SWT-bench / TDD-Bench-Verified
- Gold **fail-to-pass oracle** (generated test must fail before patch, pass after) — isomorphic
  to the differential detection we want. But targets are **backend Python repos**, domain mismatch.
  Borrow the *scoring discipline* (F2P, not topical coverage), not the data.
- SWT-bench https://arxiv.org/abs/2406.12952 · https://swtbench.com/
- TDD-Bench-Verified https://arxiv.org/html/2412.02883v1 · https://github.com/IBM/TDD-Bench-Verified
- TestGenEval (coverage+mutation, file-level Python) https://arxiv.org/abs/2410.00752 — method ref only.

## Recommended path
1. **Adopt WebTestPilot as primary tuning set**: run our contract executor against its clean/buggy
   versions; switch the scored metric from `bug_detection_coverage` (topical) to **F2P true
   detection** (fails on buggy ∧ passes on clean). First non-zero, optimizable detection gradient.
2. **Port its bug-toggle methodology** onto the poker fixture + internal 100 apps to mass-produce
   clean references, upgrading existing assets into a differential set.
3. Use **friedrichor WebTestBench Content class** as a consistency-dimension regression.

Next concrete step (not yet done): pull WebTestPilot's docker apps, wire to the existing contract
executor, verify it actually yields a non-zero detection signal.
