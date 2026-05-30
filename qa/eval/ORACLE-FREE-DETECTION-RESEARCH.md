# Oracle-free bug detection for a blind web QA agent — research digest (2026-05-30)

Deep-research synthesis (21 confirmed claims / 4 refuted, 21 primary sources, adversarially
3-vote verified). Frames the path past the **blind-from-buggy-source wall** for ContractQA.
Raw transcript: deep-research run `wf_68b04fe4-420`.

## The wall, formalized (this is not just our problem)

**TOSEM 2025** (dl.acm.org/doi/10.1145/3715107) states the root cause directly: *any* oracle
derived from the SUT's own artifacts — source, comments, docs, **executions, traces** — is *by
construction* consistent with those observations. So a buggy implementation yields a buggy
oracle that passes on its own bug; distinguishing a real bug from a false positive "may require
a human." This is exactly ContractQA's 0/58 true-detection result (Entry 18) — and it confirms
"assert harder" can never work (Entry 22). The escape is **only** a reference from OUTSIDE the
buggy implementation.

Corollary caveat: **LLM-as-oracle is contaminated by training-data memorization** (ChatGPT-3.5
reproduced exact Defects4J assertions). Never benchmark oracle quality on public datasets the
model may have seen; use our own injected bugs (WebTestBench is leakage-resistant — good).

## Three families that GENUINELY escape the trap (ranked for ContractQA)

### 1. Generic / universal invariants — cleanest, cheapest, ship first
**ATUSA** (Mesbah & van Deursen, IEEE TSE 2012). App-INDEPENDENT correctness properties that
cannot encode app behavior because they're not derived from the app: DOM validity/well-formedness,
**absence of error/exception strings**, discoverability, **back-button/navigation reversibility**,
no crashes/500s, no broken links. Architecture = a fixed library of generic checkers + a plugin
slot for app-specific validators.
- **ContractQA fit:** we already have `_smoke` contracts (SMOKE-root-not-500,
  SMOKE-nonexistent-route-404). This family says: **make that the backbone, not an afterthought.**
  Expand to a fixed catalog the generator always emits regardless of source.

### 2. Metamorphic relations (MRs) — best-evidenced oracle-free family
Check necessary relationships across *multiple related executions*, no correct output needed:
**add-then-remove returns to prior DOM/state snapshot**, idempotence (re-sort twice = same),
**conservation/sum** (cart total = Σ line items; count invariants), ordering independence
(reorder independent inputs → equivalent final state). (arXiv 2401.17019; TOSEM 2025.)
- **Critical design rule (arXiv 2401.17019, 3-0):** derive MRs from an INDEPENDENT intent source
  (visible UI affordances/copy or external requirements) **— explicitly NOT from app source.**
- GenMorph (arXiv 2312.15302) shows MR *fitness* should penalize relations that never fire on
  faults — useful template — but it needs a correct reference + mutants to build them (Java
  methods, not web). Transfer the fitness idea, not the pipeline.

### 3. LLM-as-oracle from an INDEPENDENT vantage — the contamination-proof version
**OLLM** (arXiv 2407.19053): an LLM that draws expected behavior from its **training-corpus
domain knowledge** and reads **only runtime UI artifacts** (screenshots, UI hierarchy, labels,
step descriptions) — **NOT source** — caught **49% of 71 real non-crash functional bugs** (+24
new, 4 dev-confirmed) in a controlled injected-bug study. This is real defect detection, not
coverage.
- **The mechanism that defeats our wall:** contrast **what the UI CLAIMS** (visible labels, ARIA,
  hint text like "max 2", placeholders, button semantics) against **what it DOES**. Bugs live in
  that gap, and the oracle never touches the buggy source so it can't be contaminated.
- Caveat: documented **high false-positive rate** → needs a verification/voting pass.

### 4. Autonomous intent-driven journeys + implicit-failure oracles (the "simulate a human" path)
**DroidAgent** (arXiv 2311.08649, ICST 2024): agent **sets its own task goals** and pursues them
by interacting with the app (317/374 journeys judged realistic; 61% vs 51% SOTA coverage), no
correct-behavior reference. Pair with crash/dead-end/stuck-state/console-error oracles → a blind
functional-failure detector. This is the user's "模拟人类交互流程找 bug" — and it needs no design
knowledge because "this didn't work" (error, 500, dead-end, stuck) is self-evident.

## What only SIDESTEPS the wall (don't be fooled by the big numbers)

These have strong real-defect numbers ONLY by importing an external reference — they don't solve
blind, they avoid it:
- **WebTestPilot** (FSE 2026, arXiv 2602.11724): needs an NL **spec** (mandatory input). Its
  96/96 precision/recall on injected bugs was **REFUTED** (1-2). Useful idea to steal: *symbolize
  GUI elements and assert causal/temporal pre/post-conditions* — but feed it visible UI intent,
  not a spec we lack.
