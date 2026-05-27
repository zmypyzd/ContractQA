# Stream 5 — DOM rich-assertion schema extension

> **Status:** design only (2026-05-27). No code shipped. Gates Stream 3 (11/12
> REPLACE contracts) and Stream 4 (7/9 STRENGTHEN contracts).

## Problem

Current `expected.dom` only supports:
- `contains_text` / `not_contains_text` — substring against `visibleText`
- `role_count` — count elements by ARIA role + name regex

This is insufficient for the contracts in Stream 3 + 4 that need:
- **disabled-attribute assertions** (e.g. All-in button disabled while submitting)
- **input value assertions** (e.g. seed input retains value after fill)
- **class / data-attribute checks** (e.g. tab active state via class)
- **aria-state checks** (e.g. aria-selected="true" on active tab)
- **scoped numeric checks** (e.g. counter element shows exactly "0")

## Proposal: 4 new DomExpected fields

```ts
// packages/oracle/src/dom-classifier.ts
interface DomExpected {
  // ...existing fields preserved
  attribute_equals?: Array<{
    target: Target;            // reuses Target shape: role/name_regex/test_id/text/within
    attribute: string;          // e.g. "disabled", "aria-selected", "data-tab-active"
    equals: string | boolean;   // boolean for present/absent (disabled="" treated as true)
  }>;
  input_value?: Array<{
    target: Target;
    equals?: string;
    matches?: string;           // SafeRegex
  }>;
  class_contains?: Array<{
    target: Target;
    class: string;
  }>;
  element_text_equals?: Array<{
    target: Target;             // for scoped numeric: target the count element specifically
    equals: string;
  }>;
}
```

All four use the existing `Target` shape so authors don't learn a new selector
DSL. All four are strict zod objects. Adding `.strict()` to DomExpected at
the same time is the rigorous follow-up (G19 generalization to dom block).

## DomShape extension

`DomShape` currently carries `roleCounts` + `visibleText`. The new assertions
need per-element attribute data. Two architectural options:

### Option A: capture all (eager)

Snapshot every interactive element's attributes + value + classes during
`snapshotBrowser`. DomShape grows by ~50KB on rich pages.

```ts
interface DomShape {
  roleCounts: Record<string, number>;
  visibleText: string;
  elements: Array<{
    role: string;
    name: string;
    attributes: Record<string, string>;  // includes value, class, disabled, aria-*
    text: string;
  }>;
}
```

Pros: classifier is pure (no live DOM access), evidence bundle captures
everything for replay/debugging.
Cons: snapshot size, slower probe.

### Option B: capture on demand (lazy)

Pass `expected.dom` into snapshotBrowser so it knows which targets to query.
Classifier and probe couple but data is precise.

Pros: small snapshots, only what's needed.
Cons: re-running with a different expected block requires re-snapshotting;
classifier can no longer be pure.

**Recommendation: Option A.** ContractQA's philosophy ("snapshot first, judge
later") aligns with eager capture. The 50KB cost is bounded and DOM evidence
is useful for human debugging.

## Snapshot probe changes

`packages/probes/src/browser-snapshot.ts` already walks `[role], a, button,
h1, h2, h3, input, [aria-label]` for role counts. Extend the walk to also
capture: `value`, `disabled`, `aria-*`, `class`, `data-*`, `textContent`.
~30 LOC.

## Classifier changes

`packages/oracle/src/dom-classifier.ts` adds 4 new evaluator blocks (one
per new field). Each loops over the captured `elements` array, matches by
target shape (role + name_regex + within), and compares. ~120 LOC + tests.

## CLI prompts

Both `interaction-discovery.ts` and `llm-discovery.ts` system prompts list
the new fields under the `expected.dom` schema description. ~10 lines each.
Pattern is identical to Stream 1's http additions.

## Contracts unblocked

### Stream 3 (11 of 12 REPLACEs)
| Contract | Uses |
|---|---|
| all-in-button-disabled-while-submitting | attribute_equals: disabled=true |
| audience-reactions-start-at-zero | element_text_equals: "0" |
| check-action-button-disabled-while-submitting | attribute_equals: disabled=true |
| lobby-seed-input-accepts-optional-value | input_value: equals |
| raise-slider-shows-validation-error | element_text_equals (scoped) |
| replay-hand-select-button-updates-view | url change + class_contains |
| replay-next-button-advances-timeline | element_text_equals on timeline counter |
| replay-street-filter-resets-on-hand-change | element_text_equals: "all" |
| werewolf-lobby-recent-tab-filters-completed-games | element_text_equals on list area |
| werewolf-lobby-tab-featured-active-state | attribute_equals: aria-selected=true |
| werewolf-lobby-tab-live-filters-games | element_text_equals on list area |

### Stream 4 (7 of 9 STRENGTHENs)
| Contract | Uses |
|---|---|
| audience-strip-shows-watching-count | element_text_equals (scoped count) |
| agent-name-persists-on-edit-load | input_value: equals |
| appshell-invite-button-close-toggle | role_count (already works) + sequence |
| audience-react-heart-independent-counts | element_text_equals before+after |
| audience-wolf-reaction-initial-zero | element_text_equals: "0" |
| check-action-button-visible-when-legal | preconditions (Stream 2 残量 already covers) |
| confirm-dialog-cancel-closes-dialog | role_count sequence (already works) |
| table-preset-amount-sets-bet-value | input_value: equals |
| werewolf-room-wrapped-in-app-shell | class_contains on app-shell container |

## Implementation order

1. `core` schema additions + tests (1 commit)
2. `probes` snapshotBrowser eager capture + tests (1 commit)
3. `oracle` dom-classifier evaluators + tests (1 commit)
4. `cli` prompt updates + interaction-discovery + llm-discovery (1 commit)
5. Stream 3 REPLACE contracts (1 commit, 11 contracts via script)
6. Stream 4 STRENGTHEN contracts (1 commit, 9 contracts)

Estimated: ~600 LOC + ~80 contracts of YAML, plus tests.

## What ships RIGHT NOW (without Stream 5)

- Stream 3 partial: `api-werewolf-start-host-only-REPLACE.yml` (uses Stream 1
  `expected.http`, no DOM needed) — landed in this commit.
- Everything else in Stream 3 + 4 is GATED on Stream 5 landing.
