# Step 3 — Category-driven exploration checklist

After step 2 (reviewing and approving autopilot's contracts), walk this
checklist to find contracts the agent didn't generate. Use Claude Code as
an exploration copilot — but **you** drive the probes. Claude Code shares
the QA agent's LLM-class blind spots, so don't outsource the imagination.

## Rules

1. Walk **every** category. "Didn't look" and "looked, found nothing" are
   different outcomes — both must be recorded.
2. For each new contract, set `provenance.source: human-explore`.
3. At the end, write a per-category summary in
   `qa/eval/<project>/run-log/<date>-step3.md`:
   ```
   category: race-condition
   probed: yes
   contracts_added: 3
   notes: ...
   ```
4. **Stop condition**: every category has a recorded outcome AND you've spent
   ≥ 30 minutes on the project in this step. If `contracts_added: 0` across
   categories 4–10, re-read those probes and do one more pass before stopping.

## Categories

### 1. happy-path
Flows that aren't bugs but should never regress.
- Probe: enumerate top-nav links → one contract per click → expected URL/state.
- Probe: primary CTA on each top-level page works.
- Probe: anonymous user can reach the documented public surface.

### 2. error-state
What the UI does when things break.
- Empty states (no runs yet, no issues yet, no artifacts).
- 4xx (invalid id in URL, missing artifact, malformed query).
- 5xx (backend down — already partially in `qa/contracts/issues/`).
- Stale / partial data (cancelled run, half-written log).
- Probe: visit `/runs/does-not-exist`, `/issues/garbage`. Kill the backend
  process and reload each page.

### 3. auth-boundary
Authorization, not just authentication.
- Anonymous accessing protected route.
- User A accessing User B's resource (IDOR).
- Expired session, mid-flight token revocation.
- Probe: if multi-user, log in as A, copy a URL containing A's id, open
  it in B's session.

### 4. race-condition
Anything that depends on order, concurrency, or timing.
- Double-click a button that triggers an async action.
- Navigate away mid-fetch.
- Two tabs editing the same record.
- Re-submit a form before the first response returns.
- Probe: DevTools → throttle to Slow 3G → click primary actions rapidly.

### 5. network-failure
- Offline (DevTools → Offline).
- Slow 3G / timeout.
- Request fails mid-upload.
- Retry behavior on transient failure (does the UI loop forever?).
- Probe: load each top-level page with DevTools "Offline" toggled mid-load.

### 6. a11y
- Tab order is logical and lands on every interactive element.
- Focus is visible.
- All interactive elements reachable by keyboard alone.
- Screen-reader name/role on icon-only buttons.
- Color contrast — DESIGN.md sodium yellow `#F4D03F` on dark must be ≥ 4.5:1
  for body text (≥ 3:1 for large text only).
- Probe: tab through each page top-to-bottom without a mouse.

### 7. mobile / responsive
- Layout at 375px (small phone), 768px (tablet), 1440px (desktop).
- Tap targets ≥ 44px.
- No horizontal scroll at 375px.
- Modal / dialog behavior on narrow screens (does it eat the viewport?).
- Probe: resize browser to 375px width on each top-level page.

### 8. i18n / timezone / locale
- Dates in UTC vs local — labeled which one?
- Number formatting (1,000 vs 1.000).
- Long strings (German is ~30% longer than English — does layout break?).
- RTL (only if the product claims to support it).
- Probe: change OS timezone to UTC-12 and reload — do timestamps still
  make sense? Are "X minutes ago" labels consistent with absolute timestamps?

### 9. security
- Path traversal (already partially: `artifact-path-traversal-returns-403.yml`).
- SQL / NoSQL injection in any free-text field.
- XSS in any user-controlled text rendered to the page.
- CSRF on state-changing endpoints.
- IDOR (cross-ref auth-boundary).
- Probe: paste `<script>alert(1)</script>` and `'; DROP TABLE users;--`
  into every text input. Check whether it round-trips into the DOM
  unescaped.

### 10. edge inputs
- Empty string, whitespace-only.
- Max length + 1 (find documented or de-facto cap, exceed by one).
- Unicode (emoji 🚀, combining chars, RTL marks, NUL byte).
- Negative numbers, zero, very large numbers.
- Probe: paste 10,000 chars of `a` into the first text field on each page.

## Per-category log template

Copy into `qa/eval/<project>/run-log/<date>-step3.md`:

```markdown
# Step 3 exploration log — <project> — <date>

Reviewer: <you>
Duration: <minutes>

## happy-path
probed: yes
contracts_added: <n>
notes:

## error-state
probed: yes
contracts_added: <n>
notes:

## auth-boundary
probed: <yes|no — product is single-user>
contracts_added: <n>
notes:

## race-condition
probed: yes
contracts_added: <n>
notes:

## network-failure
probed: yes
contracts_added: <n>
notes:

## a11y
probed: yes
contracts_added: <n>
notes:

## mobile / responsive
probed: yes
contracts_added: <n>
notes:

## i18n / timezone / locale
probed: yes
contracts_added: <n>
notes:

## security
probed: yes
contracts_added: <n>
notes:

## edge inputs
probed: yes
contracts_added: <n>
notes:

## Summary
total contracts added in step 3: <n>
categories with 0 added: <list>
sanity check passed (no zeros in cats 4–10 without re-probe): <yes|no>
```