- **MST-wi** (IEEE TSE 2023): human-authored MRs; security CWEs; 85% on ~12 vulns.
- **GUI-invariant mobile study** (23% mutation-validated lift): invariants extracted from the
  **human-validated correct version**. Android.
- **Daikon dynamic invariants**: only "*likely*" invariants over observed runs; **run on a buggy
  app they encode the bug** → does NOT escape the trap first-pass. Use for cross-run regression
  only.

## Open question = exactly ContractQA's thesis (no source measures it yet)

> "What is the measured TRUE defect-detection rate of a fully BLIND web agent combining generic
> invariants + auto-derived MRs + independent-LLM-as-oracle, with NO spec and NO source access?"

No paper in the set measures this configuration. ContractQA + WebTestBench is positioned to be
the first — which makes this a publishable thesis, not just a tuning chore.

## Concrete tuning direction for ContractQA (pre-results; refine with Arm A numbers)

The current `priors` prompt is a partial family-3 move but still lets the generator read source,
so it stays contaminated. The research says restructure the generator into an **oracle ensemble**,
none of which authors assertions from source:

1. **Generic-invariant backbone** (family 1): always-emit catalog — no error strings, no 500s,
   back-button reversibility, no broken nav, DOM well-formedness. Zero spec, app-independent.
2. **MR layer** (family 2): auto-derive add/remove-reversibility, idempotence, conservation,
   ordering-independence from **observed UI affordances**, never source.
3. **Stated-intent-vs-observed gap oracle** (family 3): a separate LLM pass that reads ONLY the
   rendered UI (labels, ARIA, hint text, button copy) and asserts the UI does what it says —
   architecturally firewalled from source.
4. **Journey/implicit-failure layer** (family 4): autonomous goals + crash/dead-end/stuck oracles.
5. **FP control:** k-vote verification pass (LLM-as-oracle is FP-prone).

