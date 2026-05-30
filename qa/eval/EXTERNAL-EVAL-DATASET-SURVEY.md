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
- **Bug provenance**: categories derived from REAL closed GitHub "Bug" issues of the 4 apps
  (2043 issues, 10% sampled, thematic-analyzed). But the bug is NOT in source — it's a
  hand-written JS bug function `bug_ij: S→S` invoked at every state transition, ONE artificial
  bug per test requirement, toggled on during testing. So: **realistic bug *types*, synthetic
  injection**; idealized (one isolated bug per assertion) and thus EASIER than coupled real-source
  defects — its high scores don't directly transfer to messy buggy source. Don't over-read them.
- **Why it dissolves our circularity**: the app source is CLEAN; the bug lives only in the runtime
  overlay. So the agent reads correct source → generates correct expectations → the injected bug
  makes them fail → detection works. This is the structural opposite of our setup (agent reads
  buggy source → encodes the bug as expected).
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

### 2. (breadth complement) WebTestBench — friedrichor version = OUR LOCAL FIXTURE (same dataset, not a different one)
- **Correction**: our local `qa-eval-fixtures/WebTestBench/` IS the friedrichor dataset (its
  README is the HuggingFace card: arXiv 2603.25226, github.com/friedrichor/WebTestBench,
  Apache-2.0, 100 records WebTestBench_0001–0100). What is "ours" is only the harness around it
  (our `runner/`, scorer, blind-only rule, topical-coverage scoring) — NOT a separate dataset.
- 100 apps / 1750 cases, 7 domains, 4 dims (Functionality 854 / Constraint 398 / Interaction 247
  / **Content 251** — our weakest). Bugs created by synthesizing apps on Lovable.dev and
  iteratively refining until enough defects are baked in; annotators run checklists, mark
  pass/fail + bug text. **Defects baked into a single buggy app, NO clean version.**
- This is exactly the source of our 0/58 wall: no clean reference → can only score topical
  coverage, not true detection. Use as a breadth / Content-class stress test, NOT the differential
  tuning set. (Contrast WebTestPilot, whose bug is a runtime overlay on otherwise-correct source.)

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

---

## ADDENDUM (2026-05-31): the criterion was wrong — we must train on BUGGY SOURCE, not clean

User critique (correct): WebTestPilot injects its bug as a runtime overlay on **otherwise-correct
source**, so the agent reads CLEAN source and infers correct intent. That is the OPPOSITE of our
deployment scenario — **others' already-built apps that are full of source-level bugs**, where the
agent must read **buggy source** and still infer the **correct product intent** (not encode the bug
as expected). WebTestPilot validates the executor plumbing but does NOT exercise the capability we
need to tune. **Demote it from "primary tuning set" to "differential-oracle plumbing check".**

Revised criterion: **(a) bug genuinely IN the source + (b) an independent correct-intent reference
(fixed version OR spec/doc/checklist) + (c) F2P scoring (contract fails on buggy, passes on fixed).**

### Candidates by fit to the revised criterion

**Tier 1 — exact task formulation (infer intent from buggy source, no bug report given)**
- **TestExplora (Microsoft)** — hides ALL defect signals; uses **documentation-derived intent** as
  the oracle; bug in real source; buggy+fixed versions; F2P metric. SOTA F2P only ~16% → hard, lots
  of headroom. Caveat: **Python-only, backend, library-level unit tests (not E2E)**. Borrow the
  paradigm (doc→intent→F2P, no bug report). github.com/microsoft/TestExplora · arXiv 2602.10471

**Tier 2 — web/JS domain, real source bugs + fixed versions (closest domain)**
- **SWE-bench Multimodal** — 617 real bugs in 17 JS front-end/visualization libraries, golden fix +
  F2P + screenshots. Source bug + fixed reference + UI-facing. Gap: libraries not full apps; unit
  tests not E2E contracts. arXiv 2410.03859
- **BugsJS** — 453 manually-validated real JS bugs, Docker faulty+fixed versions + detecting tests +
  fix patches ("JS Defects4J"). Gap: Node server-side libs, not web UI. https://bugsjs.github.io/

**Tier 3 — gold-standard structure / methodology to borrow**
- **Defects4J** (835 Java bugs, buggy+fixed, F2P) · **SWE-bench Verified / SWE-bench-Live** (Python
  real issues, Docker, F2P; Live = 1319 tasks / 93 repos, post-2024, contamination-resistant).
- **GitHub Recent Bugs + oracle-omission / AugmenTest / SpecRover / VibeRepair** — methods+data for
  "infer the oracle/intent from buggy code" = the exact capability we tune. Read for technique.

### The honest gap + the only directly-usable path
NO public benchmark = {full running web app + source bug + fixed-version reference + E2E contracts}.
That combination is a genuine vacuum. The external sets above are for borrowing the paradigm and as
out-of-domain sanity checks — none is drop-in for an E2E web-contract agent.

