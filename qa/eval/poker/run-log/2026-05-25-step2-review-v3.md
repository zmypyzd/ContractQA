# Step 2 review log — poker (5-4-claude fixture) — 2026-05-25

Reviewer: <fill in>
Source: `/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts/`
Autopilot baseline: `AUTOPILOT_REPORT.json` (phase B + 4 smoke patterns)
Run log: `/tmp/run-2026-05-25-v3-with-auth.log` (347 loaded, 22 schema-skipped, 199 passed, 148 failed)

> **Process** — for each row, open the contract YAML + the product, fill `decision` (`approved`/`dropped`/`merged`) and `duplicates_of`. Materialize approved/dropped/merged into `qa/eval/poker/ground-truth/<id>.yml` per `qa/eval/schema.md`. Don't silently delete dropped/merged — they're evidence for fp_rate and dedup_inflation.

## Headline numbers

| Bucket | Count | % of 369 |
|---|---|---|
| Loaded (schema valid) | 347 | 94.0% |
| Schema-skipped | 22 | 6.0% |
| Run: PASS | 199 | 53.9% |
| Run: FAIL | 148 | 40.1% |

## Schema-skip reasons (top 6)

| Count | First-issue (truncated to 80 chars) |
|---|---|
| 21 | schema: Required |
| 1 | schema: Expected string, received object |

These rows are unrunnable as-is. **decision** for them defaults to `dropped` unless reviewer judges the *intent* is correct and the autopilot just emitted a malformed shape; in that case `approved` is fine but include a note ("schema bug, intent valid").

## Run failures by area (148)

| Area | Failed |
|---|---|
| core | 137 |
| auth | 6 |
| poker | 5 |

Failures now break down into two real signal classes (with the runner bug + auth gap closed): **(a)** locator timeout — element doesn't exist on the page the contract navigated to (agent hallucinated UI, OR contract needs more state than a fresh logged-in user has, e.g. existing tables/matches); **(b)** strict-mode multi-match — agent's `name_regex` matches several elements, contract needs `first: true` or `within:` scope. Reviewer should mark `dropped` when the feature truly doesn't exist, `approved` when the intent is real but selector/state needs sharpening.

## Run passes by area (199)

| Area | Passed |
|---|---|
| api | 110 |
| core | 44 |
| auth | 37 |
| smoke | 4 |
| werewolf | 3 |
| poker | 1 |

PASSes are the most reliable signal — runner exercised the contract and the SUT matched expectations. Suggested review order: PASS rows first (fastest `verified_in_product` confirmation), then FAIL+intent-valid, then schema-skipped.

## Decision table (369 rows)

Fill `decision` ∈ {`approved`, `dropped`, `merged`}, `duplicates_of` if merged, `verified_in_product` (`y`/`n`) — required `y` for `approved`.

Cluster column **C<N>** flags candidate duplicate groups (auto-clustered by title-stem + area). Verify before merging — close titles can hide different selectors / states.

