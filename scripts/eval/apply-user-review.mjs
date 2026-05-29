#!/usr/bin/env node
// Apply the user's CONTRACT_GAPS_DECISION_PAGE.md verdicts to ground-truth
// and emit a fix-plan for the residual work that needs code/contract changes.
//
// Source of truth: qa/CONTRACT_GAPS_DECISION_PAGE.md (hand-tabulated below).
//
// Five action classes per contract:
//   GT_FLIP_DROP   — flip current GT from approved to dropped
//   GT_FLIP_KEEP   — flip current GT from dropped to approved
//   GT_NOTE        — keep current GT but stamp the user's specific rationale into review.notes
//   SRC_EDIT       — needs source contract YAML changes (add expected / preconditions / etc.)
//   NEW_CONTRACT   — needs a brand-new REPLACE contract written
//   RUNNER_DSL     — needs runner schema/oracle extension
//
// Multi-class entries are normal (e.g. Group A is both GT_NOTE + SRC_EDIT + RUNNER_DSL).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const PLAN_OUT = 'qa/eval/poker/run-log/fix-plan.md';
const REVIEWER = 'user+rubber-duck-review';
const TODAY = new Date().toISOString();

// ────────────────────────────────────────────────────────────────────
// 1. The 14 DROPs — confirmed; 10 of them need a REPLACE contract.
// ────────────────────────────────────────────────────────────────────
const DROPS = [
  { id: 'api-werewolf-start-host-only', severity: 'P0', reason: 'trivial-url-regex (.*) — no real assertion.', replaceNeeded: true, replaceNote: 'P0 domain rule: only game creator can start. Rewrite as http POST + auth/role assertion via status code.' },
  { id: 'werewolf-agent-picker-requires-login', severity: 'P1', reason: 'no dom/url assertion.', replaceNeeded: false, replaceNote: 'Overlaps with werewolf-agent-picker-login-{navigation,link}; reorganize cluster instead.' },
  { id: 'all-in-button-disabled-while-submitting', severity: 'P1', reason: 'title says disabled but asserts presence of "Submitting".', replaceNeeded: true, replaceNote: 'Real intent: All-in button is disabled during submission. Need disabled-attribute or aria-disabled assertion + scoped to All-in button.' },
  { id: 'audience-reactions-start-at-zero', severity: 'P2', reason: 'noise-needles "0"/"data"/"error" — would silent-pass on most pages.', replaceNeeded: true, replaceNote: 'Use scoped selector + number-equals on the counter element initial state.' },
  { id: 'check-action-button-disabled-while-submitting', severity: 'P1', reason: 'title says disabled but asserts presence.', replaceNeeded: true, replaceNote: 'Same shape as all-in. Disabled-attribute assertion on Check button.' },
  { id: 'lobby-seed-input-accepts-optional-value', severity: 'P3', reason: 'expected.dom.contains_text is empty array.', replaceNeeded: true, replaceNote: 'Assert input.value after fill action.' },
  { id: 'raise-slider-shows-validation-error', severity: 'P1', reason: 'noise-needle "error" — too generic.', replaceNeeded: true, replaceNote: 'Scope to the validation error element + specific illegal raise scenario.' },
  { id: 'replay-hand-select-button-updates-view', severity: 'P1', reason: 'expected.dom.contains_text empty.', replaceNeeded: true, replaceNote: 'Verify view changed via diff signature or hand id in URL/DOM.' },
  { id: 'replay-next-button-advances-timeline', severity: 'P1', reason: 'expected.dom.contains_text empty.', replaceNeeded: true, replaceNote: 'Assert timeline index increments by 1.' },
  { id: 'replay-street-filter-resets-on-hand-change', severity: 'P2', reason: 'expected.dom.contains_text empty.', replaceNeeded: true, replaceNote: 'Assert filter UI shows "all" after hand change.' },
  { id: 'werewolf-lobby-recent-tab-filters-completed-games', severity: 'P2', reason: 'mirror assertion: click "RECENT" then assert text contains "RECENT" — doesnt test filtering.', replaceNeeded: true, replaceNote: 'Assert list content changed (different games shown).' },
  { id: 'werewolf-lobby-tab-featured-active-state', severity: 'P2', reason: 'mirror assertion variant.', replaceNeeded: true, replaceNote: 'Assert active class or aria-selected on Featured tab.' },
  { id: 'werewolf-lobby-tab-live-filters-games', severity: 'P2', reason: 'mirror assertion variant.', replaceNeeded: true, replaceNote: 'Assert list content changed (live games only).' },
  { id: 'match-replay-tab-switch-to-replay', severity: 'unranked', reason: 'empty contract — no body.', replaceNeeded: false, replaceNote: 'Permanent drop; no real intent to recover.' },
];