**Build it from what we already own (friedrichor WebTestBench = our local fixture):**
1. Its apps already have the **bug IN source**, and the **checklist IS the correct-intent spec**.
   The only missing piece is a fixed reference.
2. For each buggy app, have a strong model **repair it until the full checklist passes** → a
   **fixed version** → now we hold `buggy-source / fixed-source` FULL-APP pairs.
3. Tuning signal: agent reads ONLY the buggy source → infers intent → generates an E2E contract →
   score **F2P** (fails on the buggy app, passes on the fixed app). This is TestExplora's paradigm
   at full-web-app + E2E granularity, on deployment-representative apps. It is the only way to get
   bug-in-source + E2E + executable correct reference in one place.

Proposed first step: pick 3 WebTestBench apps, repair each to a fixed version, run F2P, and check
whether buggy source actually yields a non-zero true-detection gradient.

---

## ADDENDUM 2 (2026-05-31): deep-research pass (104 agents, 21 sources, 25 claims adversarially verified 24✓/1✗)

Confirmed the gap and found the few genuine fits. Verdict by criterion {(a) bug in source,
(b) independent correct-intent reference, (c) F2P} + domain {runnable web app + E2E}.

### The ONLY true full-fit corpus (but tiny) — e2e-tests-dataset
- **Soto-Sánchez et al., Software Quality Journal 2021.** 3 complete full-stack web apps
  (Java/Spring + Angular/Mustache + MySQL), **6 source-injected regression bugs**, each with
  `regression-N` / `regression-fixed-N` git tags; **browser E2E tests** needing the whole app+DB;
  **true F2P** (fail at regression commit, pass at fix); Docker/Compose dual-version reproduction.
- Satisfies (a)+(b)+(c) AND runnable-web-app+E2E — the only corpus that does. Cost: only 6 bugs/3
  apps, **manually injected** (not organic). → high-fidelity validation/tuning target, NOT a
  training set. https://link.springer.com/article/10.1007/s11219-021-09566-x ·
  https://github.com/e2e-tests-dataset/e2e-tests-dataset

### Strongest NEW on rigor, wrong shape — SusVibes (CMU, 2025-12)
- 200 tasks / 108 OSS projects; bugs = reverted real vuln-fix commits; independent **Target-Patch**
  golden reference with **fix-line masking** (anti-leakage); execution-based F2P. (a)+(b)+(c) all met.
- **Disqualified**: it is a SECURITY benchmark (77 CWEs) where the agent GENERATES the impl from a
  feature request (bug introduced at generation), no delivered buggy source, no E2E/UI oracle, intent
  = security spec not functional product intent. **But its mask + Target-Patch method is the reusable
  recipe** for scaling our own set (see below). arXiv 2512.03262 · github.com/LeiLiLab/susvibes

### Ruled out (verified), with reason
- **SWE-bench Multimodal** (arXiv 2410.03859): 617 real JS front-end bugs but in **libraries**
  (Chart.js/Mermaid/openlayers…), **unit-test** oracles not E2E, not full apps. Partial fit.
- **SWE-Bench Pro** (Scale AI, arXiv 2509.16941): 1865 tasks, golden patches + F2P, Py/Go/TS/JS, but
  multi-file ENGINEERING tasks + repo unit/integration tests, not web E2E.
- **Vibe Code Bench** (Vals AI, arXiv 2603.04601): zero-to-one generation-from-NL-spec; NO buggy
  source, NO buggy/fixed pair, NO F2P.
- **MobileDev-Bench** (arXiv 2603.24946): mobile (RN/Flutter/Android), not web. Partial.
- **DiffSpec** (2410.04249, eBPF/Wasm), **FixJS** (isolated function snippets, no tests): out of scope.
- **CONFIRMED: no public React/Vue/Next.js Defects4J-style buggy/fixed pairs exist.**

### Strategic conclusion (updated, supersedes Addendum-1's build idea)
The combination {LARGE + complete runnable web app + ORGANIC source bug + fixed reference + E2E}
is an **open gap** — no 2025-2026 benchmark closes it at scale. Two viable paths:
1. **Now / small**: use **e2e-tests-dataset** as an immediate F2P validation target (non-zero true
   detection today).
2. **Scalable / organic (BETTER than Addendum-1's "repair WebTestBench apps")**: mine real OSS web
   apps that already ship **Playwright/E2E suites**, take **fix-commit before/after as buggy/fixed
   pairs**, and use **GitHub Actions logs as the F2P oracle**. Bugs are ORGANIC → matches the "others'
   app full of latent bugs" deployment scenario. Apply **SusVibes's mask + Target-Patch method** to
   port it from security CWEs to functional/logical product-intent bugs.