| # | area | id | title | sev | auth | load | run | cluster | decision | duplicates_of | verified | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | api | agents-connect-empty-bearer-token | WebSocket /agents/connect rejects empty bearer token | P0 | anonymous | y | PASS | C1 | | | |  |
| 2 | api | agents-connect-invalid-token | WebSocket /agents/connect rejects invalid bearer token | P0 | anonymous | y | PASS | C1 | | | |  |
| 3 | api | agents-connect-missing-auth-header | WebSocket /agents/connect rejects requests without Authorization header | P0 | anonymous | y | PASS | C1 | | | |  |
| 4 | api | agents-delete-confirm-calls-api | Confirming deletion calls the delete API endpoint | P1 | logged_in | y | PASS |  | | | |  |
| 5 | api | api-agent-invites-create-requires-auth | POST /agents/invites requires JWT authentication | P0 | anonymous | y | PASS |  | | | |  |
| 6 | api | api-agent-invites-create-returns-token-once | POST /agents/invites returns raw token with no-store cache headers | P1 | logged_in | y | PASS |  | | | |  |
| 7 | api | api-agent-invites-create-validates-body | POST /agents/invites validates request body with Zod schema | P1 | logged_in | y | PASS |  | | | |  |
| 8 | api | api-agent-invites-list-requires-auth | GET /agents/invites requires JWT authentication | P0 | anonymous | y | PASS |  | | | |  |
| 9 | api | api-agent-invites-list-returns-user-invites | GET /agents/invites returns invites for authenticated user | P1 | logged_in | y | PASS |  | | | |  |
| 10 | api | api-agent-invites-register-invalid-token | Agent registration fails with non-existent invite token | P1 | anonymous | n | skip |  | | | | schema: Required |
| 11 | api | api-agent-invites-register-used-token | Agent registration fails with already-used invite token | P1 | anonymous | n | skip |  | | | | schema: Required |
| 12 | api | api-agent-invites-register-valid-token | External agent registration succeeds with valid unused invite token | P1 | anonymous | y | PASS |  | | | |  |
| 13 | api | api-agent-invites-revoke-hash-not-found | Revoking non-existent invite hash returns 404 | P1 | logged_in | y | PASS |  | | | |  |
| 14 | api | api-agent-invites-revoke-hash-requires-auth | Revoking invite by hash requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 15 | api | api-agent-invites-revoke-hash-success-no-content | Successfully revoking invite returns 204 No Content | P1 | logged_in | y | PASS |  | | | |  |
| 16 | api | api-decision-trace-returns-404-for-missing-match | Decision trace endpoint returns 404 for non-existent match | P1 | anonymous | y | PASS | C2 | | | |  |
| 17 | api | api-decision-trace-strips-private-fields | Decision trace endpoint strips privateStateHash and reasoningSummary | P1 | anonymous | y | PASS |  | | | |  |
| 18 | api | api-docs-werewolf-guide-public-access | Werewolf agent guide is accessible without authentication | P1 | anonymous | y | PASS |  | | | |  |
| 19 | api | api-docs-werewolf-guide-serves-markdown | GET /docs/werewolf-agent-guide returns markdown documentation | P2 | anonymous | y | PASS |  | | | |  |
| 20 | api | api-health-get-returns-ok | GET /health returns ok status and uptime | P0 |  | y | PASS |  | | | |  |
| 21 | api | api-matches-decision-trace-excludes-private-fields | Decision trace endpoint excludes privateStateHash and reasoningSummary | P1 |  | y | PASS |  | | | |  |
| 22 | api | api-matches-decision-trace-returns-match-not-found | Decision trace endpoint returns error for invalid matchId | P2 |  | y | PASS | C2 | | | |  |
| 23 | api | api-matches-get-excludes-sensitive-fields | GET /matches/:matchId response excludes sensitive seed and private fields | P1 |  | y | PASS |  | | | |  |
| 24 | api | api-matches-get-not-found-invalid-id | GET /matches/:matchId returns error for non-existent match | P2 |  | y | PASS | C3 | | | |  |
| 25 | api | api-matches-get-returns-manifest-and-summary | GET /matches/:matchId returns match artifact with manifest and summary | P1 |  | y | PASS | C3 | | | |  |
| 26 | api | api-matches-list-excludes-seed | GET /matches excludes sensitive seed field from response | P1 |  | y | PASS |  | | | |  |
| 27 | api | api-matches-list-returns-data | GET /matches returns list of match artifacts | P1 |  | y | PASS |  | | | |  |
| 28 | api | api-me-agents-create-requires-auth | POST /me/agents requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 29 | api | api-me-agents-create-returns-201 | POST /me/agents returns 201 with created agent data | P1 | logged_in | y | PASS |  | | | |  |
| 30 | api | api-me-agents-get-not-found-error | GET /me/agents/:agentId returns error for non-existent agent | P1 | logged_in | y | PASS | C4 | | | |  |
| 31 | api | api-me-agents-get-requires-auth | GET /me/agents/:agentId requires JWT authentication | P0 | anonymous | y | PASS |  | | | |  |
| 32 | api | api-me-agents-get-returns-agent-data | GET /me/agents/:agentId returns agent config for owner | P1 | logged_in | y | PASS | C4 | | | |  |
| 33 | api | api-me-agents-list-no-auth-secret-leak | GET /me/agents does not expose authHeaderValue | P0 | logged_in | n | skip |  | | | | schema: Required |
| 34 | api | api-me-agents-list-no-cache | GET /me/agents responses include no-store cache headers | P1 | logged_in | n | skip |  | | | | schema: Required |
| 35 | api | api-me-agents-list-requires-auth | GET /me/agents requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 36 | api | api-me-agents-no-cache-headers | POST /me/agents responses include no-store cache headers | P2 | logged_in | y | PASS |  | | | |  |
| 37 | api | api-me-agents-update-not-found | PATCH /me/agents/:agentId returns error for non-existent agent | P1 | logged_in | n | skip | C5 | | | | schema: Required |
| 38 | api | api-me-agents-update-requires-auth | PATCH /me/agents/:agentId requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 39 | api | api-me-agents-update-returns-updated-agent | PATCH /me/agents/:agentId returns updated agent data on success | P1 | logged_in | n | skip | C5 | | | | schema: Required |
| 40 | api | api-me-werewolf-agents-create-requires-auth | POST /me/werewolf-agents requires authentication | P0 | anonymous | y | PASS | C6 | | | |  |
| 41 | api | api-me-werewolf-agents-create-requires-csrf | POST /me/werewolf-agents requires CSRF token | P0 | logged_in | y | PASS | C6 | | | |  |
| 42 | api | api-me-werewolf-agents-create-validates-body | POST /me/werewolf-agents validates request body schema | P1 | logged_in | y | PASS |  | | | |  |
| 43 | api | api-me-werewolf-agents-list-requires-auth | GET /me/werewolf-agents requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 44 | api | api-me-werewolf-agents-list-returns-user-agents | GET /me/werewolf-agents returns only current user's werewolf agents | P1 | logged_in | y | PASS |  | | | |  |
| 45 | api | api-tables-add-agent-requires-auth | Adding agent to table requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 46 | api | api-tables-add-agent-table-not-found | Adding agent to non-existent table returns error | P1 | logged_in | y | PASS |  | | | |  |
| 47 | api | api-tables-add-agent-validates-adapter-type | Adding agent rejects non-mock adapter types | P1 | logged_in | y | PASS |  | | | |  |
| 48 | api | api-tables-create-requires-auth | POST /tables requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 49 | api | api-tables-create-returns-201 | POST /tables returns 201 with table data on success | P1 | logged_in | n | skip |  | | | | schema: Required |
| 50 | api | api-tables-create-validates-schema | POST /tables rejects invalid request body | P1 | logged_in | n | skip |  | | | | schema: Required |
| 51 | api | api-tables-get-hand-requires-auth | GET /tables/:tableId/hands/:handId requires authentication | P0 | anonymous | y | PASS | C7 | | | |  |
| 52 | api | api-tables-get-hand-validates-hand-belongs-to-table | GET /tables/:tableId/hands/:handId returns error when hand does not belong to table | P1 | logged_in | y | PASS | C7 | | | |  |
| 53 | api | api-tables-get-hand-validates-table-exists | GET /tables/:tableId/hands/:handId returns error for non-existent table | P1 | logged_in | y | PASS | C7 | | | |  |
| 54 | api | api-tables-get-not-found | GET /tables/:tableId returns error for non-existent table | P1 | logged_in | n | skip | C8 | | | | schema: Required |
| 55 | api | api-tables-get-requires-auth | GET /tables/:tableId requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 56 | api | api-tables-get-returns-table-state | GET /tables/:tableId returns public table state for valid table | P1 | logged_in | n | skip | C8 | | | | schema: Required |
| 57 | api | api-tables-get-state-not-found | GET /tables/:tableId/state returns error for non-existent table | P1 | logged_in | y | PASS | C9 | | | |  |
| 58 | api | api-tables-get-state-requires-auth | GET /tables/:tableId/state requires authentication | P0 | anonymous | y | PASS | C9 | | | |  |
| 59 | api | api-tables-get-state-returns-table-state | GET /tables/:tableId/state returns current table state for authenticated user | P1 | logged_in | y | PASS | C9 | | | |  |
| 60 | api | api-tables-hand-replay-requires-auth | Hand replay endpoint requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 61 | api | api-tables-hand-replay-returns-data | Hand replay endpoint returns replay events for authenticated user | P1 | logged_in | y | PASS |  | | | |  |
| 62 | api | api-tables-leave-seat-not-found | DELETE /tables/:tableId/seats/me returns error for non-existent table | P2 | logged_in | n | skip | C10 | | | | schema: Required |
| 63 | api | api-tables-leave-seat-requires-auth | DELETE /tables/:tableId/seats/me requires authentication | P0 | anonymous | y | PASS | C10 | | | |  |
| 64 | api | api-tables-leave-seat-success | Authenticated user can leave their seat at a table | P1 | logged_in | n | skip |  | | | | schema: Required |
| 65 | api | api-tables-list-hands-requires-auth | GET /tables/:tableId/hands requires authentication | P0 | anonymous | y | PASS | C7 | | | |  |
| 66 | api | api-tables-list-hands-returns-data-array | GET /tables/:tableId/hands returns hands in data wrapper | P1 | logged_in | y | PASS | C7 | | | |  |
| 67 | api | api-tables-list-hands-table-not-found | GET /tables/:tableId/hands returns error for non-existent table | P1 | logged_in | y | PASS | C7 | | | |  |
| 68 | api | api-tables-list-requires-auth | GET /tables requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 69 | api | api-tables-list-returns-data | GET /tables returns table summaries for authenticated user | P1 | logged_in | y | PASS |  | | | |  |
| 70 | api | api-tables-remove-agent-not-found | DELETE /tables/:tableId/agents/:agentId returns error for non-existent agent | P2 | logged_in | n | skip | C11 | | | | schema: Required |
| 71 | api | api-tables-remove-agent-requires-auth | DELETE /tables/:tableId/agents/:agentId requires authentication | P0 | anonymous | n | skip | C11 | | | | schema: Required |
| 72 | api | api-tables-remove-agent-success | DELETE /tables/:tableId/agents/:agentId returns removed confirmation for owner | P1 | logged_in | y | PASS | C11 | | | |  |
| 73 | api | api-tables-sit-human-not-found | Seating at non-existent table returns error | P1 | logged_in | n | skip |  | | | | schema: Required |
| 74 | api | api-tables-sit-human-requires-auth | Seating a human player requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 75 | api | api-tables-sit-human-success | Authenticated user can sit at a table seat | P1 | logged_in | n | skip |  | | | | schema: Required |
| 76 | api | api-tables-start-hand-owner-only | Only table owner can start a new hand | P0 | logged_in | y | PASS |  | | | |  |
| 77 | api | api-tables-start-hand-table-not-found | Starting hand on non-existent table returns TABLE_NOT_FOUND error | P1 | logged_in | y | PASS |  | | | |  |
| 78 | api | api-tables-submit-action-requires-auth | Submit player action requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 79 | api | api-tables-submit-action-table-not-found | Submit action to non-existent table returns error | P1 | logged_in | y | PASS |  | | | |  |
| 80 | api | api-tables-submit-action-validates-body | Submit player action validates request body schema | P1 | logged_in | y | PASS |  | | | |  |
| 81 | api | api-tables-unwatch-removes-spectator | DELETE /tables/:tableId/watch removes user from spectator list | P1 | logged_in | y | PASS | C12 | | | |  |
| 82 | api | api-tables-unwatch-requires-auth | DELETE /tables/:tableId/watch requires authentication | P0 | anonymous | y | PASS | C12 | | | |  |
| 83 | api | api-tables-watch-not-found-invalid-table | POST /tables/:tableId/watch returns error for non-existent table | P1 | logged_in | y | PASS | C13 | | | |  |
| 84 | api | api-tables-watch-requires-auth | POST /tables/:tableId/watch requires authentication | P0 | anonymous | y | PASS | C13 | | | |  |
| 85 | api | api-tables-watch-success-no-content | POST /tables/:tableId/watch returns 204 on successful spectator registration | P1 | logged_in | y | PASS | C13 | | | |  |
| 86 | api | api-werewolf-games-create-requires-auth | Creating a werewolf game requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 87 | api | api-werewolf-games-create-success | Authenticated user can create a werewolf game lobby | P1 | logged_in | y | PASS |  | | | |  |
| 88 | api | api-werewolf-games-create-validates-name-length | Game creation rejects names exceeding 100 characters | P2 | logged_in | n | skip |  | | | | schema: Required |
| 89 | api | api-werewolf-games-list-returns-data | GET /werewolf-games returns list of games | P1 |  | y | PASS |  | | | |  |
| 90 | api | api-werewolf-invite-npc-host-only | Only game creator can invite NPC to werewolf seat | P0 | logged_in | y | PASS | C14 | | | |  |
| 91 | api | api-werewolf-invite-npc-requires-auth | Inviting NPC to werewolf seat requires authentication | P0 | anonymous | y | PASS | C15 | | | |  |
| 92 | api | api-werewolf-invite-npc-requires-csrf | Inviting NPC to werewolf seat requires CSRF token | P1 | logged_in | y | PASS | C15 | | | |  |
| 93 | api | api-werewolf-match-get-not-found | GET /werewolf-matches/:matchId returns error for non-existent match | P2 | anonymous | y | PASS | C16 | | | |  |
| 94 | api | api-werewolf-match-get-returns-public-manifest | GET /werewolf-matches/:matchId returns public manifest without private files | P1 | anonymous | y | PASS | C16 | | | |  |
| 95 | api | api-werewolf-match-get-strips-seed | GET /werewolf-matches/:matchId strips seed from index entries | P1 | anonymous | y | PASS | C16 | | | |  |
| 96 | api | api-werewolf-matches-list | GET /werewolf-matches returns array of match artifacts | P1 |  | y | PASS |  | | | |  |
| 97 | api | api-werewolf-matches-strips-seed | GET /werewolf-matches excludes seed from index entries | P1 |  | y | PASS |  | | | |  |
| 98 | api | api-werewolf-start-host-only | Only the game creator can start a werewolf game | P0 | logged_in | y | PASS | C14 | | | |  |
| 99 | api | api-werewolf-start-requires-auth | Starting a werewolf game requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 100 | api | api-werewolf-start-returns-202 | Starting a werewolf game returns 202 Accepted with game entry | P1 | logged_in | y | PASS |  | | | |  |
| 101 | api | delete-agent-in-use-blocked | DELETE /me/agents/:agentId blocked when agent is seated in live game | P1 | logged_in | y | PASS |  | | | |  |
| 102 | api | delete-agent-not-found | DELETE /me/agents/:agentId returns error for non-existent agent | P1 | logged_in | y | PASS |  | | | |  |
| 103 | api | delete-agent-requires-auth | DELETE /me/agents/:agentId requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 104 | api | delete-table-requires-auth | DELETE /tables/:tableId requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 105 | api | delete-table-returns-deleted-true | DELETE /tables/:tableId returns deleted confirmation for owner | P1 | logged_in | y | PASS |  | | | |  |
| 106 | api | fill-npcs-host-only | Fill with NPCs endpoint restricted to game host | P0 | logged_in | y | PASS |  | | | |  |
| 107 | api | fill-npcs-requires-auth | Fill with NPCs endpoint requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 108 | api | invite-agent-owner-check | Only the owner can invite their registered HTTP agent to a seat | P0 | logged_in | y | PASS |  | | | |  |
| 109 | api | invite-agent-requires-auth | Inviting an HTTP agent to a werewolf seat requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 110 | api | invite-http-agent-api-failure-shows-error | API failure when generating HTTP invite shows error toast | P2 | logged_in | y | PASS |  | | | |  |
| 111 | api | simulate-requires-authentication | POST /simulate requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 112 | api | simulate-requires-csrf-token | POST /simulate requires CSRF token | P0 | logged_in | y | PASS |  | | | |  |
| 113 | api | simulate-validates-request-schema | POST /simulate rejects invalid request body | P1 | logged_in | y | PASS |  | | | |  |
| 114 | api | sit-http-agent-invalid-config-returns-error | Seating with non-existent agent config returns AGENT_NOT_FOUND error | P1 | logged_in | y | PASS |  | | | |  |
| 115 | api | sit-http-agent-requires-auth | Seating HTTP agent requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 116 | api | sit-http-agent-returns-seat-on-success | Successfully seating HTTP agent returns 201 with seat data | P1 | logged_in | y | PASS |  | | | |  |
| 117 | api | werewolf-action-rejects-empty-bearer-token | POST /werewolf/action rejects empty Bearer token | P0 | anonymous | y | PASS |  | | | |  |
| 118 | api | werewolf-action-requires-bearer-token | POST /werewolf/action requires valid Bearer token | P0 | anonymous | y | PASS | C17 | | | |  |
| 119 | api | werewolf-action-validates-mailbox-request-id-uuid | POST /werewolf/action requires valid UUID for mailboxRequestId | P1 | anonymous | y | PASS | C17 | | | |  |
| 120 | api | werewolf-game-get-anonymous-access-allowed | GET /werewolf-games/:gameId is accessible without authentication | P2 | anonymous | y | PASS | C18 | | | |  |
| 121 | api | werewolf-game-get-not-found-for-invalid-id | GET /werewolf-games/:gameId throws not found for invalid game ID | P1 |  | y | PASS | C18 | | | |  |
| 122 | api | werewolf-game-get-returns-lobby-state | GET /werewolf-games/:gameId returns full lobby state for valid game | P1 |  | y | PASS | C18 | | | |  |
| 123 | api | werewolf-stream-accessible-anonymous | Werewolf SSE stream endpoint is accessible to anonymous spectators | P1 | anonymous | n | skip |  | | | | schema: Required |
| 124 | api | werewolf-stream-requires-game-id | Werewolf SSE stream returns 400 when gameId is missing or empty | P1 | anonymous | y | PASS |  | | | |  |
| 125 | api | werewolf-wait-rejects-empty-bearer-token | GET /werewolf/wait rejects empty bearer token | P0 |  | y | PASS | C19 | | | |  |
| 126 | api | werewolf-wait-requires-bearer-token | GET /werewolf/wait rejects requests without Bearer token | P0 |  | y | PASS | C19 | | | |  |
| 127 | api | ws-subscribe-lobby-anonymous | Anonymous clients can subscribe to lobby topic | P1 | anonymous | y | PASS |  | | | |  |
| 128 | api | ws-subscribe-player-topic-requires-auth | Player topic subscription requires matching authenticated user | P0 | logged_in | y | PASS |  | | | |  |
| 129 | auth | agents-edit-requires-auth-when-enabled | Agent edit route requires authentication when legacy modules enabled | P1 | anonymous | y | PASS |  | | | |  |
| 130 | auth | api-auth-logout-clears-session-cookie | POST /auth/logout clears the session cookie | P0 | logged_in | y | PASS |  | | | |  |
| 131 | auth | api-auth-register-creates-user | POST /auth/register creates new user and returns public user data | P0 | anonymous | y | PASS |  | | | |  |
| 132 | auth | api-auth-register-rate-limited | POST /auth/register enforces rate limiting | P1 | anonymous | n | skip |  | | | | schema: Required |
| 133 | auth | api-auth-register-validates-input | POST /auth/register rejects invalid registration data | P1 | anonymous | n | skip |  | | | | schema: Required |
| 134 | auth | api-tables-start-hand-requires-auth | Starting a hand requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 135 | auth | appshell-login-button-visible-when-anonymous | Login button is visible only when user is not authenticated | P1 | anonymous | y | PASS |  | | | |  |
| 136 | auth | appshell-login-navigates-to-login-page | Login button navigates to login page with return URL | P0 | anonymous | y | PASS |  | | | |  |
| 137 | auth | appshell-logout-button-visible-when-authenticated | Logout button replaces login button when authenticated | P1 | logged_in | y | PASS |  | | | |  |
| 138 | auth | lobby-logout-clears-session | Logout button clears user session and redirects to login | P0 | logged_in | y | FAIL |  | | | |  |
| 139 | auth | lobby-logout-clears-storage | Logout removes authentication tokens from browser storage | P0 | logged_in | y | FAIL |  | | | |  |
| 140 | auth | login-email-input-accepts-text | Login email input accepts user-entered text | P1 | anonymous | y | PASS |  | | | |  |
| 141 | auth | login-error-displays-on-invalid-credentials | Error message displays when login fails | P0 | anonymous | y | PASS |  | | | |  |
| 142 | auth | login-form-submit-error-displayed | Failed login displays error message | P0 | anonymous | y | PASS |  | | | |  |
| 143 | auth | login-form-submit-success | Successful login redirects to next page or home | P0 | anonymous | y | PASS |  | | | |  |
| 144 | auth | login-page-redirects-authenticated-users | Login page redirects already authenticated users to home | P1 | logged_in | y | PASS |  | | | |  |
| 145 | auth | login-page-renders-form | Login page displays email and password fields with sign-in button | P0 | anonymous | y | PASS |  | | | |  |
| 146 | auth | login-page-respects-next-param-redirect | Login page redirects authenticated users to next param destination | P2 | logged_in | y | PASS |  | | | |  |
| 147 | auth | login-page-shows-register-link | Login page provides link to registration | P1 | anonymous | y | PASS |  | | | |  |
| 148 | auth | login-password-masks-input | Password input field masks characters | P1 | anonymous | y | PASS |  | | | |  |
| 149 | auth | login-redirect-when-authenticated | Already authenticated user is redirected away from login page | P1 | logged_in | y | PASS |  | | | |  |
| 150 | auth | login-redirects-authenticated-user | Authenticated users visiting /login are redirected away | P1 | logged_in | y | PASS |  | | | |  |
| 151 | auth | login-register-link-navigation | Register link on login page navigates to registration | P1 | anonymous | y | PASS |  | | | |  |
| 152 | auth | login-submit-button-disabled-while-submitting | Submit button shows loading state during submission | P2 | anonymous | y | PASS |  | | | |  |
| 153 | auth | logout-button-hidden-when-anonymous | Logout button is hidden for anonymous users | P1 | anonymous | y | PASS |  | | | |  |
| 154 | auth | logout-button-visible-when-authenticated | Logout button is visible only when user is authenticated | P1 | logged_in | y | PASS |  | | | |  |
| 155 | auth | logout-clears-session-and-redirects | Clicking logout clears session and redirects to home | P0 | logged_in | y | FAIL |  | | | |  |
| 156 | auth | register-displayname-input-accepts-text | Display name input accepts user text entry | P1 | anonymous | y | PASS |  | | | |  |
| 157 | auth | register-error-displays-message | Registration error displays error message in DOM | P1 | anonymous | y | PASS |  | | | |  |
| 158 | auth | register-form-displays-error-on-failure | Registration form displays error message on signup failure | P2 | anonymous | y | PASS |  | | | |  |
| 159 | auth | register-login-link-navigation | Login link on register page navigates to login | P1 | anonymous | y | PASS |  | | | |  |
| 160 | auth | register-page-has-login-link | Register page provides link to login page | P2 | anonymous | y | PASS |  | | | |  |
| 161 | auth | register-page-redirects-logged-in-user | Register page redirects already authenticated users away | P1 | logged_in | y | PASS |  | | | |  |
| 162 | auth | register-page-renders-for-anonymous | Register page renders registration form for anonymous users | P1 | anonymous | y | PASS |  | | | |  |
| 163 | auth | register-password-input-masks-characters | Password input masks characters during registration | P1 | anonymous | y | PASS |  | | | |  |
| 164 | auth | register-redirects-authenticated-user | Authenticated users are redirected away from register page | P1 | logged_in | y | PASS |  | | | |  |
| 165 | auth | register-redirects-if-already-logged-in | Logged-in user visiting register page redirects away | P1 | logged_in | y | PASS |  | | | |  |
| 166 | auth | register-redirects-logged-in-user | Logged in users are redirected away from register page | P1 | logged_in | y | PASS |  | | | |  |
| 167 | auth | register-success-redirects-to-next | Successful registration redirects to next page or default | P0 | anonymous | y | PASS |  | | | |  |
| 168 | auth | simulate-route-requires-auth-when-enabled | Simulate page requires authentication when legacy modules enabled | P1 | anonymous | y | PASS |  | | | |  |
| 169 | auth | werewolf-agent-picker-login-link | Login link appears when agent picker requires authentication | P1 | anonymous | y | FAIL |  | | | |  |
| 170 | auth | werewolf-agent-picker-login-navigation | Clicking login link from agent picker navigates to login page | P1 | anonymous | y | FAIL |  | | | |  |
| 171 | auth | werewolf-agent-picker-register-link-navigation | Register link in empty agent picker navigates to agent registration | P2 | logged_in | y | FAIL |  | | | |  |
| 172 | auth | werewolf-agent-picker-requires-login | Agent picker shows login required state for unauthenticated users | P1 | anonymous | y | PASS |  | | | |  |
| 173 | auth | werewolf-room-no-auth-required | Werewolf room accessible without authentication | P1 | anonymous | y | PASS |  | | | |  |
| 174 | core | agent-buyin-accepts-valid-number | Agent buy-in input accepts valid numeric chip amounts | P2 | anonymous | y | FAIL |  | | | |  |
| 175 | core | agent-buyin-default-value | Agent buy-in input displays default value of 2000 chips | P3 | anonymous | y | PASS |  | | | |  |
| 176 | core | agent-edit-auth-header-name-input-accepts-value | Auth header name input accepts and displays user input | P2 | logged_in | y | FAIL |  | | | |  |
| 177 | core | agent-edit-auth-header-name-optional | Auth header name can be left empty for agents without auth | P2 | logged_in | y | FAIL |  | | | |  |
| 178 | core | agent-edit-cancel-does-not-submit-form | Cancel link does not trigger form submission or save changes | P1 | logged_in | y | FAIL |  | | | |  |
| 179 | core | agent-edit-cancel-link-navigates-to-agents-list | Cancel link on agent edit page navigates back to agents list | P2 | logged_in | y | FAIL |  | | | |  |
| 180 | core | agent-edit-clear-auth-checkbox-toggle | Clear auth header checkbox toggles when clicked | P2 | logged_in | y | FAIL | C20 | | | |  |
| 181 | core | agent-edit-clear-auth-visible-when-has-auth | Clear auth header checkbox only visible when agent has existing auth header | P2 | logged_in | y | PASS | C20 | | | |  |
| 182 | core | agent-edit-form-disables-during-submit | Agent form disables submit button while submitting | P2 | logged_in | y | FAIL |  | | | |  |
| 183 | core | agent-edit-form-shows-error | Agent form displays error message on submission failure | P2 | logged_in | y | FAIL |  | | | |  |
| 184 | core | agent-edit-form-submit-redirects | Agent form submission redirects to agents list | P1 | logged_in | y | FAIL |  | | | |  |
| 185 | core | agent-edit-timeout-has-default-value | Timeout input defaults to 5000ms for new agents | P2 | logged_in | y | PASS | C21 | | | |  |
| 186 | core | agent-edit-timeout-input-accepts-numeric-value | Timeout input accepts and stores numeric milliseconds value | P2 | logged_in | y | FAIL |  | | | |  |
| 187 | core | agent-endpoint-url-accepts-valid-url | Agent endpoint URL field accepts valid HTTP/HTTPS URLs | P1 | logged_in | y | FAIL | C22 | | | |  |
| 188 | core | agent-endpoint-url-persists-on-edit | Agent endpoint URL is pre-filled when editing existing agent | P2 | logged_in | y | PASS |  | | | |  |
| 189 | core | agent-endpoint-url-required | Agent endpoint URL field is required for form submission | P1 | logged_in | y | FAIL | C22 | | | |  |
| 190 | core | agent-name-input-accepts-text | Agent name input accepts and displays user text | P2 | logged_in | y | FAIL | C23 | | | |  |
| 191 | core | agent-name-persists-on-edit-load | Agent name field is populated when editing existing agent | P1 | logged_in | y | PASS |  | | | |  |
| 192 | core | agents-delete-cancel-closes-dialog | Cancel button closes agent deletion confirmation dialog | P2 | logged_in | y | FAIL | C24 | | | |  |
| 193 | core | agents-delete-cancel-preserves-agent | Cancelling agent deletion does not remove the agent from list | P1 | logged_in | y | FAIL |  | | | |  |
| 194 | core | agents-delete-confirm-closes-dialog | Confirm delete button closes the confirmation dialog | P2 | logged_in | y | FAIL |  | | | |  |
| 195 | core | agents-delete-confirm-removes-agent | Confirming agent deletion removes agent from list | P1 | logged_in | y | FAIL |  | | | |  |
| 196 | core | agents-edit-redirects-when-legacy-disabled | Agent edit route redirects to home when legacy modules disabled | P2 | logged_in | y | PASS |  | | | |  |
| 197 | core | agents-new-link-navigation | New agent link navigates to agent creation form | P1 | logged_in | y | FAIL |  | | | |  |
| 198 | core | agents-new-redirects-when-legacy-disabled | /agents/new redirects to home when legacy modules disabled | P2 |  | y | PASS |  | | | |  |
| 199 | core | agents-revoke-invite-removes-from-list | Revoking a pending agent invite removes it from the invites list | P1 | logged_in | y | FAIL |  | | | |  |
| 200 | core | agents-route-redirects-when-legacy-disabled | Agents route redirects to home when legacy modules disabled | P1 | logged_in | y | PASS |  | | | |  |
| 201 | core | all-in-button-disabled-while-submitting | All-in button is disabled while action is being submitted | P1 | logged_in | y | FAIL |  | | | |  |
| 202 | core | all-in-button-visible-when-pending-action | All-in button is visible when player has pending action | P1 | logged_in | y | PASS |  | | | |  |
| 203 | core | analysis-sort-select-all-options-available | Agent comparison sort dropdown displays all sort metric options | P2 |  | y | FAIL | C25 | | | |  |
| 204 | core | analysis-sort-select-changes-order | Agent comparison sort dropdown changes agent list order | P2 |  | y | FAIL | C25 | | | |  |
| 205 | core | appshell-brand-link-navigates-home | Brand logo link navigates to home page | P1 |  | y | PASS |  | | | |  |
| 206 | core | appshell-invite-button-aria-expanded | Invite button has correct aria-expanded state when popover open | P2 |  | y | PASS |  | | | |  |
| 207 | core | appshell-invite-button-close-toggle | Clicking invite button twice closes the popover | P3 |  | y | FAIL |  | | | |  |
| 208 | core | appshell-invite-button-toggle | Invite button toggles popover visibility | P2 |  | y | PASS |  | | | |  |
| 209 | core | audience-fire-reaction-increment | Fire reaction button increments count on click | P2 |  | y | FAIL |  | | | |  |
| 210 | core | audience-react-clap-increments-count | Clap reaction button increments count on click | P2 |  | y | FAIL |  | | | |  |
| 211 | core | audience-react-clap-multiple-clicks | Clap button count increments on successive clicks | P3 |  | y | FAIL |  | | | |  |
| 212 | core | audience-react-fear | Fear reaction button increments count | P3 |  | y | FAIL |  | | | |  |
| 213 | core | audience-react-heart-increments-count | Clicking heart reaction button increments its count | P2 |  | y | FAIL |  | | | |  |
| 214 | core | audience-react-heart-independent-counts | Heart reaction count is independent of other reaction counts | P3 |  | y | FAIL |  | | | |  |
| 215 | core | audience-reactions-start-at-zero | All reaction counts initialize to zero | P3 |  | y | PASS |  | | | |  |
| 216 | core | audience-strip-shows-watching-count | Audience strip displays watching count | P2 |  | y | PASS |  | | | |  |
| 217 | core | audience-wolf-reaction-increment | Wolf reaction button increments count on click | P2 |  | y | FAIL |  | | | |  |
| 218 | core | audience-wolf-reaction-initial-zero | Wolf reaction button shows initial count of zero | P3 |  | y | PASS |  | | | |  |
| 219 | core | big-blind-default-value | Big blind input has correct default value | P2 |  | y | PASS |  | | | |  |
| 220 | core | big-blind-input-accepts-valid-number | Big blind input accepts valid numeric value | P2 |  | y | FAIL |  | | | |  |
| 221 | core | check-action-button-disabled-while-submitting | Check button disabled during action submission | P1 | logged_in | y | FAIL |  | | | |  |
| 222 | core | check-action-button-visible-when-legal | Check button visible when check is a legal action | P1 | logged_in | y | PASS |  | | | |  |
| 223 | core | check-action-invokes-callback | Check button click triggers onSubmitAction callback | P0 | logged_in | y | FAIL |  | | | |  |
| 224 | core | confirm-dialog-cancel-closes-dialog | Cancel button closes confirmation dialog | P1 |  | y | FAIL |  | | | |  |
| 225 | core | confirm-dialog-cancel-focus-on-open | Cancel button receives focus when dialog opens | P2 |  | y | PASS |  | | | |  |
| 226 | core | confirm-dialog-confirm-click | Clicking confirm button triggers onConfirm callback | P1 | logged_in | y | FAIL |  | | | |  |
| 227 | core | confirm-dialog-escape-cancels | Pressing Escape key cancels the dialog | P2 |  | y | FAIL |  | | | |  |
| 228 | core | confirm-dialog-escape-closes-dialog | Pressing Escape key closes confirmation dialog | P2 |  | y | FAIL |  | | | |  |
| 229 | core | confirm-dialog-focus-management | Dialog focuses cancel button on open and restores focus on close | P2 |  | y | FAIL |  | | | |  |
| 230 | core | fold-button-submits-action | Fold button submits fold action to end player turn | P0 | logged_in | y | FAIL |  | | | |  |
| 231 | core | hero-card-empty-state-no-link | Empty hero card state shows no game link when no featured game exists | P2 | anonymous | y | PASS |  | | | |  |
| 232 | core | hero-card-navigates-to-game | Clicking featured game hero card navigates to game page | P1 | anonymous | y | FAIL |  | | | |  |
| 233 | core | home-route-catch-all-redirect | Unknown routes redirect to home | P2 |  | y | PASS |  | | | |  |
| 234 | core | home-route-resolves-to-werewolf | Home route resolves to werewolf lobby or active room | P1 |  | y | PASS |  | | | |  |
| 235 | core | home-route-shows-loading-state | Home route displays loading indicator while resolving | P2 |  | y | PASS |  | | | |  |
| 236 | core | invite-http-agent-copies-to-clipboard | Clicking "Invite HTTP agent" generates invite and copies to clipboard | P1 | logged_in | y | FAIL |  | | | |  |
| 237 | core | invite-http-clipboard-fallback-shows-text | Clipboard write failure shows fallback text for manual copy | P2 | logged_in | y | FAIL |  | | | |  |
| 238 | core | invite-popover-coding-api-error-toast | Coding agent invite shows error toast on API failure | P2 | logged_in | y | FAIL |  | | | |  |
| 239 | core | invite-popover-coding-generates-invite | Coding agent invite button calls API and shows success or fallback | P1 | logged_in | y | FAIL |  | | | |  |
| 240 | core | lobby-ante-input-accepts-zero | Ante input accepts zero value | P2 | logged_in | y | FAIL |  | | | |  |
| 241 | core | lobby-ante-input-integer-required | Ante input requires integer value | P2 | logged_in | y | FAIL |  | | | |  |
| 242 | core | lobby-ante-input-non-negative | Ante input rejects negative values | P1 | logged_in | y | FAIL |  | | | |  |
| 243 | core | lobby-big-blind-must-exceed-small-blind | Big blind must be greater than or equal to small blind | P1 | logged_in | y | FAIL |  | | | |  |
| 244 | core | lobby-big-blind-requires-integer | Big blind must be a valid integer | P1 | logged_in | y | FAIL |  | | | |  |
| 245 | core | lobby-big-blind-valid-submission | Valid big blind value allows table creation | P1 | logged_in | y | FAIL |  | | | |  |
| 246 | core | lobby-big-blind-validation-minimum | Big blind must be at least equal to small blind | P1 | logged_in | y | FAIL |  | | | |  |
| 247 | core | lobby-create-table-big-blind-gte-small-blind | Create table form validates big blind >= small blind | P1 | logged_in | y | FAIL | C26 | | | |  |
| 248 | core | lobby-create-table-max-seats-validation | Create table form validates max seats between 2 and 9 | P1 | logged_in | y | FAIL | C26 | | | |  |
| 249 | core | lobby-create-table-name-required | Create table form requires non-empty name | P1 | logged_in | y | FAIL |  | | | |  |
| 250 | core | lobby-join-table-link-navigation | Join table link navigates to table page | P1 | logged_in | y | PASS |  | | | |  |
| 251 | core | lobby-max-seats-validation-integer | Max seats input requires integer values | P2 | logged_in | y | FAIL |  | | | |  |
| 252 | core | lobby-max-seats-validation-minimum | Max seats input rejects values below minimum of 2 | P1 | logged_in | y | FAIL | C27 | | | |  |
| 253 | core | lobby-max-seats-validation-range | Max seats input rejects values outside 2-9 range | P1 | logged_in | y | FAIL | C27 | | | |  |
| 254 | core | lobby-redirects-to-home-when-legacy-disabled | Lobby route redirects to home when legacy modules disabled | P1 |  | y | PASS |  | | | |  |
| 255 | core | lobby-seed-input-accepts-optional-value | Seed input accepts optional string for reproducibility | P2 | logged_in | y | PASS |  | | | |  |
| 256 | core | lobby-small-blind-validation-integer | Small blind input rejects non-integer values | P1 | logged_in | y | FAIL | C28 | | | |  |
| 257 | core | lobby-small-blind-validation-minimum | Small blind input rejects values less than 1 | P1 | logged_in | y | FAIL | C28 | | | |  |
| 258 | core | lobby-table-name-accepts-valid-input | Valid table name allows form submission | P1 | logged_in | y | FAIL |  | | | |  |
| 259 | core | lobby-table-name-required | Table name is required when creating a new poker table | P1 | logged_in | y | FAIL |  | | | |  |
| 260 | core | lobby-timeout-integer-validation | Default timeout must be an integer | P1 | logged_in | y | FAIL |  | | | |  |
| 261 | core | lobby-timeout-positive-validation | Default timeout must be greater than 0 | P1 | logged_in | y | FAIL |  | | | |  |
| 262 | core | match-analysis-tab-switch | Clicking analysis tab switches to analysis dashboard view | P2 |  | y | FAIL |  | | | |  |
| 263 | core | match-replay-back-link-navigates-to-matches | Back to matches link navigates to matches list | P2 | logged_in | y | FAIL |  | | | |  |
| 264 | core | match-replay-redirects-when-legacy-disabled | Match replay route redirects to home when legacy modules disabled | P2 |  | y | PASS |  | | | |  |
| 265 | core | matches-open-replay-link-navigates | Clicking replay link navigates to match viewer | P1 | logged_in | n | skip |  | | | | schema: Expected string, received object |
| 266 | core | matches-route-redirects-to-home | /matches redirects to home when legacy modules disabled | P2 |  | y | PASS |  | | | |  |
| 267 | core | max-spectators-input-accepts-valid-zero | Max spectators accepts zero value | P2 | logged_in | y | FAIL |  | | | |  |
| 268 | core | max-spectators-input-rejects-negative | Max spectators rejects negative values | P2 | logged_in | y | FAIL |  | | | |  |
| 269 | core | max-spectators-input-validation-bounds | Max spectators rejects values outside 0-1000 range | P2 | logged_in | y | FAIL |  | | | |  |
| 270 | core | raise-action-submit | Raise button submits raise action with specified amount | P1 | logged_in | y | FAIL |  | | | |  |
| 271 | core | raise-action-validation-error | Raise action shows validation error for invalid amount | P2 | logged_in | y | FAIL |  | | | |  |
| 272 | core | raise-slider-clamps-to-valid-range | Raise slider value is clamped to valid min/max range | P1 | logged_in | y | FAIL |  | | | |  |
| 273 | core | raise-slider-preset-amounts-clickable | Preset bet amount buttons update slider value | P2 | logged_in | y | PASS |  | | | |  |
| 274 | core | raise-slider-shows-validation-error | Invalid raise amount displays error message | P1 | logged_in | y | FAIL |  | | | |  |
| 275 | core | replay-action-select-updates-selection | Clicking action in timeline updates selected action | P2 | logged_in | y | FAIL |  | | | |  |
| 276 | core | replay-hand-select-button-updates-view | Selecting a hand updates replay workbench to show that hand | P1 | logged_in | y | FAIL |  | | | |  |
| 277 | core | replay-next-button-advances-timeline | Next button advances to next action in replay timeline | P1 | logged_in | y | FAIL |  | | | |  |
| 278 | core | replay-play-pause-toggles-playback | Play/pause button toggles automatic replay playback state | P2 | logged_in | y | FAIL |  | | | |  |
| 279 | core | replay-previous-button-disabled-at-start | Previous button disabled when at first action | P2 | logged_in | y | FAIL |  | | | |  |
| 280 | core | replay-previous-button-navigates-backward | Previous button selects prior timeline action | P1 | logged_in | y | FAIL |  | | | |  |
| 281 | core | replay-previous-button-stops-playback | Previous button stops auto-play when clicked | P2 | logged_in | y | FAIL |  | | | |  |
| 282 | core | replay-slider-navigation | Action slider navigates to specific action position | P2 | logged_in | y | FAIL |  | | | |  |
| 283 | core | replay-street-filter-button-filters-timeline | Street filter button filters replay timeline to selected street | P2 | logged_in | y | FAIL |  | | | |  |
| 284 | core | replay-street-filter-resets-on-hand-change | Street filter resets to 'all' when selecting a different hand | P2 | logged_in | y | FAIL |  | | | |  |
| 285 | core | route-table-redirect-when-disabled | Poker table route redirects to home when legacy modules disabled | P1 |  | y | PASS |  | | | |  |
| 286 | core | simulate-add-agent-button-adds-agent | Add agent button appends new agent to configuration | P2 |  | y | PASS |  | | | |  |
| 287 | core | simulate-agent-name-input-accepts-text | Agent name input accepts and displays user-entered name | P2 |  | y | FAIL | C23 | | | |  |
| 288 | core | simulate-agent-name-persists-in-form | Agent name persists after entering other form fields | P2 |  | y | FAIL |  | | | |  |
| 289 | core | simulate-agent-strategy-default-selection | Agent strategy dropdown defaults to random for first agent | P2 | logged_in | y | PASS |  | | | |  |
| 290 | core | simulate-agent-strategy-select-options | Agent strategy dropdown displays all available strategies | P2 | logged_in | y | FAIL |  | | | |  |
| 291 | core | simulate-ante-default-zero | Ante input defaults to zero | P3 | logged_in | y | PASS |  | | | |  |
| 292 | core | simulate-ante-input-accepts-valid-number | Ante input accepts valid non-negative number | P2 | logged_in | y | FAIL |  | | | |  |
| 293 | core | simulate-form-api-error-display | Simulation form displays API errors to user | P1 |  | y | FAIL |  | | | |  |
| 294 | core | simulate-form-submit-success | Successful simulation form submission returns match ID | P1 | logged_in | y | FAIL |  | | | |  |
| 295 | core | simulate-form-validation-error | Simulation form shows validation error for invalid input | P2 |  | y | FAIL |  | | | |  |
| 296 | core | simulate-max-seats-default-value | Max seats input has default value of 6 | P2 |  | y | PASS |  | | | |  |
| 297 | core | simulate-max-seats-input-accepts-valid-number | Max seats input accepts valid numeric value | P2 |  | y | FAIL |  | | | |  |
| 298 | core | simulate-name-has-default-value | Simulation name input has default value | P3 | anonymous | y | PASS |  | | | |  |
| 299 | core | simulate-name-input-accepts-text | Simulation name input accepts user text | P2 | anonymous | y | FAIL |  | | | |  |
| 300 | core | simulate-num-hands-default-value | Number of hands input defaults to 5 | P3 |  | y | PASS |  | | | |  |
| 301 | core | simulate-num-hands-max-validation | Number of hands input enforces maximum of 20 hands | P2 |  | y | FAIL |  | | | |  |
| 302 | core | simulate-num-hands-positive-integer | Number of hands input accepts positive integers only | P2 |  | y | FAIL |  | | | |  |
| 303 | core | simulate-remove-agent-decrements-list | Remove agent button decreases agent count in simulation config | P2 |  | y | PASS |  | | | |  |
| 304 | core | simulate-remove-agent-preserves-minimum | Cannot remove agent when only minimum agents remain | P1 |  | y | PASS |  | | | |  |
| 305 | core | simulate-route-redirects-when-legacy-disabled | Simulate page redirects to home when legacy modules disabled | P2 | logged_in | y | PASS |  | | | |  |
| 306 | core | simulate-seed-input-accepts-empty | Seed input accepts empty value for random simulation | P2 |  | y | FAIL |  | | | |  |
| 307 | core | simulate-seed-input-accepts-numeric | Seed input accepts numeric string for reproducible simulation | P2 |  | y | FAIL |  | | | |  |
| 308 | core | simulate-small-blind-default-value | Small blind input has default value of 25 | P2 |  | y | PASS |  | | | |  |
| 309 | core | simulate-small-blind-input-accepts-valid-number | Small blind input accepts valid positive number | P2 |  | y | FAIL |  | | | |  |
| 310 | core | simulate-success-matches-link | Match replays link navigates to matches list after simulation success | P2 | logged_in | y | FAIL |  | | | |  |
| 311 | core | simulate-timeout-has-default-value | Timeout input defaults to 5000ms | P2 | logged_in | y | PASS | C21 | | | |  |
| 312 | core | simulate-timeout-input-accepts-valid-ms | Timeout input accepts valid millisecond values | P2 | logged_in | y | FAIL |  | | | |  |
| 313 | core | table-action-bet-invalid-amount | Bet action shows error for invalid amount | P2 | logged_in | y | FAIL |  | | | |  |
| 314 | core | table-action-bet-preset-amounts | Preset bet amounts update input field | P2 | logged_in | y | FAIL |  | | | |  |
| 315 | core | table-action-bet-submit | Bet action button submits bet with valid amount | P1 | logged_in | y | FAIL |  | | | |  |
| 316 | core | table-buyin-input-default-value | Buy-in input defaults to 1000 chips | P2 | logged_in | y | FAIL |  | | | |  |
| 317 | core | table-buyin-input-disables-sit-button | Sit button disabled when buy-in is invalid | P1 | logged_in | y | FAIL |  | | | |  |
| 318 | core | table-buyin-input-validation | Buy-in input rejects non-positive integers | P1 | logged_in | y | FAIL |  | | | |  |
| 319 | core | table-leave-seat-button-removes-player | Leave seat button removes player from table | P1 | logged_in | y | FAIL |  | | | |  |
| 320 | core | table-preset-amount-clears-error | Clicking preset amount button clears any validation error | P2 | logged_in | y | FAIL | C29 | | | |  |
| 321 | core | table-preset-amount-sets-bet-value | Clicking preset amount button updates bet input field | P1 | logged_in | y | FAIL | C29 | | | |  |
| 322 | core | table-raise-amount-clears-error-on-input | Raise amount input clears error when user types | P2 | logged_in | y | FAIL |  | | | |  |
| 323 | core | table-raise-amount-input-validation | Raise amount input validates within legal bounds | P1 | logged_in | y | FAIL |  | | | |  |
| 324 | core | table-raise-preset-amount-selection | Preset raise amount buttons update input value | P2 | logged_in | y | FAIL |  | | | |  |
| 325 | core | table-sit-agent-select-buttons-disabled-invalid | Sit buttons are disabled when buy-in is invalid | P1 | logged_in | y | FAIL |  | | | |  |
| 326 | core | table-sit-agent-select-default-buyin | Buy-in field defaults to 1000 chips | P3 | logged_in | y | FAIL |  | | | |  |
| 327 | core | table-sit-agent-select-validation | Buy-in validation shows error for invalid input | P2 | logged_in | y | FAIL |  | | | |  |
| 328 | core | table-sit-human-button-disabled-invalid-buyin | Sit here button disabled when buy-in is invalid | P1 | logged_in | y | FAIL |  | | | |  |
| 329 | core | table-sit-human-button-hidden-when-disabled | Sit here button not rendered when canSitHuman is false | P1 | logged_in | y | PASS |  | | | |  |
| 330 | core | table-sit-human-button-triggers-callback | Clicking Sit here invokes onSitHuman with seat index and buy-in | P0 | logged_in | y | FAIL |  | | | |  |
| 331 | core | table-start-hand-button-initiates-hand | Start hand button initiates new poker hand when clicked | P0 | logged_in | y | FAIL |  | | | |  |
| 332 | core | timeline-tab-audience-aria-selected | Audience tab shows aria-selected true when active | P2 |  | y | FAIL |  | | | |  |
| 333 | core | timeline-tab-audience-switch | Clicking Audience tab activates audience view | P2 |  | y | FAIL |  | | | |  |
| 334 | core | timeline-tab-events-selected | Events tab button becomes selected when clicked | P2 |  | y | FAIL |  | | | |  |
| 335 | core | timeline-tab-events-switches-from-audience | Clicking Events tab switches from Audience tab view | P2 | anonymous | y | FAIL |  | | | |  |
| 336 | core | werewolf-agent-picker-cancel-closes-popover | Cancel button closes agent picker popover | P2 | logged_in | y | FAIL | C24 | | | |  |
| 337 | core | werewolf-agent-picker-invite-npc | Invite NPC button triggers onInviteNpc callback | P1 | logged_in | n | skip |  | | | | schema: Required |
| 338 | core | werewolf-agent-picker-retry-refetches | Retry button re-fetches agent list after fetch error | P2 | logged_in | y | FAIL |  | | | |  |
| 339 | core | werewolf-agent-picker-select-agent | Selecting an agent from picker invites agent to seat | P1 | logged_in | y | FAIL |  | | | |  |
| 340 | core | werewolf-create-game-empty-name | Creating a werewolf game without name still navigates to game page | P2 | logged_in | y | FAIL |  | | | |  |
| 341 | core | werewolf-create-game-navigates-to-lobby | Creating a werewolf game navigates to the new game lobby | P1 | logged_in | y | FAIL |  | | | |  |
| 342 | core | werewolf-create-game-shows-error-on-failure | Failed game creation displays error message | P2 | logged_in | y | FAIL |  | | | |  |
| 343 | core | werewolf-create-game-with-name | Creating a werewolf game with optional name navigates to game page | P1 | logged_in | y | FAIL |  | | | |  |
| 344 | core | werewolf-create-with-seed-navigates | Creating game with seed navigates to game page | P1 | logged_in | y | FAIL |  | | | |  |
| 345 | core | werewolf-game-row-navigates-to-game | Clicking a game row navigates to the specific werewolf game room | P1 | logged_in | y | FAIL |  | | | |  |
| 346 | core | werewolf-lobby-recent-tab-filters-completed-games | Recent tab filters lobby to show recently completed games | P2 | logged_in | y | FAIL |  | | | |  |
| 347 | core | werewolf-lobby-search-empty-shows-all | Empty search query shows all games | P2 | logged_in | y | FAIL |  | | | |  |
| 348 | core | werewolf-lobby-search-filters-games | Search input filters displayed games by name or ID | P2 | logged_in | y | FAIL |  | | | |  |
| 349 | core | werewolf-lobby-tab-featured-active-state | Featured tab shows active/selected state when clicked | P2 |  | y | FAIL |  | | | |  |
| 350 | core | werewolf-lobby-tab-featured-filters-games | Featured tab filters lobby to show featured games subset | P1 |  | y | FAIL |  | | | |  |
| 351 | core | werewolf-lobby-tab-live-filters-games | ALL LIVE tab filters lobby to show live games | P2 | logged_in | y | FAIL |  | | | |  |
| 352 | core | werewolf-lobby-tab-live-selected | Clicking ALL LIVE tab sets it as active | P2 |  | y | FAIL |  | | | |  |
| 353 | core | werewolf-room-route-accessible | Werewolf game room route renders for valid gameId | P1 |  | y | PASS |  | | | |  |
| 354 | core | werewolf-room-wrapped-in-app-shell | Werewolf room page renders within AppShell layout | P2 |  | y | PASS |  | | | |  |
| 355 | core | werewolf-seed-input-accepts-value | Seed input field accepts and retains user input | P2 | logged_in | y | PASS |  | | | |  |
| 356 | core | werewolf-seed-optional-create-without | Game can be created without specifying a seed | P2 | logged_in | y | FAIL |  | | | |  |
| 357 | poker | match-replay-tab-switch-to-replay | Clicking replay tab activates replay view | P2 | logged_in | y | FAIL |  | | | |  |
| 358 | poker | table-delete-confirm-only-visible-for-managers | Delete table confirmation only shown for table managers | P2 | logged_in | y | PASS |  | | | |  |
| 359 | poker | table-delete-confirm-redirects-to-lobby | Confirming table delete redirects to lobby | P1 | logged_in | y | FAIL |  | | | |  |
| 360 | poker | table-delete-request-button-opens-dialog | Clicking delete table button opens confirmation dialog | P1 | logged_in | y | FAIL |  | | | |  |
| 361 | poker | table-delete-shows-error-on-failure | Delete table failure shows error message | P2 | logged_in | y | FAIL |  | | | |  |
| 362 | poker | table-watch-button-registers-spectator | Watch table button registers user as spectator | P1 | logged_in | y | FAIL |  | | | |  |
| 363 | smoke | SMOKE-api-anon-unauthorized | Anonymous API request returns 401 or redirect | P1 | anonymous | y | PASS |  | | | |  |
| 364 | smoke | SMOKE-nonexistent-route-404 | Nonexistent route returns 4xx | P1 | anonymous | y | PASS |  | | | |  |
| 365 | smoke | SMOKE-password-not-in-url | Password fields do not appear in URL | P0 | anonymous | y | PASS |  | | | |  |
| 366 | smoke | SMOKE-root-not-500 | Root route does not return 5xx | P0 | anonymous | y | PASS |  | | | |  |
| 367 | werewolf | route-werewolf-lobby-create-panel | Werewolf lobby shows create game form | P2 |  | y | PASS |  | | | |  |
| 368 | werewolf | route-werewolf-lobby-renders | Werewolf lobby page loads and displays directory chrome | P1 |  | y | PASS |  | | | |  |
| 369 | werewolf | route-werewolf-lobby-tabs-visible | Werewolf lobby displays all four filter tabs | P2 |  | y | PASS |  | | | |  |

## After review

```bash
# Materialize ground-truth (per qa/eval/schema.md):
# for each non-blank row, write qa/eval/poker/ground-truth/<id>.yml
# with original YAML body + eval-only fields (provenance, review, category)

# Then score:
node scripts/eval/score.mjs --project poker \
  --autopilot-dir /Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts \
  --out qa/eval/poker/score-2026-05-25.json
```
