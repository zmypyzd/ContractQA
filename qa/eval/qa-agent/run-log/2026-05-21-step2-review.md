# Step 2 review log — qa-agent (self-dogfood) — 2026-05-21

Reviewer: <fill in>
Autopilot baseline: `qa/contracts/` as-of 2026-05-21 (66 contracts)
Source report: `qa/AUTOPILOT_REPORT.json` (`phaseB.generated: 35` — note the on-disk
count is 66 because earlier autopilot runs accumulated; the eval baseline is
**the on-disk set at the tag**, not the last-run delta).

> **Process**: for each row, open the contract YAML, open the product, mark
> `decision` and `duplicates_of`. When done, materialize each decision as a
> `qa/eval/qa-agent/ground-truth/<id>.yml` file per `qa/eval/schema.md`.
> Don't silently delete dropped/merged — they're the evidence for `fp_rate`
> and `dedup_inflation`.

## Suspected duplicate clusters

Pre-grouped by title similarity. **Verify in product before merging** — autopilot
may have emitted near-identical titles for genuinely different selectors or
states. Pick one canonical id per cluster; the rest get `status: merged` +
`duplicates_of: [<canonical>]`.

### folder-picker (8 + 2 + 4 = 14 contracts → likely ~3 behaviors)
- **Backdrop click closes** (4):
  - folder-picker-backdrop-click-closes-dialog
  - folder-picker-backdrop-click-closes
  - folder-picker-backdrop-click-dismisses-modal
  - folder-picker-backdrop-close
- **Escape key closes** (4):
  - folder-picker-escape-close
  - folder-picker-escape-closes
  - folder-picker-escape-key-closes-dialog
  - folder-picker-escape-key-dismisses-modal
- **Close button closes** (2):
  - folder-picker-close-button-closes
  - folder-picker-close-button-dismisses-modal
- **Breadcrumb → ancestor** (2):
  - breadcrumb-navigates-to-ancestor
  - folder-picker-breadcrumb-navigates-to-ancestor
- **Breadcrumb → root** (2):
  - breadcrumb-root-navigates-to-filesystem-root
  - folder-picker-root-breadcrumb-navigates-to-root

### login (10 contracts → likely ~3 behaviors)
- **Form requires both fields** (2):
  - login-form-requires-both-fields
  - login-requires-email-and-password
- **Sets auth token on success** (3):
  - login-form-sets-auth-token
  - login-form-submit-sets-auth-token
  - login-success-sets-auth-token
- **Redirects to lobby on success** (4):
  - login-form-submit-navigates-to-lobby
  - login-form-success-redirect
  - login-form-success-redirects-to-lobby
  - login-success-redirects-to-lobby
- **Combined token + redirect** (1, possibly a merger of the two above — verify):
  - login-sets-auth-token-and-redirects

### artifacts (4 contracts, 2 behaviors)
- **Invalid issue → 404** (2):
  - artifact-invalid-issue-returns-404
  - artifacts-invalid-issue-returns-404
- **Path traversal blocked** (2 — note **status code disagreement**: 403 vs 404):
  - artifact-path-traversal-returns-403   ← 403
  - artifacts-path-traversal-blocked      ← 404
  - Resolve which is the real expected behavior; the loser is `dropped`,
    not `merged` (different expected response = different contract).

### navigation (multiple clusters)
- **Dashboard root → /runs** (2):
  - dashboard-root-redirects-to-runs
  - route-dashboard-home-redirects-to-runs
- **Home → lobby link** (2):
  - link-fixture-lobby-navigation
  - link-fixture-to-lobby
- **Home → login link** (2):
  - link-fixture-login-navigates
  - navigate-to-login-page
- **Empty runs state → launcher** (2):
  - link-runs-empty-launcher-navigation
  - link-runs-empty-launcher
- **Runs toolbar → launcher** (3):
  - link-runs-to-launcher-navigation
  - link-runs-to-launcher
  - toolbar-launcher-link-navigates-to-launcher
- **New-run button → launcher** (2):
  - new-run-button-navigates-to-launcher
  - new-run-link-navigates-to-launcher
- **Run row → run detail** (3):
  - link-run-row-view-navigates-to-run-details
  - run-row-link-navigates-to-details
  - runs-row-timestamp-navigates-to-detail
- **Home → agents** (2):
  - link-to-agents-navigates
  - navigate-to-agents-page
- **Run detail → back to runs** (cross-folder dup, 2):
  - core/link-run-detail-back-to-runs
  - dashboard/link-run-detail-back-to-runs