// ────────────────────────────────────────────────────────────────────
// 2. Group A — 20 dom-after-http contracts. KEEP intent, REWRITE expected.
//    Need runner DSL extension first (http.status + body.contains/not_contains_keys).
// ────────────────────────────────────────────────────────────────────
const GROUP_A_DOM_AFTER_HTTP = [
  { id: 'api-me-werewolf-agents-create-requires-csrf', severity: 'P0', rewrite: 'http.status: 403 + body has no agentId' },
  { id: 'api-tables-hand-replay-requires-auth', severity: 'P0', rewrite: 'http.status: 401' },
  { id: 'simulate-requires-csrf-token', severity: 'P0', rewrite: 'http.status: 403' },
  { id: 'delete-agent-requires-auth', severity: 'P0', rewrite: 'http.status: 401' },
  { id: 'api-decision-trace-strips-private-fields', severity: 'P1', rewrite: 'http.status: 200 + body.not_contains_keys: [privateStateHash, reasoningSummary]' },
  { id: 'api-matches-list-excludes-seed', severity: 'P1', rewrite: 'http.status: 200 + body items not_contains_keys: [seed]' },
  { id: 'api-matches-get-excludes-sensitive-fields', severity: 'P1', rewrite: 'http.status: 200 + body.not_contains_keys: [seed, internalState]' },
  { id: 'api-werewolf-match-get-strips-seed', severity: 'P1', rewrite: 'http.status: 200 + body.not_contains_keys: [seed]' },
  { id: 'api-werewolf-matches-strips-seed', severity: 'P1', rewrite: 'http.status: 200 + body.not_contains_keys: [seed]' },
  { id: 'api-werewolf-invite-npc-requires-csrf', severity: 'P1', rewrite: 'http.status: 403' },
  { id: 'api-agent-invites-revoke-hash-not-found', severity: 'P1', rewrite: 'http.status: 404' },
  { id: 'api-decision-trace-returns-404-for-missing-match', severity: 'P1', rewrite: 'http.status: 404' },
  { id: 'api-tables-get-hand-validates-hand-belongs-to-table', severity: 'P1', rewrite: 'http.status: 403/404 + body error code (IDOR)' },
  { id: 'api-tables-get-hand-validates-table-exists', severity: 'P1', rewrite: 'http.status: 404' },
  { id: 'api-me-werewolf-agents-create-validates-body', severity: 'P1', rewrite: 'http.status: 400 + body.contains: validation_error' },
  { id: 'api-tables-add-agent-validates-adapter-type', severity: 'P1', rewrite: 'http.status: 400 + body explains adapter constraint' },
  { id: 'api-tables-watch-not-found-invalid-table', severity: 'P1', rewrite: 'http.status: 404' },
  { id: 'simulate-validates-request-schema', severity: 'P1', rewrite: 'http.status: 400' },
  { id: 'api-matches-get-not-found-invalid-id', severity: 'P2', rewrite: 'http.status: 404' },
  { id: 'api-matches-decision-trace-returns-match-not-found', severity: 'P2', rewrite: 'http.status: 404' },
];

