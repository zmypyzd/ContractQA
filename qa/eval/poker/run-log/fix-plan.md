# Fix plan — derived from qa/CONTRACT_GAPS_DECISION_PAGE.md

Generated: 2026-05-27. Applied by `scripts/eval/apply-user-review.mjs`.

## Done (already applied to qa/eval/poker/ground-truth/)

| Class | Count | What was applied |
|---|---|---|
| DROPs (14) | 13 | GT flipped to dropped + user rationale in notes |
| Group A — dom-after-http (20) | 20 | GT kept approved, REWRITE target stamped in notes |
| Group B — no-expected (5) | 5 | GT kept approved, source-edit instruction stamped in notes |
| Group C — vacuous flip (4) | 4 | GT flipped to dropped (vacuous single-char needles) |
| Group C — strengthen (1) | 1 | GT kept approved, strengthen note stamped |
| Group D — strengthen (8) | 8 | GT kept approved, strengthen note stamped |
| Group E — precondition (3) | 3 | GT kept approved, precondition gap stamped |
| Group F — clean keep (14) | 14 | GT kept approved, confidence note stamped |

Total GT updates: 68.

## Outstanding — needs source contract edits, new contracts, or runner DSL changes

### Stream 1: 🚨 Runner DSL extension (THIS WEEK — gates 20+ contracts)

1. **Extend `packages/core/src/schemas/contract.schema.ts`**: add `expected.http` block:
   ```ts
   http: z.object({
     status: z.union([z.number().int(), z.array(z.number().int())]).optional(),
     body: z.object({
       contains: z.array(z.string()).optional(),
       not_contains: z.array(z.string()).optional(),
       contains_keys: z.array(z.string()).optional(),
       not_contains_keys: z.array(z.string()).optional(),
     }).optional(),
     headers: z.record(z.string()).optional(),
   }).optional(),
   ```
2. **`packages/oracle/src/declared-fields.ts`**: classify `expected.http` against the response captured by the `http` action.
3. **`packages/runner/src/compile.ts`**: extend `http` action to capture response (status + body); pass into oracle.
4. **Strictness check**: if `expected.dom` is asserted AND no goto/click/fill in actions (only http), emit an ERROR rather than silently evaluating dom on the wrong page.
5. New CONTRACT_GAPS entries: **G18 (HTTP action must use http assertion)**, **G19 (every contract must have evaluable expected block)**.

### Stream 2: 📝 Source contract edits (after DSL lands)

> **Status (2026-05-27):** Stream 2 ✅ fully done.
> - Group A (20) + 1 Group B rescue → `apply-stream2-rewrites.mjs`
> - Group B (4 remaining) + Group E (3) → `apply-stream2-group-be.mjs`
>   (Group E required schema extension: preconditions.feature_flags as
>    Record<string, boolean>)
> - All 28 contracts validated 28/28 via `scripts/eval/validate-stream2.mjs`.
> Streams 3 + 4 remain.

**Group B — 5 NO_EXPECTED contracts to fix:**

| Contract | Severity | Add expected |
|---|---|---|
| `api-tables-remove-agent-requires-auth` | P0 | `{"http":{"status":401}}` |
| `api-tables-create-validates-schema` | P1 | `{"http":{"status":400}}` |
| `api-auth-register-validates-input` | P1 | `{"http":{"status":400}}` |
| `api-agent-invites-register-invalid-token` | P1 | `{"http":{"status":404}}` |
| `api-werewolf-games-create-validates-name-length` | P2 | `{"http":{"status":400}}` |

**Group E — 3 precondition additions:**

| Contract | Severity | Add precondition |
|---|---|---|
| `agents-edit-redirects-when-legacy-disabled` | P2 | `{"feature_flags":{"legacy_modules":false}}` |
| `match-replay-redirects-when-legacy-disabled` | P2 | `{"feature_flags":{"legacy_modules":false}}` |
| `route-table-redirect-when-disabled` | P1 | `{"feature_flags":{"legacy_modules":false}}` |