**If every cluster collapses to its smallest plausible size:** 66 → ~28 canonical
behaviors. Expected `dedup_inflation ≈ 0.58`. If that holds after review, it's
the single most actionable finding for the deep-discovery agent.

## All 66 contracts — decision table

Fill `decision` ∈ {`approved`, `dropped`, `merged`} and `duplicates_of` (if merged)
for every row. `verified_in_product` MUST be `yes` for any `approved` row.

| # | area | id | title | decision | duplicates_of | verified_in_product | notes |
|---|---|---|---|---|---|---|---|
| 1 | smoke | SMOKE-api-anon-unauthorized | Anonymous API request returns 401 or redirect | | | | |
| 2 | smoke | SMOKE-nonexistent-route-404 | Nonexistent route returns 4xx | | | | |
| 3 | smoke | SMOKE-password-not-in-url | Password fields do not appear in URL | | | | |
| 4 | smoke | SMOKE-root-not-500 | Root route does not return 5xx | | | | |
| 5 | api | api-runs-create-invalid-json | Create run API rejects invalid JSON body | | | | |
| 6 | api | api-runs-create-requires-cwd | Create run API requires cwd field | | | | |
| 7 | api | api-runs-create-returns-id | Create run API returns run id on success | | | | |
| 8 | auth | INV-A2 | Logged-out users cannot access protected routes | | | | hand-written, not autopilot — likely keep as approved |
| 9 | auth | lobby-logout-navigates-to-login-stub | Logout navigates to /login-stub | | | | |
| 10 | auth | lobby-logout-sets-auth-state-logged-out | Logout sets auth-state to logged_out | | | | |
| 11 | auth | login-form-requires-both-fields | Login form does not submit when fields are empty | | | | dup cluster: form-requires-fields |
| 12 | auth | login-form-sets-auth-token | Successful login stores auth token | | | | dup cluster: sets-token |
| 13 | auth | login-form-submit-navigates-to-lobby | Successful login navigates to lobby | | | | dup cluster: redirect-to-lobby |
| 14 | auth | login-form-submit-sets-auth-token | Successful login stores auth token | | | | dup cluster: sets-token |
| 15 | auth | login-form-success-redirect | Successful login redirects to lobby | | | | dup cluster: redirect-to-lobby |
| 16 | auth | login-form-success-redirects-to-lobby | Successful login redirects to lobby | | | | dup cluster: redirect-to-lobby |
| 17 | auth | login-requires-email-and-password | Login form requires both email and password | | | | dup cluster: form-requires-fields |
| 18 | auth | login-sets-auth-token-and-redirects | Successful login stores token + redirects to lobby | | | | combined dup — check whether token + redirect is one assertion or two |
| 19 | auth | login-success-redirects-to-lobby | Successful login redirects to lobby | | | | dup cluster: redirect-to-lobby |
| 20 | auth | login-success-sets-auth-token | Successful login stores auth token | | | | dup cluster: sets-token |
| 21 | core | artifact-invalid-issue-returns-404 | Artifact request for non-existent issue returns 404 | | | | dup cluster: artifact-invalid-404 |
| 22 | core | artifact-path-traversal-returns-403 | Path traversal returns 403 | | | | conflict cluster: traversal-status |
| 23 | core | artifact-valid-issue-returns-200 | Valid artifact request returns 200 | | | | |
| 24 | core | artifacts-invalid-issue-returns-404 | Non-existent issueId returns 404 | | | | dup cluster: artifact-invalid-404 |
| 25 | core | artifacts-missing-path-returns-404 | Empty path segment returns 404 | | | | |
| 26 | core | artifacts-path-traversal-blocked | Path traversal returns 404 | | | | conflict cluster: traversal-status |
| 27 | core | breadcrumb-navigates-to-ancestor | Breadcrumb segment navigates to ancestor | | | | dup cluster: breadcrumb-ancestor |
| 28 | core | breadcrumb-root-navigates-to-filesystem-root | Root breadcrumb navigates to fs root | | | | dup cluster: breadcrumb-root |
| 29 | core | dashboard-root-redirects-to-runs | Dashboard root redirects to /runs | | | | dup cluster: dashboard-root-redirect |
| 30 | core | folder-picker-backdrop-click-closes-dialog | Backdrop closes folder picker | | | | dup cluster: fp-backdrop |
| 31 | core | folder-picker-backdrop-click-closes | Backdrop closes folder picker | | | | dup cluster: fp-backdrop |
| 32 | core | folder-picker-backdrop-click-dismisses-modal | Backdrop dismisses folder picker | | | | dup cluster: fp-backdrop |
| 33 | core | folder-picker-backdrop-close | Backdrop closes folder picker | | | | dup cluster: fp-backdrop |
| 34 | core | folder-picker-breadcrumb-navigates-to-ancestor | Breadcrumb navigates to ancestor | | | | dup cluster: breadcrumb-ancestor |
| 35 | core | folder-picker-cancel-closes-dialog | Cancel button closes picker | | | | |
| 36 | core | folder-picker-close-button-closes | Close button closes picker | | | | dup cluster: fp-close-button |
| 37 | core | folder-picker-close-button-dismisses-modal | Close button dismisses picker | | | | dup cluster: fp-close-button |
| 38 | core | folder-picker-escape-close | Escape closes picker | | | | dup cluster: fp-escape |
| 39 | core | folder-picker-escape-closes | Escape closes picker | | | | dup cluster: fp-escape |
| 40 | core | folder-picker-escape-key-closes-dialog | Escape key closes picker | | | | dup cluster: fp-escape |
| 41 | core | folder-picker-escape-key-dismisses-modal | Escape key dismisses picker | | | | dup cluster: fp-escape |
| 42 | core | folder-picker-navigate-to-root | Root button loads fs root | | | | |
| 43 | core | folder-picker-root-breadcrumb-navigates-to-root | Root breadcrumb navigates to fs root | | | | dup cluster: breadcrumb-root |
| 44 | core | health-check-returns-ok | Health check returns ok | | | | |
| 45 | core | link-fixture-lobby-navigation | Lobby link navigates to /lobby | | | | dup cluster: home-to-lobby |
| 46 | core | link-fixture-login-navigates | Login link navigates to login page | | | | dup cluster: home-to-login |
| 47 | core | link-fixture-to-lobby | Lobby link from home → /lobby | | | | dup cluster: home-to-lobby |
| 48 | core | link-run-detail-back-to-runs | Back-to-runs link from run detail | | | | dup cluster: back-to-runs (vs dashboard/) |
| 49 | core | link-run-row-view-navigates-to-run-details | View arrow → run details | | | | dup cluster: run-row-detail |
| 50 | core | link-runs-empty-launcher-navigation | Empty-state launcher link → /launcher | | | | dup cluster: runs-empty-launcher |
| 51 | core | link-runs-empty-launcher | Empty-state launcher link → /launcher | | | | dup cluster: runs-empty-launcher |
| 52 | core | link-runs-to-launcher-navigation | Runs toolbar launcher → /launcher | | | | dup cluster: runs-toolbar-launcher |
| 53 | core | link-runs-to-launcher | Runs header launcher → /launcher | | | | dup cluster: runs-toolbar-launcher |
| 54 | core | link-to-agents-navigates | Agents link → /agents | | | | dup cluster: home-to-agents |
| 55 | core | navigate-to-agents-page | Home → /agents | | | | dup cluster: home-to-agents |
| 56 | core | navigate-to-login-page | Home → login | | | | dup cluster: home-to-login |
| 57 | core | navigate-to-runs-from-issue-toolbar | Issue toolbar → /runs | | | | |
| 58 | core | new-run-button-navigates-to-launcher | New-run button → launcher | | | | dup cluster: new-run-launcher |
| 59 | core | new-run-link-navigates-to-launcher | New-run link → launcher | | | | dup cluster: new-run-launcher |
| 60 | core | route-dashboard-home-redirects-to-runs | Dashboard home → /runs | | | | dup cluster: dashboard-root-redirect |
| 61 | core | run-row-link-navigates-to-details | Run row click → run detail | | | | dup cluster: run-row-detail |
| 62 | core | runs-row-timestamp-navigates-to-detail | Timestamp cell click → run detail | | | | dup cluster: run-row-detail (verify it's actually the same target) |
| 63 | core | toolbar-launcher-link-navigates-to-launcher | Toolbar launcher → /launcher | | | | dup cluster: runs-toolbar-launcher |
| 64 | dashboard | link-run-detail-back-to-runs | Back-to-runs from run detail | | | | dup cluster: back-to-runs (vs core/) |
| 65 | issues | link-issue-runs-db-error | Recent runs link works on DB error | | | | |
| 66 | issues | link-issue-runs-not-found | Recent runs link works when issue 404s | | | | |

## After review

Materialize ground truth:
```bash
# for each row where decision != blank, write qa/eval/qa-agent/ground-truth/<id>.yml
# containing the original YAML body + the eval-only fields (review/provenance/category)
```

Then walk `qa/eval/checklist.md` for step 3. Then:
```bash
node scripts/eval/score.mjs --project qa-agent \
  --autopilot-dir qa/contracts \
  --out qa/eval/qa-agent/score-2026-05-21.json
```