// ────────────────────────────────────────────────────────────────────
// 3. Group B — 5 NO_EXPECTED contracts. KEEP, source-edit to add expected.
// ────────────────────────────────────────────────────────────────────
const GROUP_B_NO_EXPECTED = [
  { id: 'api-tables-remove-agent-requires-auth', severity: 'P0', addExpected: { http: { status: 401 } } },
  { id: 'api-tables-create-validates-schema', severity: 'P1', addExpected: { http: { status: 400 } } },
  { id: 'api-auth-register-validates-input', severity: 'P1', addExpected: { http: { status: 400 } } },
  { id: 'api-agent-invites-register-invalid-token', severity: 'P1', addExpected: { http: { status: 404 } } },
  { id: 'api-werewolf-games-create-validates-name-length', severity: 'P2', addExpected: { http: { status: 400 } } },
];

// ────────────────────────────────────────────────────────────────────
// 4. Group C — 5 vacuous (4 FLIP TO DROP, 1 KEEP+STRENGTHEN)
// ────────────────────────────────────────────────────────────────────
const GROUP_C_VACUOUS_FLIP = [
  { id: 'audience-fire-reaction-increment', severity: 'P2', reason: 'contains_text "2" — single char, present on most pages.' },
  { id: 'audience-react-heart-increments-count', severity: 'P2', reason: 'contains_text "2" — same as fire-reaction.' },
  { id: 'audience-react-clap-multiple-clicks', severity: 'P3', reason: 'contains_text "3" — single char.' },
  { id: 'audience-wolf-reaction-increment', severity: 'P2', reason: 'contains_text "2" — single char.' },
];
const GROUP_C_STRENGTHEN = [
  { id: 'audience-strip-shows-watching-count', severity: 'P2', strengthen: 'Add scoped numeric assertion on count element; current "watching"/"AUDIENCE" needles are better than single-char but still weak.' },
];

// ────────────────────────────────────────────────────────────────────
// 5. Group D — 8 KEEP-with-STRENGTHEN
// ────────────────────────────────────────────────────────────────────
const GROUP_D_STRENGTHEN = [
  { id: 'agent-name-persists-on-edit-load', severity: 'P1', strengthen: 'Add attribute: value, equals: ${fixture.agent.name} — currently only asserts textbox presence.' },
  { id: 'appshell-invite-button-close-toggle', severity: 'P3', strengthen: 'G16 toggle half: add intermediate "dialog count == 1" assertion between open and close.' },
  { id: 'audience-react-heart-independent-counts', severity: 'P3', strengthen: 'Currently only asserts both buttons exist. Rewrite: click ❤️ then assert ❤️ +1 AND 🔥 unchanged.' },
  { id: 'audience-wolf-reaction-initial-zero', severity: 'P3', strengthen: 'Add count.text_equals: "0" on the wolf counter element; currently only asserts button presence.' },
  { id: 'check-action-button-visible-when-legal', severity: 'P1', strengthen: 'Add preconditions describing the game state where Check is legal; currently not setting up state.' },
  { id: 'confirm-dialog-cancel-closes-dialog', severity: 'P1', strengthen: 'G16 toggle half + no setup. Add: open dialog → assert count==1 → click cancel → assert count==0.' },
  { id: 'table-preset-amount-sets-bet-value', severity: 'P1', strengthen: 'Add input.value: <expected preset amount>; currently only asserts textbox presence.' },
  { id: 'werewolf-room-wrapped-in-app-shell', severity: 'P2', strengthen: 'Scope to app-shell container and assert inner content is werewolf room; "navigation" element appears on every page.' },
];

// ────────────────────────────────────────────────────────────────────
// 6. Group E — 3 KEEP, source-edit to add legacy_modules precondition
// ────────────────────────────────────────────────────────────────────
const GROUP_E_PRECONDITION = [
  { id: 'agents-edit-redirects-when-legacy-disabled', severity: 'P2', addPrecondition: { feature_flags: { legacy_modules: false } } },
  { id: 'match-replay-redirects-when-legacy-disabled', severity: 'P2', addPrecondition: { feature_flags: { legacy_modules: false } } },
  { id: 'route-table-redirect-when-disabled', severity: 'P1', addPrecondition: { feature_flags: { legacy_modules: false } } },
];

