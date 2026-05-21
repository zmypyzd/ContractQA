# Eval Contract Schema

Defines the contract format used as **ground truth** for evaluating
ContractQA's deep-discovery agent. Extends the agent's existing YAML
format (`qa/contracts/**/*.yml`) with `category`, `provenance`, and
`review` metadata so we can compute honest precision / recall /
severity-agreement / blind-spot metrics.

## Workflow this schema supports

1. **Autopilot generates** contracts → `qa/contracts/**/*.yml` (raw output, untouched).
2. **Step 2 — review**: reviewer opens the product, verifies each contract,
   fills `review` + `provenance`, writes the approved copy into
   `qa/eval/<project>/ground-truth/<id>.yml`. Dropped and merged contracts
   are also written here (with `status: dropped|merged`) because they are
   evidence for precision / dedup-inflation metrics.
3. **Step 3 — exploration**: reviewer walks `checklist.md` with Claude Code,
   adds contracts the agent missed, marks them `provenance.source: human-explore`.
4. **Freeze**: tag with `git tag eval-v0-<project>-YYYYMMDD` so future agent
   versions can be re-scored against the same frozen set.

## Schema

```yaml
# --- existing agent fields (preserve verbatim when sourced from autopilot) ---
id: folder-picker-backdrop-click-closes
title: Clicking the backdrop closes the folder picker dialog
area: core
severity: P2                       # legacy; review.severity_final is canonical
preconditions:
  folder_picker: open
actions:
  - type: click
    target: { role: presentation, name: backdrop }
expected:
  dialog_visible: false

# --- eval-only fields ---
category: [happy-path, a11y]       # one or more, from checklist.md

provenance:
  source: autopilot                # autopilot | human-explore
  generated_at: 2026-05-21T10:00:00Z
  reviewed_by: marchettireeva
  reviewed_at: 2026-05-21T14:30:00Z
  status: approved                 # approved | dropped | merged
  duplicates_of: []                # canonical id(s) this absorbs, when status: merged

review:
  validity: tp                     # tp = real expected behavior, fp = hallucinated/wrong
  validity_verified_in_product: true   # MUST be true for status: approved
  specificity: 2                   # 0 = vague, 1 = testable, 2 = sharp/exact-match
  severity_original: P2            # agent's value
  severity_final: P2               # canonical post-review value
  notes: |
    Verified by clicking backdrop on /runs page. Merged in
    folder-picker-backdrop-click-closes-dialog,
    folder-picker-backdrop-click-dismisses-modal,
    folder-picker-backdrop-close (all describe the same behavior).
```

## Status semantics

| status     | counts in GT? | meaning                                                                                       |
|------------|---------------|-----------------------------------------------------------------------------------------------|
| `approved` | yes           | Real expected behavior, verified in product. `validity_verified_in_product` MUST be `true`.   |
| `dropped`  | no            | Agent emitted but reviewer rejected (hallucinated, wrong, or describes a bug as if expected). |
| `merged`   | no            | Duplicate of another approved contract; `duplicates_of` points to the canonical id.           |

Keep dropped/merged files on disk — they are the evidence for precision and
dedup-inflation. Don't silently delete agent output during review.

## Categories

Every `approved` contract carries ≥ 1 `category` from `checklist.md`. Categories
are used for per-category coverage analysis. In step 3 the reviewer is required
to log `contracts_added: N` per category — including `0` — so that "looked,
found nothing" is distinguishable from "didn't look".

## Metrics (computed at eval time, not stored in contracts)

Let `GT = {c | status == approved}` (collapsed by `duplicates_of`), and let
`A` = the agent output set on a fresh autopilot run of the same project,
also collapsed by the same `duplicates_of` mapping.

```
precision        = |A ∩ GT| / |A|
recall           = |A ∩ GT| / |GT|

GT_human         = {c ∈ GT : provenance.source == human-explore}
net_new_recall   = |A ∩ GT_human| / |GT_human|     # honest blind-spot indicator

fp_rate          = |{c ∈ A : status == dropped}| / |A|
dedup_inflation  = |{c ∈ A : status == merged}|  / |A|
severity_agree   = mean(review.severity_original == review.severity_final
                        over A ∩ GT)
```

`net_new_recall` is the metric that calls bullshit on the eval set. If
`recall` is high but `net_new_recall` is low, the agent is good only at
the categories it already thinks about and the eval set has been recall-
inflated by step-2 contracts. That's diagnostic, not fatal — just don't
report `recall` without `net_new_recall` next to it.

## Match rule (A ↔ GT)

Two contracts match iff:
- their canonical `id` is identical (after applying `duplicates_of` to both sides), OR
- their `(area, actions[*].path, expected.*)` triple is identical after normalization
  (lower-case, trailing slash collapsed, query params sorted).

Implementation lives outside this spec — when you build the scoring script,
encode the rule there. Until then, manual matching is fine for two projects.

## Directory layout

```
qa/
  contracts/                       # raw agent output (existing, do not modify)
  eval/
    schema.md                      # this file
    checklist.md                   # step-3 category probes
    <project-slug>/
      ground-truth/
        <id>.yml                   # one per approved/dropped/merged contract
      run-log/
        2026-05-21-step2.md        # step-2 review notes
        2026-05-21-step3.md        # step-3 per-category outcomes
```

## Minimum required fields for an `approved` contract

The reviewer's checklist before flipping a contract to `status: approved`:

- [ ] `review.validity == tp`
- [ ] `review.validity_verified_in_product == true` (actually opened the product)
- [ ] `review.specificity >= 1` (contract is testable, not a vibe)
- [ ] `review.severity_final` set (don't blindly inherit agent's value)
- [ ] `category` has ≥ 1 entry
- [ ] If this absorbs duplicates → siblings written with `status: merged`
  and `duplicates_of: [<this id>]`
- [ ] `provenance.reviewed_by` and `provenance.reviewed_at` populated