**Group A — 20 dom-after-http REWRITEs (after http DSL lands):**

| Contract | Severity | Rewrite target |
|---|---|---|
| `api-me-werewolf-agents-create-requires-csrf` | P0 | http.status: 403 + body has no agentId |
| `api-tables-hand-replay-requires-auth` | P0 | http.status: 401 |
| `simulate-requires-csrf-token` | P0 | http.status: 403 |
| `delete-agent-requires-auth` | P0 | http.status: 401 |
| `api-decision-trace-strips-private-fields` | P1 | http.status: 200 + body.not_contains_keys: [privateStateHash, reasoningSummary] |
| `api-matches-list-excludes-seed` | P1 | http.status: 200 + body items not_contains_keys: [seed] |
| `api-matches-get-excludes-sensitive-fields` | P1 | http.status: 200 + body.not_contains_keys: [seed, internalState] |
| `api-werewolf-match-get-strips-seed` | P1 | http.status: 200 + body.not_contains_keys: [seed] |
| `api-werewolf-matches-strips-seed` | P1 | http.status: 200 + body.not_contains_keys: [seed] |
| `api-werewolf-invite-npc-requires-csrf` | P1 | http.status: 403 |
| `api-agent-invites-revoke-hash-not-found` | P1 | http.status: 404 |
| `api-decision-trace-returns-404-for-missing-match` | P1 | http.status: 404 |
| `api-tables-get-hand-validates-hand-belongs-to-table` | P1 | http.status: 403/404 + body error code (IDOR) |
| `api-tables-get-hand-validates-table-exists` | P1 | http.status: 404 |
| `api-me-werewolf-agents-create-validates-body` | P1 | http.status: 400 + body.contains: validation_error |
| `api-tables-add-agent-validates-adapter-type` | P1 | http.status: 400 + body explains adapter constraint |
| `api-tables-watch-not-found-invalid-table` | P1 | http.status: 404 |
| `simulate-validates-request-schema` | P1 | http.status: 400 |
| `api-matches-get-not-found-invalid-id` | P2 | http.status: 404 |
| `api-matches-decision-trace-returns-match-not-found` | P2 | http.status: 404 |

### Stream 3: 🆕 REPLACE contracts (12 — partial 1/12 done, 11 gated on Stream 5)

> **Status (2026-05-27):**
> - ✅ `api-werewolf-start-host-only` → REPLACE shipped as
>   `api-werewolf-start-host-only-REPLACE.yml` (P0 API contract using Stream
>    1's expected.http; doesn't need DOM extension).
> - ⏳ 11 remaining REPLACEs need DOM rich-assertion schema (attribute_equals,
>   input_value, class_contains, element_text_equals). Gated on Stream 5.
>   See `docs/stream5-dom-rich-assertions.md` for the design.



| Dropped contract | Severity | What to write instead |
|---|---|---|
| `api-werewolf-start-host-only` | P0 | P0 domain rule: only game creator can start. Rewrite as http POST + auth/role assertion via status code. |
| `all-in-button-disabled-while-submitting` | P1 | Real intent: All-in button is disabled during submission. Need disabled-attribute or aria-disabled assertion + scoped to All-in button. |
| `audience-reactions-start-at-zero` | P2 | Use scoped selector + number-equals on the counter element initial state. |
| `check-action-button-disabled-while-submitting` | P1 | Same shape as all-in. Disabled-attribute assertion on Check button. |
| `lobby-seed-input-accepts-optional-value` | P3 | Assert input.value after fill action. |
| `raise-slider-shows-validation-error` | P1 | Scope to the validation error element + specific illegal raise scenario. |
| `replay-hand-select-button-updates-view` | P1 | Verify view changed via diff signature or hand id in URL/DOM. |
| `replay-next-button-advances-timeline` | P1 | Assert timeline index increments by 1. |
| `replay-street-filter-resets-on-hand-change` | P2 | Assert filter UI shows "all" after hand change. |
| `werewolf-lobby-recent-tab-filters-completed-games` | P2 | Assert list content changed (different games shown). |
| `werewolf-lobby-tab-featured-active-state` | P2 | Assert active class or aria-selected on Featured tab. |
| `werewolf-lobby-tab-live-filters-games` | P2 | Assert list content changed (live games only). |