// ────────────────────────────────────────────────────────────────────
// 7. Group F — 14 clean KEEP, just stamp the user's confidence note
// ────────────────────────────────────────────────────────────────────
const GROUP_F_CLEAN_KEEP = [
  { id: 'appshell-login-navigates-to-login-page', note: 'STRONG: precise url.matches "^/login\\\\?next=%2F$" — validates `next` param mechanism. § A1 (returnTo) alarm voided.' },
  { id: 'login-page-respects-next-param-redirect', note: 'STRONG: precise url.matches "^/dashboard" — logged-in user with next param redirects correctly.' },
  { id: 'logout-clears-session-and-redirects', note: 'STRONG: url + auth_state.fully_logged_out double assertion (G7 closed).' },
  { id: 'werewolf-agent-picker-login-navigation', note: 'OK: url.matches "/login" — substring server-truthful.' },
  { id: 'werewolf-agent-picker-login-link', note: 'WEAK: contains_text "Login" — common word. Consider tightening to picker-scoped login link selector.' },
  { id: 'matches-open-replay-link-navigates', note: 'STRONG: url.matches "/replay/[^/]+$" — path pattern.' },
  { id: 'invite-http-agent-copies-to-clipboard', note: 'STRONG: long Chinese needle "已复制 HTTP Agent 邀请文案到剪贴板" — unmistakable.' },
  { id: 'invite-http-clipboard-fallback-shows-text', note: 'STRONG: long Chinese needle "邀请已生成,自动复制失败".' },
  { id: 'invite-popover-coding-api-error-toast', note: 'STRONG: long Chinese needle "邀请生成失败".' },
  { id: 'invite-popover-coding-generates-invite', note: 'STRONG: long Chinese needle "已复制 Coding Agent 邀请文案到剪贴板".' },
  { id: 'home-route-shows-loading-state', note: 'STRONG: Chinese needle "加载中…" — SUT is Chinese product; i18n hallucination alarm voided.' },
  { id: 'table-preset-amount-clears-error', note: 'MEDIUM: not_contains "Invalid amount" — depends on prior page state. Consider adding baseline capture.' },
  { id: 'agent-endpoint-url-persists-on-edit', note: 'WEAK: contains_text "Endpoint" — could be a label. Add input.value assertion (same as agent-name-persists-on-edit-load).' },
  { id: 'audience-strip-shows-watching-count', note: 'MEDIUM: "watching"+"AUDIENCE" multi-word needle stronger than single char but still weak; see Group C STRENGTHEN note.' },
];

// ────────────────────────────────────────────────────────────────────
// Apply functions
// ────────────────────────────────────────────────────────────────────

function findSourceContract(id) {
  for (const sub of ['agents', 'api', 'auth', 'core', '_smoke', 'dashboard', 'issues', 'simulate', 'tables']) {
    const p = join(FIXTURE, sub, `${id}.yml`);
    if (existsSync(p)) return { path: p, doc: parseYaml(readFileSync(p, 'utf8')) };
  }
  return null;
}

function gtPath(id) { return join(GT_DIR, `${id}.yml`); }

function updateGt(id, newStatus, noteToAppend, extra = {}) {
  const src = findSourceContract(id);
  if (!src) return { ok: false, reason: 'source contract missing' };
  const existing = existsSync(gtPath(id)) ? parseYaml(readFileSync(gtPath(id), 'utf8')) : null;
  const oldNotes = existing?.review?.notes ?? '';
  const noteSep = oldNotes ? '\n' : '';
  const newNotes = `${oldNotes}${noteSep}user-review ${TODAY.slice(0, 10)}: ${noteToAppend}`;

  const validity = newStatus === 'dropped' ? 'fp' : newStatus === 'merged' ? 'tp' : 'tp';

  const gt = {
    ...src.doc,
    category: existing?.category ?? ['unclassified'],
    provenance: {
      ...(existing?.provenance ?? {}),
      source: existing?.provenance?.source ?? 'autopilot',
      generated_at: existing?.provenance?.generated_at ?? TODAY,
      reviewed_by: REVIEWER,
      reviewed_at: TODAY,
      status: newStatus,
      duplicates_of: existing?.provenance?.duplicates_of ?? [],
    },
    review: {
      validity,
      validity_verified_in_product: existing?.review?.validity_verified_in_product ?? false,
      specificity: extra.specificity ?? existing?.review?.specificity ?? (newStatus === 'approved' ? 2 : 0),
      severity_original: src.doc.severity ?? 'P3',
      severity_final: extra.severityFinal ?? existing?.review?.severity_final ?? src.doc.severity ?? 'P3',
      notes: newNotes,
    },
  };
  writeFileSync(gtPath(id), toYaml(gt));
  return { ok: true };
}