Key architectural principle: **firewall the oracle from the buggy source.** Today the generator
sees source and encodes the bug. The fix is not a better prompt — it's changing the oracle's
*input* to things the bug cannot have contaminated (universal invariants, cross-execution
relations, the UI's own stated intent).

## Sources (primary, verified)
- TOSEM 2025 oracle-problem root cause + LLM leakage — dl.acm.org/doi/10.1145/3715107
- LLM-assisted MR from specs (not source) — arXiv 2401.17019
- GenMorph search-based MRs — arXiv 2312.15302
- ATUSA generic web invariants — Mesbah & van Deursen, IEEE TSE 2012
- OLLM LLM-as-oracle 49% real NCF bugs — arXiv 2407.19053
- DroidAgent autonomous journeys — arXiv 2311.08649
- WebTestPilot spec-based (sidesteps) — arXiv 2602.11724
- MST-wi security MT — arXiv 2208.09505
- GUI-invariant mobile 23% lift — sciencedirect S0950584924001368
- Daikon — plse.cs.washington.edu/daikon

---

# Part II — Inferring intended requirements DIRECTLY from the (buggy) codebase (2026-05-30)

Second deep-research pass (21 confirmed / 4 refuted, 20 primary sources, 3-vote verified).
Run `wf_da1e22dc-3eb`. Tests the thesis: *an agent can recover the intended requirement even
from buggy source, because a bug is a localized deviation from a codebase saturated with intent
signals.* **Verdict: broadly SUPPORTED, with a precise boundary condition** — and it reframes
the wall from "source is poison" to "source is poison only when you read the wrong layer."

## The reconciliation with the wall (the key intellectual result)

The wall is about oracles consistent with **observed behavior**. But code carries two separable
layers: **declarative intent** (comments, identifiers, types, schemas, constants, enums, error
strings, UI copy, route/test names) and **imperative behavior** (the logic). iComment (SOSP 2007)
proves the information-theoretic crux (3-0): **declarative intent is genuinely NON-derivable from
imperative code alone** — *"at least 37 inconsistencies cannot be detected using only source code
… because different parts of the source code are consistent with each other, but the code does
not match the comments."* That is exactly the user's intuition: consistent-but-wrong code defeats
behavior-only inference, but the **declarative artifact is independent signal that escapes the
contamination**. Comments and code are *"relatively redundant and independent descriptions of the
same semantics"* — comparing them surfaces the buggy outlier.

So: **reading source to recover *declarative intent* HELPS; reading source to mirror *behavior*
HURTS.** The bug becomes an internal inconsistency between the two layers.

## Evidence it catches REAL, developer-confirmed bugs (not coverage)

- **iComment** (SOSP 2007): 1832 intent rules @ 90.8–100% extraction accuracy; 60 inconsistencies
  (33 bugs + 27 bad comments), **19 developer-confirmed** in Linux/Mozilla/Wine/Apache.
- **@tComment** (ICST 2012): 24 Javadoc-vs-body inconsistencies, **4 confirmed + fixed**.
- **LLM + program analysis** (FSE 2024, GPT-4): extracts design constraints from comments, checks
  code conformance → 160 inconsistencies across 13 projects, **23 developer-confirmed + fixed**.
- **Fine-tuned GPT-3.5** (arXiv 2409.10781): inconsistency detection **88.3% F1** (vs 73.6% ADVOC).
  Inconsistent changes are **1.52× more likely** to be bug-introducing within a week (SZZ, 32
  Apache projects).
- **LLM-generated oracles** (ASE 2025, unbiased post-cutoff set): **43% mutation score vs 45%
  human** — near-developer quality.

## The boundary condition (when the thesis FAILS — must design around it)

1. **The declarative signal can itself be the bug.** In @tComment, **3 of 4** confirmed fixes were
   to the *comment*, not the code (the opposite directionality from the thesis). iComment split
   60 finds into 33 bugs **+ 27 bad comments**. When intent and behavior **co-mutate**, the
   inconsistency vanishes and the bug passes → the wall holds.
2. **Declarative artifacts aren't auto-trustworthy:** LLM-generated comments are wrong ~20% of the
   time; **static** comment-vs-code matching has **NO statistically significant relationship with
   comment accuracy** (arXiv 2406.14836, p=0.17–0.75).
3. **Crucial corrective from that same paper:** *dynamic* "document testing" (execute against the
   running system) succeeds where **static** matching fails. → **declarative-vs-behavior gaps must
   be checked DYNAMICALLY against the live app, not statically.** ContractQA already runs contracts
   against the live SUT — this is the right architecture; the fix is the *oracle source*, not the
   execution model.

## Design rules for ContractQA (refines Part I's "firewall from source")

The two parts combine into a sharper rule than "don't read source":

- **DO read source — but extract only the declarative-intent layer** (constants like
  `MAX_TICKETS=2`, zod/TS types, enums, validation, error/toast strings, route & test names, UI
  copy), **never mirror the imperative logic** into assertions. Generate the contract from the
  *declared* intent, then run it against the live app; the deviation is the bug.
- **Triangulate across many redundant signals** and treat the **outlier** component as suspicious
  (code-vs-tests, type-vs-runtime, frontend-vs-backend contract, constant-vs-UI-copy). A lone
  signal can be the bad one; agreement across independent signals is the trustworthy intent.
- **Weight frozen/structural signals over prose:** schemas, types, validation constants, enums >
  free-text comments (comments are wrong ~20%; a `z.number().max(2)` schema rarely is).
- **Check dynamically, never statically** — assert recovered intent against the running SUT.

## Open questions = ContractQA's exact, unfilled research gap

No primary source measures any of these — ContractQA + WebTestBench can be the first:
- Does **multi-signal triangulation** beat single-artifact comment-vs-code, validated against
  **injected web/TS functional bugs**? (Seminal tools cover only null/exception & lock-ordering —
  NOT zod/types/`MAX=2`/enums/UI copy.)
- **Base rate**: how often is an injected functional bug a *localized imperative* deviation (thesis
  works) vs a *co-mutation* that also corrupts the declarative signal (wall holds)? This number
  decides whether reading source helps on net.
- Whole-repo **agentic** intent→invariant recovery, mutation-validated for *real* defect detection.
- A principled **weighting scheme** (frozen constants/schemas > prose; redundant > singleton) that
  cuts the false-positive/bad-comment rate when the declarative artifact is itself wrong.

## Sources (Part II, primary, verified)
- iComment — cs.purdue.edu/homes/lintan/publications/icomment_sosp07.pdf (SOSP 2007)
- @tComment — shinhwei.com/tcomment.pdf + arXiv 1201.6078 (ICST 2012)
- LLM design-constraint conformance — dl.acm.org/doi/10.1145/3663529.3664458 (FSE 2024)
- Fine-tuned LLM inconsistency + SZZ 1.52× — arXiv 2409.10781
- Comment-accuracy / dynamic doc-testing — arXiv 2406.14836
- LLM oracles 43% vs 45% mutation — lucadigrazia.com/papers/ase2025.pdf (ASE 2025)
- Reverse-engineering user stories (fidelity claim REFUTED 0-3) — arXiv 2509.19587
- Daikon false-positive invariants — link.springer.com/.../978-3-031-89277-6_4

## Refuted (excluded)
- "LLMs reconstruct user stories from code at BERTScore F1 ~0.8, no meaning-divergent cases" — 0-3.
- "Comment-code oracle from SUT's own artifacts alone surfaces real bugs with no external ref" — 1-2
  (it confirms the wall as much as the thesis).
- "ASE 2025 green-suite discard = direct evidence of the wall" — 1-2 (over-claim; don't cite).
- "Adding focal/test-class source improved oracle quality" — 1-2 (no measurable benefit).
