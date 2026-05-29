# Step 2 review log — poker (5-4-claude fixture) — 2026-05-25

Reviewer: <fill in>
Source: `/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts/`
Autopilot baseline: `AUTOPILOT_REPORT.json` phase=B status=done generated=333 (+4 smoke from phase A)
Run log: `/tmp/run-2026-05-25-v2.log` (139 loaded, 198 schema-skipped, 38 passed, 101 failed)

> **Process** — for each row, open the contract YAML + the product, fill `decision` (`approved`/`dropped`/`merged`) and `duplicates_of`. Materialize approved/dropped/merged into `qa/eval/poker/ground-truth/<id>.yml` per `qa/eval/schema.md`. Don't silently delete dropped/merged — they're evidence for fp_rate and dedup_inflation.

## Headline numbers

| Bucket | Count | % of 337 |
|---|---|---|
| Loaded (schema valid) | 139 | 41.2% |
| Schema-skipped | 198 | 58.8% |
| Run: PASS | 38 | 11.3% |
| Run: FAIL | 101 | 30.0% |

## Schema-skip reasons (top 6)

| Count | First-issue (truncated to 80 chars) |
|---|---|
| 118 | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 58 | schema: Expected object, received string |
| 3 | schema: invalid regex: (?i)ante (Invalid regular expression: /(?i)ante/: Invalid group) |
| 3 | schema: invalid regex: (?i)name (Invalid regular expression: /(?i)name/: Invalid group) |
| 2 | schema: invalid regex: (?i)clear.*auth (Invalid regular expression: /(?i)clear.*auth/: I |
| 2 | schema: Unrecognized key(s) in object: 'pathParams' |

These rows are unrunnable as-is. **decision** for them defaults to `dropped` unless reviewer judges the *intent* is correct and the autopilot just emitted a malformed shape; in that case `approved` is fine but include a note ("schema bug, intent valid").

## Run failures by area (101)

| Area | Failed |
|---|---|
| core | 83 |
| agents | 14 |
| simulate | 2 |
| auth | 1 |
| tables | 1 |

100% of failures are `locator.click`/`locator.fill` timeout (30s) on selectors that don't exist on the anonymous landing page. **Likely root cause**: deep discovery emits contracts assuming logged-in state, but contract DSL has no auth bootstrap primitive — these tests are run as anonymous and time out waiting for elements that only exist behind login. This is a **runner/agent gap**, not necessarily a hallucination. Reviewer should mark these `approved` (when intent is real and would pass with auth setup) or `dropped` (when the feature genuinely doesn't exist).

## Run passes by area (38)

| Area | Passed |
|---|---|
| api | 15 |
| auth | 10 |
| core | 7 |
| smoke | 4 |
| agents | 2 |

PASSes are the most reliable signal — runner exercised the contract and the SUT matched expectations. Suggested review order: PASS rows first (fastest `verified_in_product` confirmation), then FAIL+intent-valid, then schema-skipped.

## Decision table (337 rows)

Fill `decision` ∈ {`approved`, `dropped`, `merged`}, `duplicates_of` if merged, `verified_in_product` (`y`/`n`) — required `y` for `approved`.

Cluster column **C<N>** flags candidate duplicate groups (auto-clustered by title-stem + area). Verify before merging — close titles can hide different selectors / states.