const log = [];

// (1) DROPs — flip to dropped if not already
for (const d of DROPS) {
  const r = updateGt(d.id, 'dropped', `DROP confirmed (user review). ${d.reason}${d.replaceNeeded ? ' [REPLACE-NEEDED: ' + d.replaceNote + ']' : ' [no replace needed: ' + d.replaceNote + ']'}`);
  log.push({ id: d.id, action: r.ok ? 'GT_FLIP_DROP' : 'SKIP', class: 'drop', severity: d.severity, replaceNeeded: d.replaceNeeded, ok: r.ok, reason: r.reason });
}

// (2) Group A — keep approved + stamp REWRITE note
for (const g of GROUP_A_DOM_AFTER_HTTP) {
  const r = updateGt(g.id, 'approved', `KEEP intent (dom-after-http silent pass). Rewrite needed when runner DSL gains http assertion family. Target: ${g.rewrite}`);
  log.push({ id: g.id, action: r.ok ? 'GT_NOTE' : 'SKIP', class: 'group-a', severity: g.severity, rewriteTarget: g.rewrite, ok: r.ok });
}

// (3) Group B — keep approved + stamp ADD-EXPECTED note (source edit needed)
for (const g of GROUP_B_NO_EXPECTED) {
  const r = updateGt(g.id, 'approved', `KEEP intent (no expected block). Source contract needs expected: ${JSON.stringify(g.addExpected)}`);
  log.push({ id: g.id, action: r.ok ? 'GT_NOTE' : 'SKIP', class: 'group-b', severity: g.severity, addExpected: g.addExpected, ok: r.ok });
}

// (4) Group C — 4 FLIP TO DROP + 1 STRENGTHEN
for (const g of GROUP_C_VACUOUS_FLIP) {
  const r = updateGt(g.id, 'dropped', `FLIPPED to DROP (vacuous assertion). ${g.reason}`);
  log.push({ id: g.id, action: r.ok ? 'GT_FLIP_DROP' : 'SKIP', class: 'group-c-flip', severity: g.severity, ok: r.ok });
}
for (const g of GROUP_C_STRENGTHEN) {
  const r = updateGt(g.id, 'approved', `KEEP + STRENGTHEN. ${g.strengthen}`);
  log.push({ id: g.id, action: r.ok ? 'GT_NOTE' : 'SKIP', class: 'group-c-strengthen', severity: g.severity, strengthen: g.strengthen, ok: r.ok });
}

// (5) Group D — KEEP + STRENGTHEN
for (const g of GROUP_D_STRENGTHEN) {
  const r = updateGt(g.id, 'approved', `KEEP + STRENGTHEN. ${g.strengthen}`);
  log.push({ id: g.id, action: r.ok ? 'GT_NOTE' : 'SKIP', class: 'group-d', severity: g.severity, strengthen: g.strengthen, ok: r.ok });
}

// (6) Group E — KEEP + precondition gap
for (const g of GROUP_E_PRECONDITION) {
  const r = updateGt(g.id, 'approved', `KEEP, but source contract MUST add precondition: ${JSON.stringify(g.addPrecondition)}.`);
  log.push({ id: g.id, action: r.ok ? 'GT_NOTE' : 'SKIP', class: 'group-e', severity: g.severity, addPrecondition: g.addPrecondition, ok: r.ok });
}

// (7) Group F — clean KEEP
for (const g of GROUP_F_CLEAN_KEEP) {
  const r = updateGt(g.id, 'approved', `Clean KEEP. ${g.note}`);
  log.push({ id: g.id, action: r.ok ? 'GT_NOTE' : 'SKIP', class: 'group-f', ok: r.ok, note: g.note });
}