### Stream 4: 💪 STRENGTHEN existing contracts (9 — 2/9 doable now, 7 gated on Stream 5)

> **Status (2026-05-27):**
> - 2/9 doable with current schema (`appshell-invite-button-close-toggle`,
>   `confirm-dialog-cancel-closes-dialog` — both use role_count sequences).
> - 7/9 gated on Stream 5 DOM rich-assertion extension.
> - Not yet shipped — sequencing after Stream 5 lands so the 7 can ship in
>   one cohesive batch.



| Contract | Severity | Change |
|---|---|---|
| `audience-strip-shows-watching-count` | P2 | Add scoped numeric assertion on count element; current "watching"/"AUDIENCE" needles are better than single-char but still weak. |
| `agent-name-persists-on-edit-load` | P1 | Add attribute: value, equals: ${fixture.agent.name} — currently only asserts textbox presence. |
| `appshell-invite-button-close-toggle` | P3 | G16 toggle half: add intermediate "dialog count == 1" assertion between open and close. |
| `audience-react-heart-independent-counts` | P3 | Currently only asserts both buttons exist. Rewrite: click ❤️ then assert ❤️ +1 AND 🔥 unchanged. |
| `audience-wolf-reaction-initial-zero` | P3 | Add count.text_equals: "0" on the wolf counter element; currently only asserts button presence. |
| `check-action-button-visible-when-legal` | P1 | Add preconditions describing the game state where Check is legal; currently not setting up state. |
| `confirm-dialog-cancel-closes-dialog` | P1 | G16 toggle half + no setup. Add: open dialog → assert count==1 → click cancel → assert count==0. |
| `table-preset-amount-sets-bet-value` | P1 | Add input.value: <expected preset amount>; currently only asserts textbox presence. |
| `werewolf-room-wrapped-in-app-shell` | P2 | Scope to app-shell container and assert inner content is werewolf room; "navigation" element appears on every page. |

## Priority matrix (per user review § 优先级 Action 矩阵)

### 🔥 This week — P0 silent-pass exposure
1. Land runner DSL extension (Stream 1)
2. Add expected blocks to 5 Group B contracts (Stream 2 sub-1)
3. REWRITE 8 P0/P1 security contracts from Group A:
   - `api-me-werewolf-agents-create-requires-csrf` (P0) → http.status: 403 + body has no agentId
   - `api-tables-hand-replay-requires-auth` (P0) → http.status: 401
   - `simulate-requires-csrf-token` (P0) → http.status: 403
   - `delete-agent-requires-auth` (P0) → http.status: 401
   - `api-decision-trace-strips-private-fields` (P1) → http.status: 200 + body.not_contains_keys: [privateStateHash, reasoningSummary]
   - `api-matches-list-excludes-seed` (P1) → http.status: 200 + body items not_contains_keys: [seed]
   - `api-matches-get-excludes-sensitive-fields` (P1) → http.status: 200 + body.not_contains_keys: [seed, internalState]
   - `api-werewolf-match-get-strips-seed` (P1) → http.status: 200 + body.not_contains_keys: [seed]

### ⚠️ This month
- REWRITE remaining 12 Group A contracts
- Add legacy_modules preconditions (Group E)
- REPLACE 10 valuable DROP-ed contracts (Stream 3)
- STRENGTHEN 9 contracts (Stream 4)

### 💡 Continuous
- Rewrite 4 audience reaction contracts using structural foreach (per user template)
- Consolidate 3 agent-picker contracts
