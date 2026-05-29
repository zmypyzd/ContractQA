#!/usr/bin/env node
// Final pass — close out the 12 contracts the auto-decider skipped, based on
// hand-verified SUT source grep. Each entry below is justified by a grep hit
// (or miss) in /apps/web/src.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { join } from 'node:path';

const SRC = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT = 'qa/eval/poker/ground-truth';
const REVIEWER = 'eval-automation';

const DECISIONS = {
  // SUT evidence found → approved (intent valid; failure was state / selector / wrong page)
  'fold-button-submits-action':                       { status: 'approved', note: 'PlayerActionPanel.tsx + liveTableTypes have Fold action — intent valid; needs in-progress table state.' },
  'confirm-dialog-focus-management':                  { status: 'approved', note: 'ConfirmDialog.tsx exists; assertion ROLE_COUNT(button name=Cancel)>=1 is real intent but needs dialog to be open.' },
  'confirm-dialog-cancel-focus-on-open':              { status: 'approved', note: 'ConfirmDialog.tsx exists; intent valid but contract has no goto/open-dialog step before the wait.' },
  'analysis-sort-select-changes-order':               { status: 'approved', note: 'MatchAnalysisDashboard.tsx has the Sort combobox — needs match-analysis page state to reach it.' },
  'analysis-sort-select-all-options-available':       { status: 'approved', note: 'MatchAnalysisDashboard.tsx exists; intent valid (sort options).' },
  'replay-street-filter-resets-on-hand-change':       { status: 'approved', note: 'Street filter / replay UI exists in live-table reducer; needs running replay state.' },
  'replay-next-button-advances-timeline':             { status: 'approved', note: 'Replay Next button exists in live-table; needs replay state.' },

  // SUT evidence missing → dropped (likely hallucination or title-vs-body mismatch)
  'table-preset-amount-clears-error':                 { status: 'dropped', note: 'No grep hits for Min|Pot|Mid|Max preset buttons in web src — preset bet shortcut likely doesn\'t exist; hallucination.' },
  'table-preset-amount-sets-bet-value':               { status: 'dropped', note: 'Same as table-preset-amount-clears-error — preset buttons not in SUT.' },
  'confirm-dialog-escape-closes-dialog':              { status: 'dropped', note: 'Title says "Escape key closes dialog" but actions are click(role:dialog) — no Escape press. Assertion ROLE_COUNT(dialog)==1 contradicts the title (would expect ==0 after close). Self-inconsistent.' },
  'confirm-dialog-escape-cancels':                    { status: 'dropped', note: 'Same self-inconsistency as confirm-dialog-escape-closes-dialog — actions don\'t press Escape; title-body mismatch.' },
  'werewolf-agent-picker-login-link':                 { status: 'dropped', note: 'No grep hits for test_id "agent-picker-trigger" in web src — invented selector; likely hallucination.' },
};

function categorize(doc) {
  const c = [];
  const exp = doc?.expected ?? {};
  if (exp.auth_state || doc.preconditions?.auth_state === 'logged_in') c.push('auth-boundary');
  if (exp.url?.matches) c.push('happy-path');
  if (exp.dom?.contains_text?.some?.((t) => /error|fail|unauth|forbid|not.found|404|500|invalid/i.test(t))) c.push('error-state');
  if (c.length === 0) c.push('happy-path');
  return c;
}

function findFile(id) {
  const candidates = [
    `${SRC}/core/${id}.yml`,
    `${SRC}/auth/${id}.yml`,
    `${SRC}/api/${id}.yml`,
    `${SRC}/_smoke/${id}.yml`,
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

let written = 0;
for (const [id, { status, note }] of Object.entries(DECISIONS)) {
  const f = findFile(id);
  if (!f) { console.log(`SKIP missing source: ${id}`); continue; }
  const doc = parseYaml(readFileSync(f, 'utf8'));
  const now = new Date().toISOString();
  const gt = {
    ...doc,
    category: categorize(doc),
    provenance: {
      source: 'autopilot',
      generated_at: now,
      reviewed_by: REVIEWER,
      reviewed_at: now,
      status,
      duplicates_of: [],
    },
    review: {
      validity: status === 'dropped' ? 'fp' : 'tp',
      validity_verified_in_product: false,
      specificity: status === 'approved' ? 2 : 0,
      severity_original: doc.severity ?? 'P3',
      severity_final: doc.severity ?? 'P3',
      notes: note,
    },
  };
  writeFileSync(join(GT, `${id}.yml`), toYaml(gt));
  written++;
  console.log(`${status.padEnd(8)} ${id}`);
}
console.log(`\nwrote ${written} ground-truth files`);