// ────────────────────────────────────────────────────────────────────
// Emit fix-plan.md
// ────────────────────────────────────────────────────────────────────
const plan = [];
plan.push('# Fix plan — derived from qa/CONTRACT_GAPS_DECISION_PAGE.md');
plan.push('');
plan.push(`Generated: ${TODAY.slice(0, 10)}. Applied by \`scripts/eval/apply-user-review.mjs\`.`);
plan.push('');
plan.push('## Done (already applied to qa/eval/poker/ground-truth/)');
plan.push('');
const applied = log.filter((x) => x.ok);
const byClass = {};
for (const l of applied) {
  byClass[l.class] = (byClass[l.class] || 0) + 1;
}
plan.push('| Class | Count | What was applied |');
plan.push('|---|---|---|');
plan.push(`| DROPs (14) | ${byClass['drop'] ?? 0} | GT flipped to dropped + user rationale in notes |`);
plan.push(`| Group A — dom-after-http (20) | ${byClass['group-a'] ?? 0} | GT kept approved, REWRITE target stamped in notes |`);
plan.push(`| Group B — no-expected (5) | ${byClass['group-b'] ?? 0} | GT kept approved, source-edit instruction stamped in notes |`);
plan.push(`| Group C — vacuous flip (4) | ${byClass['group-c-flip'] ?? 0} | GT flipped to dropped (vacuous single-char needles) |`);
plan.push(`| Group C — strengthen (1) | ${byClass['group-c-strengthen'] ?? 0} | GT kept approved, strengthen note stamped |`);
plan.push(`| Group D — strengthen (8) | ${byClass['group-d'] ?? 0} | GT kept approved, strengthen note stamped |`);
plan.push(`| Group E — precondition (3) | ${byClass['group-e'] ?? 0} | GT kept approved, precondition gap stamped |`);
plan.push(`| Group F — clean keep (14) | ${byClass['group-f'] ?? 0} | GT kept approved, confidence note stamped |`);
plan.push('');
plan.push(`Total GT updates: ${applied.length}.`);
plan.push('');

plan.push('## Outstanding — needs source contract edits, new contracts, or runner DSL changes');
plan.push('');
plan.push('### Stream 1: 🚨 Runner DSL extension (THIS WEEK — gates 20+ contracts)');
plan.push('');
plan.push('1. **Extend `packages/core/src/schemas/contract.schema.ts`**: add `expected.http` block:');
plan.push('   ```ts');
plan.push('   http: z.object({');
plan.push('     status: z.union([z.number().int(), z.array(z.number().int())]).optional(),');
plan.push('     body: z.object({');
plan.push('       contains: z.array(z.string()).optional(),');
plan.push('       not_contains: z.array(z.string()).optional(),');
plan.push('       contains_keys: z.array(z.string()).optional(),');
plan.push('       not_contains_keys: z.array(z.string()).optional(),');
plan.push('     }).optional(),');
plan.push('     headers: z.record(z.string()).optional(),');
plan.push('   }).optional(),');
plan.push('   ```');
plan.push('2. **`packages/oracle/src/declared-fields.ts`**: classify `expected.http` against the response captured by the `http` action.');
plan.push('3. **`packages/runner/src/compile.ts`**: extend `http` action to capture response (status + body); pass into oracle.');
plan.push('4. **Strictness check**: if `expected.dom` is asserted AND no goto/click/fill in actions (only http), emit an ERROR rather than silently evaluating dom on the wrong page.');
plan.push('5. New CONTRACT_GAPS entries: **G18 (HTTP action must use http assertion)**, **G19 (every contract must have evaluable expected block)**.');
plan.push('');

