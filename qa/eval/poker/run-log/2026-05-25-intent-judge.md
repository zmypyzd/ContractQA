# Intent judge — 2026-05-25

Re-frames ground-truth as "should the product hold this invariant?" rather than "does the SUT currently match?". SUT bugs are orthogonal. Pure body+title analysis; no SUT consulted.

## Headline

- Total contracts: 369
- Agree with current GT: 252 (68.3%)
- **Disagree** with current GT (high confidence): 68
- Borderline (needs your read): 49

## Disagreements — intent-judge thinks current GT is wrong

| # | id | area | current GT | judge verdict | reason |
|---|---|---|---|---|---|
| 1 | api-agent-invites-register-invalid-token | api | dropped | **KEEP** | invariant: input validation |
| 2 | api-agent-invites-revoke-hash-not-found | api | dropped | **KEEP** | intent valid (security/error response); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 3 | api-decision-trace-returns-404-for-missing-match | api | dropped | **KEEP** | intent valid (security/error response); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 4 | api-decision-trace-strips-private-fields | api | dropped | **KEEP** | intent valid (data leak prevention); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 5 | api-matches-decision-trace-returns-match-not-found | api | dropped | **KEEP** | intent valid (input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 6 | api-matches-get-excludes-sensitive-fields | api | dropped | **KEEP** | intent valid (data leak prevention); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 7 | api-matches-get-not-found-invalid-id | api | dropped | **KEEP** | intent valid (input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 8 | api-matches-list-excludes-seed | api | dropped | **KEEP** | intent valid (data leak prevention); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 9 | api-me-werewolf-agents-create-requires-csrf | api | dropped | **KEEP** | intent valid (auth/csrf boundary); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 10 | api-me-werewolf-agents-create-validates-body | api | dropped | **KEEP** | intent valid (input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 11 | api-tables-add-agent-validates-adapter-type | api | dropped | **KEEP** | intent valid (security/error response, input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 12 | api-tables-create-validates-schema | api | dropped | **KEEP** | invariant: security/error response, input validation |
| 13 | api-tables-get-hand-validates-hand-belongs-to-table | api | dropped | **KEEP** | intent valid (input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 14 | api-tables-get-hand-validates-table-exists | api | dropped | **KEEP** | intent valid (input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 15 | api-tables-hand-replay-requires-auth | api | dropped | **KEEP** | intent valid (auth/csrf boundary); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 16 | api-tables-remove-agent-requires-auth | api | dropped | **KEEP** | invariant: auth/csrf boundary |
| 17 | api-tables-watch-not-found-invalid-table | api | dropped | **KEEP** | intent valid (input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 18 | api-werewolf-games-create-validates-name-length | api | dropped | **KEEP** | invariant: security/error response, input validation |
| 19 | api-werewolf-invite-npc-requires-csrf | api | dropped | **KEEP** | intent valid (auth/csrf boundary); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 20 | api-werewolf-match-get-strips-seed | api | dropped | **KEEP** | intent valid (data leak prevention); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 21 | api-werewolf-matches-strips-seed | api | dropped | **KEEP** | intent valid (data leak prevention); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 22 | api-werewolf-start-host-only | api | approved | **DROP** | sharpness: weak:trivial-url-regex |
| 23 | delete-agent-requires-auth | api | dropped | **KEEP** | intent valid (auth/csrf boundary); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 24 | simulate-requires-csrf-token | api | dropped | **KEEP** | intent valid (auth/csrf boundary); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 25 | simulate-validates-request-schema | api | dropped | **KEEP** | intent valid (security/error response, input validation); expression uses dom on http-only action — runner DSL gap, not intent failure |
| 26 | api-auth-register-validates-input | auth | dropped | **KEEP** | invariant: security/error response, input validation |
| 27 | appshell-login-navigates-to-login-page | auth | dropped | **KEEP** | invariant: navigation invariant |
| 28 | login-page-respects-next-param-redirect | auth | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 29 | logout-clears-session-and-redirects | auth | dropped | **KEEP** | invariant: navigation invariant |
| 30 | werewolf-agent-picker-login-link | auth | dropped | **KEEP** | invariant: auth/csrf boundary |
| 31 | werewolf-agent-picker-login-navigation | auth | dropped | **KEEP** | invariant: navigation invariant |
| 32 | werewolf-agent-picker-requires-login | auth | approved | **DROP** | self-consistency: mismatch:title-says-visible-but-no-dom-or-url-assertion |
| 33 | agent-endpoint-url-persists-on-edit | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 34 | agent-name-persists-on-edit-load | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 35 | agents-edit-redirects-when-legacy-disabled | core | dropped | **KEEP** | invariant: navigation invariant |
| 36 | all-in-button-disabled-while-submitting | core | approved | **DROP** | self-consistency: mismatch:title-says-removal-but-asserts-presence |
| 37 | appshell-invite-button-close-toggle | core | dropped | **KEEP** | default-keep: sharp body + weak signal (tab-switching UI (specific to current layout)) |
| 38 | audience-fire-reaction-increment | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 39 | audience-react-clap-multiple-clicks | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 40 | audience-react-heart-increments-count | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 41 | audience-react-heart-independent-counts | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 42 | audience-reactions-start-at-zero | core | approved | **DROP** | sharpness: weak:noise-needles-only |
| 43 | audience-strip-shows-watching-count | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 44 | audience-wolf-reaction-increment | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 45 | audience-wolf-reaction-initial-zero | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 46 | check-action-button-disabled-while-submitting | core | approved | **DROP** | self-consistency: mismatch:title-says-removal-but-asserts-presence |
| 47 | check-action-button-visible-when-legal | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 48 | confirm-dialog-cancel-closes-dialog | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 49 | home-route-shows-loading-state | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 50 | invite-http-agent-copies-to-clipboard | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 51 | invite-http-clipboard-fallback-shows-text | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 52 | invite-popover-coding-api-error-toast | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 53 | invite-popover-coding-generates-invite | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 54 | lobby-seed-input-accepts-optional-value | core | approved | **DROP** | sharpness: weak:empty-contains-text |
| 55 | match-replay-redirects-when-legacy-disabled | core | dropped | **KEEP** | invariant: navigation invariant |
| 56 | matches-open-replay-link-navigates | core | dropped | **KEEP** | invariant: navigation invariant |
| 57 | raise-slider-shows-validation-error | core | approved | **DROP** | sharpness: weak:noise-needles-only |
| 58 | replay-hand-select-button-updates-view | core | approved | **DROP** | sharpness: weak:empty-contains-text |
| 59 | replay-next-button-advances-timeline | core | approved | **DROP** | sharpness: weak:empty-contains-text |
| 60 | replay-street-filter-resets-on-hand-change | core | approved | **DROP** | sharpness: weak:empty-contains-text |
| 61 | route-table-redirect-when-disabled | core | dropped | **KEEP** | invariant: navigation invariant |
| 62 | table-preset-amount-clears-error | core | dropped | **KEEP** | default-keep: sharp body + weak signal (UI affordance (optional feature), tab-switching UI (specific to current layout)) |
| 63 | table-preset-amount-sets-bet-value | core | dropped | **KEEP** | default-keep: sharp body + weak signal (UI affordance (optional feature), tab-switching UI (specific to current layout)) |
| 64 | werewolf-lobby-recent-tab-filters-completed-games | core | approved | **DROP** | self-consistency: mismatch:title-says-keyboard-but-no-key-action |
| 65 | werewolf-lobby-tab-featured-active-state | core | approved | **DROP** | self-consistency: mismatch:title-says-keyboard-but-no-key-action |
| 66 | werewolf-lobby-tab-live-filters-games | core | approved | **DROP** | self-consistency: mismatch:title-says-keyboard-but-no-key-action |
| 67 | werewolf-room-wrapped-in-app-shell | core | dropped | **KEEP** | default-keep: sharp body + self-consistent + has assertion |
| 68 | match-replay-tab-switch-to-replay | poker | approved | **DROP** | self-consistency: mismatch:title-says-keyboard-but-no-key-action |

**To apply**: for each row where you agree with the judge, flip the GT file:
- DROP → set provenance.status=dropped, review.validity=fp
- KEEP → set provenance.status=approved, review.validity=tp

## Borderline — judge has no strong signal

49 contracts. Grouped into clusters of similar product affordance. For each cluster: decide once (k/d/m), applies to all members. Per-cluster decisions live in qa/eval/poker/run-log/borderline-decisions.txt — see "How to apply" below.

### 37 clusters (largest first)

#### Cluster 1: `api|get-tables-tableid` — 4 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-get-not-found | dropped | GET /tables/:tableId returns error for non-existent table |
| api-tables-get-returns-table-state | dropped | GET /tables/:tableId returns public table state for valid table |
| api-tables-get-state-not-found | dropped | GET /tables/:tableId/state returns error for non-existent table |
| api-tables-list-hands-table-not-found | dropped | GET /tables/:tableId/hands returns error for non-existent table |

#### Cluster 2: `api|authenticated-user-can` — 3 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-leave-seat-success | dropped | Authenticated user can leave their seat at a table |
| api-tables-sit-human-success | dropped | Authenticated user can sit at a table seat |
| api-werewolf-games-create-success | approved | Authenticated user can create a werewolf game lobby |

#### Cluster 3: `api|delete-tables-tableid` — 3 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-leave-seat-not-found | dropped | DELETE /tables/:tableId/seats/me returns error for non-existent table |
| api-tables-remove-agent-not-found | dropped | DELETE /tables/:tableId/agents/:agentId returns error for non-existent agent |
| delete-table-returns-deleted-true | dropped | DELETE /tables/:tableId returns deleted confirmation for owner |

#### Cluster 4: `api|get-werewolf-matches` — 3 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-werewolf-match-get-not-found | dropped | GET /werewolf-matches/:matchId returns error for non-existent match |
| api-werewolf-match-get-returns-public-manifest | dropped | GET /werewolf-matches/:matchId returns public manifest without private files |
| api-werewolf-matches-list | approved | GET /werewolf-matches returns array of match artifacts |

#### Cluster 5: `api|delete-agents-agentid` — 2 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| delete-agent-in-use-blocked | dropped | DELETE /me/agents/:agentId blocked when agent is seated in live game |
| delete-agent-not-found | dropped | DELETE /me/agents/:agentId returns error for non-existent agent |

#### Cluster 6: `api|get-agents-agentid` — 2 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-agents-get-not-found-error | dropped | GET /me/agents/:agentId returns error for non-existent agent |
| api-me-agents-get-returns-agent-data | dropped | GET /me/agents/:agentId returns agent config for owner |

#### Cluster 7: `api|patch-agents-agentid` — 2 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-agents-update-not-found | dropped | PATCH /me/agents/:agentId returns error for non-existent agent |
| api-me-agents-update-returns-updated-agent | dropped | PATCH /me/agents/:agentId returns updated agent data on success |

#### Cluster 8: `api|adding-agent-non` — 1 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-add-agent-table-not-found | dropped | Adding agent to non-existent table returns error |

#### Cluster 9: `api|agent-registration-fails` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-agent-invites-register-used-token | dropped | Agent registration fails with already-used invite token |

#### Cluster 10: `api|api-failure-generating` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| invite-http-agent-api-failure-shows-error | dropped | API failure when generating HTTP invite shows error toast |

#### Cluster 11: `api|confirming-deletion-calls` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| agents-delete-confirm-calls-api | dropped | Confirming deletion calls the delete API endpoint |

#### Cluster 12: `api|decision-trace-endpoint` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-matches-decision-trace-excludes-private-fields | dropped | Decision trace endpoint excludes privateStateHash and reasoningSummary |

#### Cluster 13: `api|external-agent-registration` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-agent-invites-register-valid-token | dropped | External agent registration succeeds with valid unused invite token |

#### Cluster 14: `api|get-agents-does` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-agents-list-no-auth-secret-leak | dropped | GET /me/agents does not expose authHeaderValue |

#### Cluster 15: `api|get-agents-invites` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-agent-invites-list-requires-auth | dropped | GET /agents/invites requires JWT authentication |

#### Cluster 16: `api|get-agents-responses` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-agents-list-no-cache | dropped | GET /me/agents responses include no-store cache headers |

#### Cluster 17: `api|get-matches-matchid` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-matches-get-returns-manifest-and-summary | dropped | GET /matches/:matchId returns match artifact with manifest and summary |

#### Cluster 18: `api|get-werewolf-agents` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-werewolf-agents-list-returns-user-agents | dropped | GET /me/werewolf-agents returns only current user's werewolf agents |

#### Cluster 19: `api|get-werewolf-games` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| werewolf-game-get-anonymous-access-allowed | dropped | GET /werewolf-games/:gameId is accessible without authentication |

#### Cluster 20: `api|only-game-creator` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-werewolf-invite-npc-host-only | dropped | Only game creator can invite NPC to werewolf seat |

#### Cluster 21: `api|only-owner-can` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| invite-agent-owner-check | dropped | Only the owner can invite their registered HTTP agent to a seat |

#### Cluster 22: `api|only-table-owner` — 1 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-start-hand-owner-only | dropped | Only table owner can start a new hand |

#### Cluster 23: `api|post-agents-invites` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-agent-invites-create-returns-token-once | approved | POST /agents/invites returns raw token with no-store cache headers |

#### Cluster 24: `api|post-agents-responses` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-agents-no-cache-headers | approved | POST /me/agents responses include no-store cache headers |

#### Cluster 25: `api|post-agents-returns` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-me-agents-create-returns-201 | approved | POST /me/agents returns 201 with created agent data |

#### Cluster 26: `api|post-tables-returns` — 1 members
Signals: tab-switching UI (specific to current layout); info:title-mentions-201-no-dom-or-url

| id | current GT | title |
|---|---|---|
| api-tables-create-returns-201 | dropped | POST /tables returns 201 with table data on success |

#### Cluster 27: `api|post-tables-tableid` — 1 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-watch-success-no-content | dropped | POST /tables/:tableId/watch returns 204 on successful spectator registration |

#### Cluster 28: `api|post-werewolf-action` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| werewolf-action-requires-bearer-token | approved | POST /werewolf/action requires valid Bearer token |

#### Cluster 29: `api|seating-http-agent` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| sit-http-agent-requires-auth | dropped | Seating HTTP agent requires authentication |

#### Cluster 30: `api|seating-non-existent` — 1 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-sit-human-not-found | dropped | Seating at non-existent table returns error |

#### Cluster 31: `api|starting-hand-non` — 1 members
Signals: tab-switching UI (specific to current layout)

| id | current GT | title |
|---|---|---|
| api-tables-start-hand-table-not-found | dropped | Starting hand on non-existent table returns TABLE_NOT_FOUND error |

#### Cluster 32: `api|successfully-revoking-invite` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-agent-invites-revoke-hash-success-no-content | dropped | Successfully revoking invite returns 204 No Content |

#### Cluster 33: `api|werewolf-sse-stream` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| werewolf-stream-accessible-anonymous | dropped | Werewolf SSE stream endpoint is accessible to anonymous spectators |

#### Cluster 34: `auth|failed-login-error` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| login-form-submit-error-displayed | dropped | Failed login displays error message |

#### Cluster 35: `auth|post-auth-register` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| api-auth-register-rate-limited | dropped | POST /auth/register enforces rate limiting |

#### Cluster 36: `core|invite-npc-triggers` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| werewolf-agent-picker-invite-npc | dropped | Invite NPC button triggers onInviteNpc callback |

#### Cluster 37: `core|selecting-agent-picker` — 1 members
Signals: (no signal)

| id | current GT | title |
|---|---|---|
| werewolf-agent-picker-select-agent | approved | Selecting an agent from picker invites agent to seat |


## How to apply

### Step 1 — apply high-confidence disagreements

Edit `qa/eval/poker/run-log/intent-judge-decisions.txt` (one line per change you accept):
```
# format: <id>\t<KEEP|DROP|MERGE:<canonical>>\t<optional note>
agents-connect-empty-bearer-token	DROP	dom-after-http; weak assertion
api-tables-create-validates-schema	KEEP	input validation invariant
```
Then run `node scripts/eval/apply-intent-judge.mjs` to overwrite the matching GT files.

### Step 2 — borderline by cluster

For each cluster, append a single decision to `intent-judge-decisions.txt`:
```
# uses CLUSTER:<key> prefix to apply to every member
CLUSTER:core|preset-amount-button	DROP	not in fixture spec
CLUSTER:core|tab-active-state	KEEP	standard UI tabs
```
apply-intent-judge.mjs expands these into per-member writes.

### Step 3 — re-score

```
node scripts/eval/score.mjs --project poker --autopilot-dir /Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts --out qa/eval/poker/score-2026-05-25-postjudge.json
```
## Agreement summary

- KEEP confirmed: 209
- DROP confirmed: 43
- MERGED (intent-judge treats as not-applicable): 8

