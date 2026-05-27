#!/usr/bin/env node
// Stream 4: STRENGTHEN 9 existing approved contracts in-place. Adds
// Stream 5 rich assertions on top of (or replacing) the existing weak
// expected blocks per fix-plan.md.
//
// Output: writes to qa/eval/poker/ground-truth/<id>.yml (same file).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseDocument } from 'yaml';

const GT_DIR = 'qa/eval/poker/ground-truth';

// strengthen[id] = function that takes current `expected` object and
// returns the new one. Pure transform — preserves any existing fields
// the user might want to keep, only adds/changes per spec.
const STRENGTHEN = {
  'audience-strip-shows-watching-count': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Replace vague contains_text:["watching","AUDIENCE"] with a scoped
      // numeric assertion on the count element. If it shows "0" initially
      // that's the rigorous signal; the words alone might be in any page chrome.
      element_text_equals: [{ target: { test_id: 'audience-watching-count' }, equals: '0' }],
    },
  }),
  'agent-name-persists-on-edit-load': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Existing role_count: textbox gte 1 just confirms the textbox is rendered.
      // Add input_value to confirm the agent name was actually loaded into it.
      input_value: [{ target: { role: 'textbox', name_regex: '[Aa]gent [Nn]ame' }, matches: '^.+$' }],
    },
  }),
  'appshell-invite-button-close-toggle': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original only asserted final state (dialog count 0). G16 toggle-half:
      // we should also assert dialog count == 1 mid-sequence. We can't easily
      // do that without a between-clicks snapshot, but we CAN at least assert
      // the final dialog count == 0 explicitly (the original used the
      // existing role_count). Strengthen by also asserting the invite button
      // is back to non-pressed (aria-pressed=false) after the close.
      attribute_equals: [
        { target: { role: 'button', name_regex: '邀请' }, attribute: 'aria-pressed', equals: 'false' },
      ],
    },
  }),
  'audience-react-heart-independent-counts': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original only asserts both buttons exist. After clicking ❤️ then 🔥,
      // each counter should reflect its own count. Stream 5 scoped assertions:
      element_text_equals: [
        { target: { test_id: 'react-heart-count' }, equals: '1' },
        { target: { test_id: 'react-fire-count' }, equals: '1' },
      ],
    },
  }),
  'audience-wolf-reaction-initial-zero': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original asserts button presence; STRENGTHEN to also assert initial counter "0".
      element_text_equals: [{ target: { test_id: 'react-wolf-count' }, equals: '0' }],
    },
  }),
  'check-action-button-visible-when-legal': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original asserts button exists; STRENGTHEN to also assert it is
      // ENABLED (not just disabled-but-rendered).
      attribute_equals: [{ target: { role: 'button', name_regex: '^Check$' }, attribute: 'disabled', equals: false }],
    },
  }),
  // Add the missing precondition documenting the game state where Check is
  // legal. The runner doesn't auto-setup, but the precondition signals intent.
  // (Handled via preconditions merge below.)
  'confirm-dialog-cancel-closes-dialog': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original: role_count dialog eq 0 (after close). Strengthen by
      // asserting the dialog's open attribute is NOT present (aria-hidden
      // not set might also be reasonable signal).
      attribute_equals: [{ target: { role: 'dialog' }, attribute: 'open', equals: false }],
    },
  }),
  'table-preset-amount-sets-bet-value': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original asserts textbox count >= 1. Strengthen: after clicking
      // a preset button, the bet input value should be a non-empty number.
      input_value: [{ target: { role: 'textbox' }, matches: '^\\d+$' }],
    },
  }),
  'werewolf-room-wrapped-in-app-shell': (cur) => ({
    ...cur,
    dom: {
      ...(cur.dom ?? {}),
      // Original asserts navigation count >= 1 — but navigation appears on
      // every page. Strengthen: scope to an app-shell container class that
      // is specific to logged-in werewolf-room rendering.
      class_contains: [{ target: { test_id: 'app-shell' }, class: 'werewolf-room' }],
    },
  }),
};

// Optional preconditions patch — applied AFTER strengthen() to add intent.
const PRECONDITION_PATCH = {
  'check-action-button-visible-when-legal': {
    auth_state: 'logged_in',
    role: 'normal_user_at_active_table',
    // Documents the state where Check is legal. Runner can't auto-setup
    // game state, but the field anchors the intent for human reviewers.
  },
};

const STAMP =
  'Stream 4 STRENGTHEN 2026-05-27: extended expected with Stream 5 rich assertions (attribute_equals / ' +
  'input_value / class_contains / element_text_equals scoped to test_id) to replace vacuous role_count-only ' +
  'or contains_text-only checks. See docs/stream5-dom-rich-assertions.md.';

function applyOne(id) {
  const p = path.join(GT_DIR, `${id}.yml`);
  const doc = parseDocument(readFileSync(p, 'utf8'));
  const cur = doc.getIn(['expected']);
  const curJs =
    cur && typeof cur === 'object' && 'toJSON' in cur ? cur.toJSON() : cur ?? {};
  const next = STRENGTHEN[id](curJs ?? {});
  doc.setIn(['expected'], next);

  if (PRECONDITION_PATCH[id]) {
    const exist = doc.getIn(['preconditions']);
    const existJs =
      exist && typeof exist === 'object' && 'toJSON' in exist ? exist.toJSON() : exist ?? {};
    doc.setIn(['preconditions'], { ...existJs, ...PRECONDITION_PATCH[id] });
  }

  const oldNotes = doc.getIn(['review', 'notes']);
  const stamped =
    typeof oldNotes === 'string' && oldNotes.length > 0 ? `${oldNotes}\n\n${STAMP}` : STAMP;
  doc.setIn(['review', 'notes'], stamped);

  writeFileSync(p, doc.toString({ lineWidth: 0 }), 'utf8');
  return p;
}

const written = [];
for (const id of Object.keys(STRENGTHEN)) written.push(applyOne(id));
console.log(`Stream 4 STRENGTHEN: applied to ${written.length} contracts.`);
for (const p of written) console.log(`  ✓ ${p}`);

let bad = 0;
for (const p of written) {
  try {
    parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`  ✗ malformed: ${p}: ${e.message}`);
    bad++;
  }
}
if (bad) process.exit(1);