plan.push('### Stream 2: 📝 Source contract edits (after DSL lands)');
plan.push('');
plan.push('**Group B — 5 NO_EXPECTED contracts to fix:**');
plan.push('');
plan.push('| Contract | Severity | Add expected |');
plan.push('|---|---|---|');
for (const g of GROUP_B_NO_EXPECTED) {
  plan.push(`| \`${g.id}\` | ${g.severity} | \`${JSON.stringify(g.addExpected)}\` |`);
}
plan.push('');
plan.push('**Group E — 3 precondition additions:**');
plan.push('');
plan.push('| Contract | Severity | Add precondition |');
plan.push('|---|---|---|');
for (const g of GROUP_E_PRECONDITION) {
  plan.push(`| \`${g.id}\` | ${g.severity} | \`${JSON.stringify(g.addPrecondition)}\` |`);
}
plan.push('');
plan.push('**Group A — 20 dom-after-http REWRITEs (after http DSL lands):**');
plan.push('');
plan.push('| Contract | Severity | Rewrite target |');
plan.push('|---|---|---|');
for (const g of GROUP_A_DOM_AFTER_HTTP) {
  plan.push(`| \`${g.id}\` | ${g.severity} | ${g.rewrite} |`);
}
plan.push('');

plan.push('### Stream 3: 🆕 REPLACE contracts (10 valuable features behind DROP-ed contracts)');
plan.push('');
plan.push('| Dropped contract | Severity | What to write instead |');
plan.push('|---|---|---|');
for (const d of DROPS.filter((x) => x.replaceNeeded)) {
  plan.push(`| \`${d.id}\` | ${d.severity} | ${d.replaceNote.replace(/\|/g, '\\|')} |`);
}
plan.push('');

plan.push('### Stream 4: 💪 STRENGTHEN existing contracts (9 contracts — Group C+D strengthen)');
plan.push('');
plan.push('| Contract | Severity | Change |');
plan.push('|---|---|---|');
for (const g of [...GROUP_C_STRENGTHEN, ...GROUP_D_STRENGTHEN]) {
  plan.push(`| \`${g.id}\` | ${g.severity} | ${g.strengthen.replace(/\|/g, '\\|')} |`);
}
plan.push('');

plan.push('## Priority matrix (per user review § 优先级 Action 矩阵)');
plan.push('');
plan.push('### 🔥 This week — P0 silent-pass exposure');
plan.push('1. Land runner DSL extension (Stream 1)');
plan.push('2. Add expected blocks to 5 Group B contracts (Stream 2 sub-1)');
plan.push('3. REWRITE 8 P0/P1 security contracts from Group A:');
const aP0P1 = GROUP_A_DOM_AFTER_HTTP.filter((g) => g.severity === 'P0' || g.severity === 'P1').slice(0, 8);
for (const g of aP0P1) plan.push(`   - \`${g.id}\` (${g.severity}) → ${g.rewrite}`);
plan.push('');
plan.push('### ⚠️ This month');
plan.push('- REWRITE remaining 12 Group A contracts');
plan.push('- Add legacy_modules preconditions (Group E)');
plan.push('- REPLACE 10 valuable DROP-ed contracts (Stream 3)');
plan.push('- STRENGTHEN 9 contracts (Stream 4)');
plan.push('');
plan.push('### 💡 Continuous');
plan.push('- Rewrite 4 audience reaction contracts using structural foreach (per user template)');
plan.push('- Consolidate 3 agent-picker contracts');

writeFileSync(PLAN_OUT, plan.join('\n') + '\n');

// ────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────
const counts = {
  total: log.length,
  applied: applied.length,
  flipsDrop: applied.filter((x) => x.action === 'GT_FLIP_DROP').length,
  noteOnly: applied.filter((x) => x.action === 'GT_NOTE').length,
  failed: log.filter((x) => !x.ok).length,
};
console.log(`Applied user-review verdicts:`);
console.log(`  Total entries: ${counts.total}`);
console.log(`  GT flipped to DROP: ${counts.flipsDrop}`);
console.log(`  GT kept + note stamped: ${counts.noteOnly}`);
console.log(`  Failed (source missing): ${counts.failed}`);
console.log(`  Wrote: ${PLAN_OUT}`);
if (counts.failed > 0) {
  console.log('\nFailed entries:');
  for (const f of log.filter((x) => !x.ok)) console.log(`  ${f.id}: ${f.reason}`);
}