| # | area | id | title | sev | auth | load | run | cluster | decision | duplicates_of | verified | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | agents | agent-edit-cancel-navigates-to-agents | Cancel link on agent edit page navigates to agents list | P2 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 2 | agents | agent-edit-form-error-display | API error is displayed on form submission failure | P1 | logged_in | y | FAIL |  | | | |  |
| 3 | agents | agent-edit-form-submit-disabled-while-submitting | Submit button is disabled during form submission | P2 | logged_in | y | FAIL |  | | | |  |
| 4 | agents | agent-edit-form-success-redirect | Successful agent save redirects to agents list | P1 | logged_in | n | skip | C1 | | | | schema: Expected object, received string |
| 5 | agents | agent-save-button-disabled-while-submitting | Save button is disabled during submission | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 6 | agents | agent-save-redirects-to-list | Successful agent save redirects to agents list | P1 | logged_in | n | skip | C1 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 7 | agents | agent-save-shows-error-on-failure | Failed agent save displays error message | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 8 | agents | agent-timeout-default-value | Agent timeout input defaults to 5000ms for new agents | P2 | logged_in | y | PASS |  | | | |  |
| 9 | agents | agent-timeout-preserves-existing-value | Agent timeout input preserves existing value when editing | P1 | logged_in | y | PASS |  | | | |  |
| 10 | agents | agents-confirm-delete-removes-agent | Confirming agent deletion removes the agent from the list | P1 | logged_in | y | FAIL |  | | | |  |
| 11 | agents | agents-confirm-delete-shows-loading-state | Confirm delete button shows loading state during deletion | P2 | logged_in | y | FAIL |  | | | |  |
| 12 | agents | agents-invite-external-button-disabled-while-busy | Invite External Agent button is disabled while invite creation is in progress | P2 | logged_in | y | FAIL | C2 | | | |  |
| 13 | agents | agents-invite-external-creates-invite | Invite External Agent button creates a pending invite with registration URL | P1 | logged_in | y | FAIL | C2 | | | |  |
| 14 | agents | cancel-delete-closes-dialog | Cancel button closes delete confirmation dialog | P1 | logged_in | y | FAIL |  | | | |  |
| 15 | agents | checkbox-agent-clear-auth-submit-clears | Submitting with Clear Auth Header checked removes auth header from agent config | P0 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)clear.*auth (Invalid regular expression: /(?i)clear.*auth/: I |
| 16 | agents | checkbox-agent-clear-auth-toggle | Clear Auth Header checkbox toggles clearAuthHeader state | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)clear.*auth (Invalid regular expression: /(?i)clear.*auth/: I |
| 17 | agents | delete-agent-confirmation-dialog | Delete agent button opens confirmation dialog | P1 | logged_in | y | FAIL |  | | | |  |
| 18 | agents | delete-agent-in-use-error | Deleting agent seated at table shows error | P1 | logged_in | y | FAIL |  | | | |  |
| 19 | agents | delete-agent-removes-from-list | Confirming delete removes agent from list | P1 | logged_in | y | FAIL |  | | | |  |
| 20 | agents | link-agents-edit-navigates-to-edit-page | Edit Agent link navigates to agent edit page | P1 | logged_in | y | FAIL |  | | | |  |
| 21 | agents | link-agents-new-navigates-to-create | New Agent link navigates to agent creation page | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 22 | agents | revoke-invite-api-call | Revoking invite sends DELETE request with tokenHash | P1 | logged_in | y | FAIL |  | | | |  |
| 23 | agents | revoke-invite-removes-from-list | Revoking a pending invite removes it from the invites list | P1 | logged_in | y | FAIL |  | | | |  |
| 24 | agents | revoke-invite-requires-confirmation | Revoke invite action requires user confirmation via dialog | P1 | logged_in | y | FAIL |  | | | |  |
| 25 | api | api-decision-trace-excludes-private-fields | Decision trace endpoint strips sensitive fields | P0 | anonymous | n | skip | C3 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 26 | api | api-decision-trace-match-not-found | Decision trace returns MATCH_NOT_FOUND for invalid match | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 27 | api | api-matches-analysis-not-found | GET /api/v1/matches/:matchId/analysis returns 404 for invalid match | P1 | anonymous | y | PASS | C4 | | | |  |
| 28 | api | api-matches-analysis-returns-analysis | GET /api/v1/matches/:matchId/analysis returns match analysis data | P1 | anonymous | y | PASS | C4 | | | |  |
| 29 | api | api-matches-analysis-sanitizes-private-data | GET /api/v1/matches/:matchId/analysis excludes private fields from response | P0 | anonymous | y | PASS | C4 | | | |  |
| 30 | api | api-matches-get-not-found | GET /api/v1/matches/:matchId returns MATCH_NOT_FOUND for invalid matchId | P1 | anonymous | n | skip | C4 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 31 | api | api-matches-get-returns-match | GET /api/v1/matches/:matchId returns match details without sensitive fields | P1 | anonymous | n | skip | C4 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 32 | api | api-matches-list-returns-data | GET /api/v1/matches returns match list without sensitive seed data | P1 | anonymous | y | PASS |  | | | |  |
| 33 | api | api-matches-replay-not-found | Match replay returns MATCH_NOT_FOUND for invalid match ID | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 34 | api | api-matches-replay-returns-public-events | Match replay endpoint returns sanitized public replay events | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 35 | api | api-me-agents-delete-not-found | DELETE /api/v1/me/agents/:agentId returns 404 for non-existent agent | P1 | logged_in | n | skip | C5 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 36 | api | api-me-agents-delete-removes-agent | DELETE /api/v1/me/agents/:agentId removes agent from user's inventory | P0 | logged_in | n | skip | C5 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 37 | api | api-me-agents-list-no-cache | List My Agents response is not cached | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 38 | api | api-me-agents-list-requires-auth | List My Agents requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 39 | api | api-me-agents-list-returns-user-agents | List My Agents returns only current user's agents | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 40 | api | api-simulate-requires-auth | Simulate endpoint requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 41 | api | api-simulate-requires-csrf | Simulate endpoint requires CSRF token | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 42 | api | api-simulate-validates-request-body | Simulate endpoint validates request body schema | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 43 | api | api-tables-create-requires-auth | Create Table requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 44 | api | api-tables-create-success | Authenticated user can create a table | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 45 | api | api-tables-create-validation-error | Create Table rejects invalid request body | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 46 | api | api-tables-get-not-found | GET /api/v1/tables/:tableId returns 404 for non-existent table | P1 | logged_in | n | skip | C6 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 47 | api | api-tables-get-returns-table | GET /api/v1/tables/:tableId returns table details | P1 | logged_in | n | skip | C6 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 48 | api | api-tables-leave-not-found | Leave Seat returns 404 for non-existent table | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 49 | api | api-tables-leave-requires-auth | Leave Seat requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 50 | api | api-tables-leave-success | Leave Seat successfully removes user from table | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 51 | api | api-tables-state-excludes-seed | Get Table State excludes seed from public response | P1 | logged_in | y | PASS |  | | | |  |
| 52 | api | api-tables-state-not-found | Get Table State returns 404 for non-existent table | P1 | logged_in | y | PASS |  | | | |  |
| 53 | api | api-tables-state-requires-auth | Get Table State requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 54 | api | api-werewolf-games-create-requires-auth | Creating a werewolf game requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 55 | api | api-werewolf-games-create-returns-201 | Successfully creating a werewolf game returns 201 status | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 56 | api | api-werewolf-games-create-validates-name-length | Game name is limited to 100 characters | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 57 | api | api-werewolf-games-list | List werewolf games returns 200 with data array | P1 | anonymous | y | PASS |  | | | |  |
| 58 | api | api-werewolf-match-get-not-found | GET /api/v1/werewolf-matches/:matchId returns 404 for invalid matchId | P1 | anonymous | n | skip | C7 | | | | schema: Unrecognized key(s) in object: 'pathParams' |
| 59 | api | api-werewolf-match-get-returns-public-manifest | GET /api/v1/werewolf-matches/:matchId returns public manifest without internal files | P1 | anonymous | n | skip | C7 | | | | schema: Unrecognized key(s) in object: 'pathParams' |
| 60 | api | api-werewolf-matches-replay-excludes-decision-traces | Replay endpoint does not include decision traces in response | P2 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 61 | api | api-werewolf-matches-replay-not-found | Replay endpoint returns 404 for non-existent match | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 62 | api | api-werewolf-matches-replay-returns-events | Replay endpoint returns replay events for valid match | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 63 | api | register-invite-expired-unavailable | Expired invite returns unavailable error | P1 | anonymous | y | PASS |  | | | |  |
| 64 | api | register-invite-invalid-token-404 | Invalid invite token returns 404 | P1 | anonymous | y | PASS |  | | | |  |
| 65 | api | register-invite-success-201 | Valid invite registration returns 201 with agent | P0 | anonymous | y | PASS |  | | | |  |
| 66 | api | seat-agent-requires-auth | Seating agent at table requires authentication | P0 | anonymous | n | skip | C8 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 67 | api | seat-agent-requires-csrf | Seating agent at table requires CSRF token | P0 | logged_in | n | skip | C8 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 68 | api | seat-agent-validates-request-body | Seating agent validates request body against schema | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 69 | api | sit-at-table-invalid-table-returns-404 | Sitting at non-existent table returns 404 | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 70 | api | sit-at-table-requires-auth | Sitting at table requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 71 | api | sit-at-table-validates-request-body | Sitting at table validates request body schema | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 72 | api | start-hand-requires-auth | Starting a hand requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 73 | api | start-hand-requires-table-ownership | Only table owner can start a hand | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 74 | api | start-hand-table-not-found | Starting a hand on non-existent table returns 404 | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 75 | api | unwatch-nonexistent-table-returns-404 | Unwatch non-existent table returns 404 | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 76 | api | unwatch-table-requires-auth | Unwatch table endpoint requires authentication | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 77 | api | unwatch-table-returns-success | Unwatch table returns success for valid request | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 78 | api | werewolf-decision-trace-not-found | Decision trace returns 404 for non-existent match | P1 | anonymous | y | PASS |  | | | |  |
| 79 | api | werewolf-decision-trace-strips-private-fields | Decision trace endpoint strips privateStateHash and reasoningSummary | P1 | anonymous | y | PASS | C3 | | | |  |
| 80 | api | werewolf-docs-404-when-missing | Werewolf agent guide returns 404 when doc file is missing | P2 | anonymous | y | PASS | C9 | | | |  |
| 81 | api | werewolf-docs-returns-markdown | Werewolf agent guide returns markdown content | P1 | anonymous | y | PASS | C9 | | | |  |
| 82 | api | werewolf-stream-anonymous-access | Werewolf SSE stream allows anonymous spectator access | P2 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 83 | api | werewolf-stream-requires-game-id | Werewolf SSE stream requires valid gameId parameter | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 84 | api | werewolf-stream-sse-content-type | Werewolf SSE stream returns text/event-stream content type | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 85 | auth | agent-ws-connect-rejects-empty-token | Agent WebSocket connect rejects empty Bearer token | P0 | anonymous | n | skip | C10 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 86 | auth | agent-ws-connect-rejects-invalid-token | Agent WebSocket connect rejects invalid or revoked token | P0 | anonymous | n | skip | C10 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 87 | auth | agent-ws-connect-requires-bearer-token | Agent WebSocket connect requires valid Bearer token | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 88 | auth | agents-edit-requires-auth | Edit agent page requires authentication | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 89 | auth | agents-new-requires-auth-when-legacy-enabled | /agents/new requires authentication when legacy modules enabled | P0 | anonymous | y | PASS |  | | | |  |
| 90 | auth | api-auth-logout-clears-session | POST /api/v1/auth/logout clears session cookie and destroys server session | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 91 | auth | api-auth-register-creates-user-session | User registration creates authenticated session with cookie | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 92 | auth | api-auth-register-rate-limited | User registration enforces rate limiting | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 93 | auth | api-auth-register-requires-csrf | User registration requires valid CSRF token | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 94 | auth | api-me-agents-create-requires-auth | Create Agent endpoint requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 95 | auth | api-me-agents-delete-requires-auth | DELETE /api/v1/me/agents/:agentId requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 96 | auth | api-me-agents-get-excludes-auth-secret | Get Agent response does not expose authHeaderValue secret | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 97 | auth | api-me-agents-get-requires-auth | Get Agent endpoint requires JWT authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 98 | auth | api-me-agents-update-requires-auth | Update Agent requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 99 | auth | api-me-werewolf-agents-create-auth-required | Create Werewolf Agent requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 100 | auth | api-me-werewolf-agents-list-auth-required | List Werewolf Agents requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 101 | auth | api-me-werewolf-agents-list-returns-owned-agents | List Werewolf Agents returns only agents owned by authenticated user | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 102 | auth | api-werewolf-wait-rejects-empty-bearer-token | Werewolf wait endpoint rejects empty bearer token | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 103 | auth | api-werewolf-wait-requires-bearer-token | Werewolf wait endpoint requires valid bearer token | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 104 | auth | create-agent-invite-requires-auth | Creating agent invite requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 105 | auth | fill-npcs-host-only | Only game creator can fill lobby with NPCs | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 106 | auth | fill-npcs-requires-auth | Fill with NPCs requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 107 | auth | invite-agent-requires-auth | Invite agent endpoint requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 108 | auth | invite-agent-validates-ownership | Invite agent rejects cross-account agent configs as 404 | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 109 | auth | invite-coding-agent-requires-auth | Invite Coding Agent redirects anonymous users to login | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 110 | auth | invite-http-agent-requires-auth | Invite HTTP Agent redirects to login when anonymous | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 111 | auth | invite-npc-host-only | Only lobby creator can invite NPC | P0 | logged_in | y | PASS | C11 | | | |  |
| 112 | auth | invite-npc-requires-auth | Invite NPC endpoint requires authentication | P0 | anonymous | y | PASS |  | | | |  |
| 113 | auth | invite-popover-unauthenticated-shows-login | Unauthenticated user sees login prompt in agent picker | P1 | anonymous | y | FAIL |  | | | |  |
| 114 | auth | link-register-to-login | Login link navigates to login page | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 115 | auth | lobby-logout-clears-session | Lobby logout clears user session and redirects to login | P0 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 116 | auth | lobby-requires-authentication-when-enabled | Lobby page requires authentication when legacy modules enabled | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 117 | auth | login-button-navigates-to-login | Login button navigates to login page with return URL | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 118 | auth | login-failure-shows-error | Failed login displays error message and remains on login page | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 119 | auth | login-page-accessible-anonymous | Login page is accessible to anonymous users | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 120 | auth | login-page-renders-login-component | Login page renders the LoginPage component | P1 | anonymous | y | PASS |  | | | |  |
| 121 | auth | login-redirect-preserves-next-param | Login redirects to URL specified in next query parameter | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 122 | auth | login-redirects-authenticated-user | Already logged-in user redirects away from login page | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 123 | auth | login-register-link-navigation | Register link on login page navigates to registration | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 124 | auth | login-success-redirect | Successful login redirects to next parameter or home | P0 | anonymous | n | skip | C12 | | | | schema: Expected object, received string |
| 125 | auth | login-success-redirects-to-next | Successful login redirects to next param or home | P0 | anonymous | n | skip | C12 | | | | schema: Expected object, received string |
| 126 | auth | logout-button-only-visible-when-authenticated | Logout button only visible when authenticated | P1 | anonymous | y | PASS |  | | | |  |
| 127 | auth | logout-clears-session-redirects-home | Logout clears session and redirects to home | P0 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 128 | auth | register-already-logged-in-redirect | Logged-in user visiting register page is redirected | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 129 | auth | register-email-required | Email field is required for registration | P1 | anonymous | y | PASS |  | | | |  |
| 130 | auth | register-error-displays-message | Registration error displays error message and stays on page | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 131 | auth | register-form-shows-error-on-failure | Registration form displays error message on signup failure | P1 | anonymous | y | PASS |  | | | |  |
| 132 | auth | register-page-accessible-anonymous | Register page accessible to anonymous users | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 133 | auth | register-page-has-login-link | Register page has link to login | P2 | anonymous | y | PASS |  | | | |  |
| 134 | auth | register-page-redirects-logged-in | Register page redirects logged-in users | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 135 | auth | register-password-input-masked | Password input masks characters | P1 | anonymous | y | PASS |  | | | |  |
| 136 | auth | register-redirects-authenticated-user | Authenticated users are redirected away from register page | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 137 | auth | register-redirects-if-logged-in | Register page redirects authenticated users away | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 138 | auth | register-shows-error-on-signup-failure | Registration displays error message on signup failure | P1 | anonymous | y | PASS |  | | | |  |
| 139 | auth | register-submit-error-stays-on-page | Registration failure displays error and stays on page | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 140 | auth | register-submit-success-redirect | Successful registration redirects to next URL or default | P0 | anonymous | n | skip | C13 | | | | schema: Expected object, received string |
| 141 | auth | register-success-redirects-to-next | Successful registration redirects to next param or default | P0 | anonymous | n | skip | C13 | | | | schema: Expected object, received string |
| 142 | auth | route-agents-list-requires-auth-when-enabled | Agents list page requires authentication when legacy modules enabled | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 143 | auth | route-table-requires-auth-when-enabled | Table page requires authentication when legacy modules enabled | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 144 | auth | simulate-page-requires-auth | Simulate page requires authentication | P0 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 145 | auth | start-werewolf-game-creator-only | Only lobby creator can start game | P0 | logged_in | n | skip | C11 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 146 | auth | start-werewolf-game-requires-auth | Start werewolf game requires authentication | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 147 | auth | werewolf-action-rejects-empty-bearer-token | Werewolf action endpoint rejects empty bearer token | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 148 | auth | werewolf-action-requires-bearer-token | Werewolf action endpoint requires valid agent bearer token | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 149 | auth | werewolf-start-match-host-only | Only the lobby creator can start the match | P0 | logged_in | n | skip | C11 | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 150 | auth | ws-private-player-topic-requires-auth | Private player topics require authenticated user with matching userId | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 151 | core | agent-buyin-positive-integer-validation | Agent buy-in must be a positive integer | P1 | anonymous | y | FAIL |  | | | |  |
| 152 | core | agent-picker-cancel-closes-popover | Cancel button closes agent picker popover | P2 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)cancel (Invalid regular expression: /(?i)cancel/: Invalid gro |
| 153 | core | agent-picker-retry-refetches-agents | Retry button refetches agent list after fetch error | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)retry (Invalid regular expression: /(?i)retry/: Invalid group |
| 154 | core | agent-strategy-dropdown-shows-all-options | Agent strategy dropdown displays all four strategy options | P2 | anonymous | y | FAIL |  | | | |  |
| 155 | core | agents-new-redirect-when-legacy-disabled | /agents/new redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 156 | core | all-in-button-disabled-while-submitting | All-In Button Disabled During Submission | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 157 | core | all-in-button-shows-amount-when-available | All-In Button Displays Amount When maxAmount Defined | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 158 | core | all-in-button-submits-action | All-In Button Submits All-In Action | P1 | logged_in | y | FAIL |  | | | |  |
| 159 | core | ante-input-accepts-zero | Ante input accepts zero value | P2 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)ante (Invalid regular expression: /(?i)ante/: Invalid group) |
| 160 | core | ante-input-non-negative-validation | Ante input rejects negative values | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)ante (Invalid regular expression: /(?i)ante/: Invalid group) |
| 161 | core | ante-input-requires-integer | Ante input requires integer value | P2 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)ante (Invalid regular expression: /(?i)ante/: Invalid group) |
| 162 | core | api-health-includes-uptime | Health endpoint includes uptime in milliseconds | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 163 | core | api-health-includes-version | Health endpoint includes version string | P2 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 164 | core | api-health-returns-ok | Health endpoint returns ok status | P0 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 165 | core | api-me-agents-create-no-cache | Create Agent response includes no-cache headers | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 166 | core | api-me-agents-create-returns-public-agent | Create Agent returns agent without sensitive auth values | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 167 | core | api-me-agents-get-no-cache-headers | Get Agent response includes no-cache headers | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 168 | core | api-me-agents-update-not-found | Update Agent returns 404 for non-existent agent | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 169 | core | api-me-agents-update-returns-nocache-headers | Update Agent response includes no-cache headers | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 170 | core | api-me-werewolf-agents-create-success | Create Werewolf Agent returns agent details on success | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 171 | core | api-me-werewolf-agents-create-validates-name | Create Werewolf Agent validates name format | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 172 | core | api-me-werewolf-agents-list-excludes-sensitive-fields | List Werewolf Agents excludes sensitive token and auth fields | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 173 | core | api-werewolf-wait-long-poll-timeout | Werewolf wait returns 204 after long poll timeout | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 174 | core | audience-reaction-5-increments-count | Clicking audience reaction 5 (👏) increments its count | P2 | anonymous | y | FAIL |  | | | |  |
| 175 | core | audience-reaction-5-multiple-clicks-accumulate | Multiple clicks on reaction 5 accumulate the count | P2 | anonymous | y | FAIL |  | | | |  |
| 176 | core | audience-reaction-increment | Clicking reaction button increments its count | P2 | anonymous | y | FAIL |  | | | |  |
| 177 | core | audience-reaction-independent-counts | Reaction buttons maintain independent counts | P2 | anonymous | y | FAIL |  | | | |  |
| 178 | core | audience-reaction-multiple-increments | Multiple clicks on same reaction button accumulate count | P2 | anonymous | y | FAIL |  | | | |  |
| 179 | core | bet-amount-validation-empty | Bet amount input requires a value | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 180 | core | bet-amount-validation-maximum | Bet amount input rejects values above maximum | P1 | logged_in | y | FAIL | C14 | | | |  |
| 181 | core | bet-amount-validation-minimum | Bet amount input rejects values below minimum | P1 | logged_in | y | FAIL | C14 | | | |  |
| 182 | core | bet-slider-disabled-while-submitting | Bet slider is disabled during action submission | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 183 | core | bet-slider-respects-min-max | Bet slider constrains value to min/max bounds | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 184 | core | bet-slider-syncs-with-input | Slider value synchronizes with number input field | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 185 | core | bet-submit-clears-error-on-input | Typing in bet amount field clears previous validation error | P2 | logged_in | y | FAIL |  | | | |  |
| 186 | core | bet-submit-valid-amount-triggers-action | Valid bet amount submission triggers onSubmitAction callback | P0 | logged_in | y | FAIL |  | | | |  |
| 187 | core | bet-submit-validation-error | Bet submission shows validation error for invalid amount | P1 | logged_in | y | FAIL |  | | | |  |
| 188 | core | big-blind-must-be-gte-small-blind | Big blind must be greater than or equal to small blind | P1 | logged_in | y | FAIL | C15 | | | |  |
| 189 | core | btn-werewolf-room-back | Back to Lobby navigates user to lobby | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 190 | core | buy-in-disables-sit-button-on-invalid | Sit button disabled when buy-in is invalid | P1 | logged_in | y | FAIL |  | | | |  |
| 191 | core | buy-in-validation-non-numeric | Buy-in input rejects non-numeric values | P1 | logged_in | y | FAIL |  | | | |  |
| 192 | core | buy-in-validation-positive-integer | Buy-in input must be a positive integer | P1 | logged_in | y | FAIL |  | | | |  |
| 193 | core | catch-all-redirects-to-home | Unknown routes redirect to home page | P2 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 194 | core | check-button-disabled-while-submitting | Check button disabled during submission | P1 | logged_in | y | FAIL |  | | | |  |
| 195 | core | check-button-only-when-legal | Check button only visible when check is legal action | P0 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 196 | core | check-button-submits-action | Check button submits check action | P1 | logged_in | y | FAIL |  | | | |  |
| 197 | core | close-clipboard-toast-dismisses-notification | Closing clipboard toast dismisses the notification | P2 | logged_in | y | FAIL |  | | | |  |
| 198 | core | confirm-dialog-cancel-closes-dialog | Cancel button closes confirmation dialog | P1 | logged_in | y | FAIL |  | | | |  |
| 199 | core | confirm-dialog-closes-on-confirm | Confirm dialog closes and triggers callback when confirm button clicked | P1 | logged_in | y | FAIL |  | | | |  |
| 200 | core | confirm-dialog-escape-cancels | Pressing Escape key cancels confirmation dialog | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 201 | core | confirm-dialog-focus-management | Confirm dialog traps focus and restores focus on close | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 202 | core | confirm-dialog-focus-restored-on-cancel | Focus returns to trigger element after cancel | P2 | logged_in | y | FAIL |  | | | |  |
| 203 | core | create-agent-invite-returns-token | Creating agent invite returns one-time token and register URL | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 204 | core | create-agent-invite-validates-ttl | Creating agent invite validates TTL within bounds | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 205 | core | create-table-api-error-displayed | API Errors During Table Creation Are Displayed to User | P1 | logged_in | y | FAIL |  | | | |  |
| 206 | core | create-table-success-navigates | Successful Table Creation Navigates to Table Page | P0 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 207 | core | create-table-validates-blind-relationship | Create table requires big blind >= small blind | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)name (Invalid regular expression: /(?i)name/: Invalid group) |
| 208 | core | create-table-validates-max-seats-range | Create table validates max seats between 2 and 9 | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)name (Invalid regular expression: /(?i)name/: Invalid group) |
| 209 | core | create-table-validates-name-required | Create table requires non-empty name | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)name (Invalid regular expression: /(?i)name/: Invalid group) |
| 210 | core | create-table-validation-errors | Create Table Form Shows Validation Errors for Invalid Input | P1 | logged_in | y | FAIL |  | | | |  |
| 211 | core | empty-seat-invite-popover-opens | Clicking empty seat opens agent picker popover | P1 | logged_in | y | FAIL |  | | | |  |
| 212 | core | fill-npcs-transitions-to-ready | Fill with NPCs sets game status to ready | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 213 | core | fold-button-disabled-while-submitting | Fold button is disabled during action submission | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 214 | core | fold-button-only-when-legal | Fold button only appears when fold is a legal action | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 215 | core | fold-button-triggers-action | Fold button triggers fold action submission | P0 | logged_in | y | FAIL |  | | | |  |
| 216 | core | game-row-displays-status | Game row displays correct status label | P2 | logged_in | y | PASS |  | | | |  |
| 217 | core | hero-card-navigates-to-game | Clicking featured game hero card navigates to game page | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 218 | core | home-redirects-to-werewolf-resolver | Home page renders WerewolfHomeResolver within AppShell | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 219 | core | input-lobby-table-name-required | Table name is required for table creation | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)table.*name|name (Invalid regular expression: /(?i)table.*nam |
| 220 | core | invite-agent-rejects-occupied-seat | Invite agent rejects already occupied seat | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 221 | core | invite-coding-agent-api-error-toast | API failure on invite shows error toast | P2 | logged_in | y | FAIL |  | | | |  |
| 222 | core | invite-coding-agent-success-toast | Successful coding agent invite shows clipboard toast | P1 | logged_in | y | FAIL |  | | | |  |
| 223 | core | invite-http-agent-copies-to-clipboard | Invite HTTP Agent copies invite text to clipboard when authenticated | P1 | logged_in | y | FAIL |  | | | |  |
| 224 | core | invite-http-agent-shows-fallback-on-clipboard-failure | Invite HTTP Agent shows fallback text when clipboard write fails | P2 | logged_in | y | FAIL |  | | | |  |
| 225 | core | invite-npc-seat-occupied | Cannot invite NPC to occupied seat | P1 | logged_in | y | PASS |  | | | |  |
| 226 | core | invite-npc-triggers-callback | Invite NPC button triggers onInviteNpc callback | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)invite.*npc|npc (Invalid regular expression: /(?i)invite.*npc |
| 227 | core | invite-popover-close-on-second-click | Clicking invite button again closes the popover | P2 | anonymous | y | FAIL |  | | | |  |
| 228 | core | invite-popover-escape-closes | Pressing ESC closes agent picker popover | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 229 | core | invite-popover-toggle-aria-expanded-state | Invite button aria-expanded reflects popover visibility state | P2 | anonymous | y | FAIL |  | | | |  |
| 230 | core | invite-popover-toggle-opens-popover | Clicking invite button toggles invite popover visibility | P1 | anonymous | y | FAIL |  | | | |  |
| 231 | core | join-table-navigates-to-table-page | Clicking Join/Watch link navigates to table page | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 232 | core | kbd-confirm-dialog-escape | Pressing Escape key closes confirm dialog | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 233 | core | kbd-confirm-dialog-escape-focus-restore | Focus returns to previous element after Escape closes dialog | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 234 | core | kbd-workbench-arrow-left-navigates-backward | Arrow Left key navigates to previous action in replay timeline | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 235 | core | kbd-workbench-arrow-right-advances-action | Arrow Right key advances to next action in replay timeline | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 236 | core | kbd-workbench-arrow-right-respects-street-filter | Arrow Right navigation respects active street filter | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 237 | core | link-appshell-home | Brand link navigates to home page | P1 | anonymous | n | skip | C16 | | | | schema: Expected object, received string |
| 238 | core | link-appshell-home-logged-in | Brand link navigates to home page when logged in | P1 | logged_in | n | skip | C16 | | | | schema: Expected object, received string |
| 239 | core | link-game-row-navigates-to-game | Clicking game row navigates to game detail page | P1 | logged_in | y | PASS |  | | | |  |
| 240 | core | link-lobby-watch-table | Watch Table link navigates to table spectator view | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 241 | core | link-match-replay-back | Back to Matches link navigates to matches list | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 242 | core | link-simulate-to-matches | Match Replays link navigates to matches page | P2 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 243 | core | lobby-big-blind-integer-required | Big blind must be an integer value | P1 | logged_in | y | FAIL |  | | | |  |
| 244 | core | lobby-big-blind-min-small-blind | Big blind must be greater than or equal to small blind | P1 | logged_in | y | FAIL | C15 | | | |  |
| 245 | core | lobby-default-timeout-integer-validation | Default timeout must be an integer value | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)default.*timeout (Invalid regular expression: /(?i)default.*t |
| 246 | core | lobby-default-timeout-positive-integer | Default timeout must be a positive integer | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)default.*timeout (Invalid regular expression: /(?i)default.*t |
| 247 | core | lobby-max-seats-validation-integer | Max seats input requires integer value | P2 | logged_in | y | FAIL |  | | | |  |
| 248 | core | lobby-max-seats-validation-minimum | Max seats input rejects values below 2 | P1 | logged_in | y | FAIL |  | | | |  |
| 249 | core | lobby-max-seats-validation-range | Max seats input validates range 2-9 | P1 | logged_in | y | FAIL | C17 | | | |  |
| 250 | core | lobby-redirect-when-legacy-disabled | Lobby route redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 251 | core | match-replay-analysis-tab-switch | Clicking Analysis tab switches to analysis view | P1 | logged_in | y | FAIL |  | | | |  |
| 252 | core | match-replay-redirect-when-legacy-disabled | Match replay route redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 253 | core | match-replay-renders-when-legacy-enabled | Match replay page renders for valid match ID when legacy modules enabled | P1 | anonymous | y | PASS |  | | | |  |
| 254 | core | match-replay-tab-switch-to-replay | Switching to replay tab shows replay content | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)replay (Invalid regular expression: /(?i)replay/: Invalid gro |
| 255 | core | matches-list-accessible-when-legacy-enabled | Matches page renders without auth when legacy modules enabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 256 | core | matches-list-redirects-when-legacy-disabled | Matches page redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 257 | core | max-seats-default-value | Max seats input defaults to 6 | P2 | anonymous | y | PASS |  | | | |  |
| 258 | core | max-seats-limits-agent-count | Agent count cannot exceed max seats value | P1 | anonymous | y | FAIL |  | | | |  |
| 259 | core | max-seats-validation-range | Max seats input validates range 2-9 | P1 | anonymous | y | FAIL | C17 | | | |  |
| 260 | core | max-spectators-negative-rejected | Max spectators rejects negative values | P1 | logged_in | y | FAIL |  | | | |  |
| 261 | core | max-spectators-validation-range | Max spectators input validates range 0-1000 | P1 | logged_in | y | FAIL |  | | | |  |
| 262 | core | position-slider-bounded-by-timeline | Position slider range bounded by filtered timeline length | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 263 | core | position-slider-updates-selected-action | Position slider updates selected action in timeline | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 264 | core | preset-amount-clears-error | Clicking preset amount clears validation error | P2 | logged_in | y | FAIL |  | | | |  |
| 265 | core | preset-amount-updates-input | Preset amount button updates bet/raise input field | P1 | logged_in | y | FAIL |  | | | |  |
| 266 | core | preset-amounts-within-bounds | Preset amounts are always within min/max bounds | P0 | logged_in | y | FAIL |  | | | |  |
| 267 | core | raise-submit-calls-action-handler | Valid raise submit invokes onSubmitAction with amount | P0 | logged_in | y | FAIL |  | | | |  |
| 268 | core | raise-submit-disabled-when-submitting | Raise button disabled during submission | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 269 | core | raise-submit-validation-error | Raise submit shows validation error for invalid amount | P1 | logged_in | y | FAIL |  | | | |  |
| 270 | core | replay-step-backward-disabled-at-first-action | Step backward button disabled at first action | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 271 | core | replay-step-backward-selects-previous-action | Step backward selects previous action in timeline | P1 | logged_in | y | FAIL |  | | | |  |
| 272 | core | route-agents-list-redirect-when-legacy-disabled | Agents list page redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 273 | core | route-table-redirect-when-legacy-disabled | Table route redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 274 | core | route-table-renders-for-authenticated-user | Table page renders for authenticated user when legacy modules enabled | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 275 | core | select-action-row-aria-pressed-state | Selected action row has aria-pressed true | P2 | logged_in | y | FAIL |  | | | |  |
| 276 | core | select-action-row-updates-selection | Selecting action row updates selected action and inspector | P1 | logged_in | y | FAIL |  | | | |  |
| 277 | core | select-agent-strategy-updates-form-state | Agent strategy dropdown updates agent form state | P2 | anonymous | y | FAIL |  | | | |  |
| 278 | core | select-hand-resets-playback-state | Selecting a different hand stops playback and resets street filter | P2 | logged_in | y | FAIL |  | | | |  |
| 279 | core | select-hand-updates-selection | Selecting a hand updates the selected hand state | P1 | logged_in | y | FAIL |  | | | |  |
| 280 | core | simulate-add-agent-appends-to-list | Add Agent button appends new agent to agents list | P1 | anonymous | y | FAIL |  | | | |  |
| 281 | core | simulate-add-agent-disabled-at-max-seats | Add Agent button is disabled when agent count equals max seats | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 282 | core | simulate-num-hands-max-limit | Number of hands input respects maximum limit | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)hands (Invalid regular expression: /(?i)hands/: Invalid group |
| 283 | core | simulate-num-hands-positive-integer | Number of hands requires positive integer | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)hands (Invalid regular expression: /(?i)hands/: Invalid group |
| 284 | core | simulate-page-redirects-when-legacy-disabled | Simulate page redirects to home when legacy modules disabled | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 285 | core | simulate-run-button-disabled-while-submitting | Run simulation button disabled during submission | P2 | anonymous | y | FAIL |  | | | |  |
| 286 | core | simulate-run-success-shows-replay-link | Successful simulation shows replay link with match ID | P1 | anonymous | y | FAIL |  | | | |  |
| 287 | core | simulate-run-validation-error | Run simulation shows validation error for invalid input | P1 | anonymous | y | FAIL |  | | | |  |
| 288 | core | sit-here-calls-on-sit-human | Clicking 'Sit here' invokes onSitHuman with seat index and buy-in | P1 | logged_in | y | FAIL |  | | | |  |
| 289 | core | sized-action-submit-valid-amount | Valid sized action amount triggers onSubmitAction callback | P0 | logged_in | y | FAIL |  | | | |  |
| 290 | core | sized-action-validation-error-above-maximum | Sized action rejects amounts above maximum | P1 | logged_in | y | FAIL | C18 | | | |  |
| 291 | core | sized-action-validation-error-below-minimum | Sized action rejects amounts below minimum | P1 | logged_in | y | FAIL | C18 | | | |  |
| 292 | core | small-blind-default-value | Small blind input has default value of 25 | P2 | logged_in | y | PASS |  | | | |  |
| 293 | core | small-blind-input-accepts-numeric-value | Small blind input accepts and stores numeric value | P1 | logged_in | y | FAIL |  | | | |  |
| 294 | core | small-blind-integer-validation | Small blind must be an integer | P1 | logged_in | y | FAIL |  | | | |  |
| 295 | core | small-blind-minimum-validation | Small blind must be at least 1 | P1 | logged_in | y | FAIL |  | | | |  |
| 296 | core | start-werewolf-game-requires-ready-status | Start game requires all seats filled (ready status) | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 297 | core | step-forward-advances-action | Step Forward Button Advances to Next Action | P1 | logged_in | y | FAIL |  | | | |  |
| 298 | core | step-forward-respects-street-filter | Step Forward Navigates Within Filtered Timeline | P2 | logged_in | y | FAIL |  | | | |  |
| 299 | core | street-filter-filters-timeline | Street filter restricts action timeline to selected street | P1 | logged_in | y | FAIL |  | | | |  |
| 300 | core | street-filter-resets-on-hand-change | Street filter resets to 'all' when selecting a new hand | P2 | logged_in | y | FAIL |  | | | |  |
| 301 | core | werewolf-action-validates-request-schema | Werewolf action endpoint validates request body schema | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 302 | core | werewolf-create-game-error-display | Failed game creation displays error message | P1 | logged_in | y | FAIL | C19 | | | |  |
| 303 | core | werewolf-create-game-navigates-to-game | Creating a Werewolf game navigates to the new game page | P0 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 304 | core | werewolf-create-game-prevents-double-submit | Create button is disabled while submission is in progress | P2 | logged_in | y | FAIL |  | | | |  |
| 305 | core | werewolf-create-game-redirects | Creating a werewolf game redirects to the game page | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 306 | core | werewolf-create-game-shows-error-on-failure | Failed game creation displays error message | P1 | logged_in | y | FAIL | C19 | | | |  |
| 307 | core | werewolf-events-tab-active-state | Events tab button toggles to active state when clicked | P2 | logged_in | y | FAIL |  | | | |  |
| 308 | core | werewolf-events-tab-shows-timeline | Clicking Events tab displays reducer-driven timeline content | P1 | logged_in | y | FAIL |  | | | |  |
| 309 | core | werewolf-lobby-accessible-anonymous | Werewolf lobby page is accessible to anonymous users | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 310 | core | werewolf-lobby-following-tab-switch | Clicking Following tab updates active tab state | P2 | logged_in | y | FAIL |  | | | |  |
| 311 | core | werewolf-lobby-live-tab-switch | Clicking Live tab activates the live games view | P2 | anonymous | y | FAIL |  | | | |  |
| 312 | core | werewolf-lobby-recent-tab-switch | Switching to Recent tab updates active tab state | P2 | logged_in | y | FAIL |  | | | |  |
| 313 | core | werewolf-lobby-search-filters-games | Lobby search filters displayed games by name or ID | P2 | logged_in | y | FAIL |  | | | |  |
| 314 | core | werewolf-lobby-search-preserves-on-refresh | Search filter persists across auto-refresh cycles | P2 | logged_in | n | skip |  | | | | schema: Required |
| 315 | core | werewolf-room-accessible-anonymous | Werewolf room page is accessible without authentication | P1 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 316 | core | werewolf-room-invalid-path-redirects-home | Invalid paths redirect to home page | P2 | anonymous | n | skip |  | | | | schema: Expected object, received string |
| 317 | core | werewolf-room-renders-with-app-shell | Werewolf room page renders within AppShell layout | P2 | anonymous | y | PASS |  | | | |  |
| 318 | core | werewolf-start-match-requires-ready-status | Starting match before all seats filled returns 409 | P1 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 319 | core | werewolf-start-match-transitions-to-running | Starting a werewolf match transitions status to running | P0 | logged_in | y | FAIL |  | | | |  |
| 320 | core | werewolf-timeline-audience-tab-switch | Clicking Audience tab activates audience view | P2 | logged_in | y | FAIL |  | | | |  |
| 321 | core | workbench-play-pause-toggle | Play/Pause button toggles playback state | P2 | logged_in | y | FAIL |  | | | |  |
| 322 | core | workbench-play-stops-on-empty-timeline | Playback stops automatically when timeline becomes empty | P2 | logged_in | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 323 | core | workbench-play-stops-on-hand-change | Playback stops when selecting a different hand | P2 | logged_in | y | FAIL |  | | | |  |
| 324 | core | ws-anonymous-connect | Anonymous users can connect to WebSocket endpoint | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 325 | core | ws-public-topics-no-auth | Public topics (lobby, table, match) accessible without authentication | P1 | anonymous | n | skip |  | | | | schema: Invalid discriminator value. Expected 'goto' | 'click' | 'fill' | 'wait' | 'http |
| 326 | simulate | simulate-form-api-error-display | API failure shows error alert | P1 | logged_in | y | FAIL |  | | | |  |
| 327 | simulate | simulate-form-success-shows-replay-link | Successful simulation shows match replay link | P1 | logged_in | y | FAIL |  | | | |  |
| 328 | simulate | simulate-form-validation-error-display | Invalid simulation config shows error alert | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 329 | smoke | SMOKE-api-anon-unauthorized | Anonymous API request returns 401 or redirect | P1 | anonymous | y | PASS |  | | | |  |
| 330 | smoke | SMOKE-nonexistent-route-404 | Nonexistent route returns 4xx | P1 | anonymous | y | PASS |  | | | |  |
| 331 | smoke | SMOKE-password-not-in-url | Password fields do not appear in URL | P0 | anonymous | y | PASS |  | | | |  |
| 332 | smoke | SMOKE-root-not-500 | Root route does not return 5xx | P0 | anonymous | y | PASS |  | | | |  |
| 333 | tables | cancel-delete-clears-error-state | Cancel delete clears any previous delete error | P2 | logged_in | y | FAIL |  | | | |  |
| 334 | tables | cancel-table-delete-closes-dialog | Cancel button closes delete confirmation without deleting table | P1 | logged_in | n | skip |  | | | | schema: Expected object, received string |
| 335 | tables | leave-seat-disabled-during-active-hand | Leave Seat button disabled during active hand | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)leave.*seat|leave (Invalid regular expression: /(?i)leave.*se |
| 336 | tables | leave-seat-removes-player | Leave Seat removes user from table | P1 | logged_in | n | skip |  | | | | schema: invalid regex: (?i)leave.*seat|leave (Invalid regular expression: /(?i)leave.*se |
| 337 | tables | table-confirm-delete-removes-table | Confirming table deletion removes the table and redirects | P0 | logged_in | n | skip |  | | | | schema: Expected object, received string |

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
