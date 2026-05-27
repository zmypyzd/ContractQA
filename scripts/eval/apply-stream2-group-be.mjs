#!/usr/bin/env node
// Stream 2 残量: apply Group B (NO_EXPECTED) + Group E (precondition gap)
// rewrites to qa/eval/poker/ground-truth/.
//
// Group B: contracts that were schema-invalid because they had no `expected`
// block. Add expected.http.{status} per user-review target.
//
// Group E: contracts whose intent depends on a feature flag being toggled
// (legacy_modules: false). Add preconditions.feature_flags so the contract
// documents its setup requirement. Schema accepts feature_flags as of
// 2026-05-27 (see packages/core/src/schemas/contract.schema.ts).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseDocument } from 'yaml';

const GT_DIR = 'qa/eval/poker/ground-truth';

const GROUP_B = {
  'api-tables-remove-agent-requires-auth': { status: 401 },
  'api-tables-create-validates-schema': { status: 400 },
  'api-auth-register-validates-input': { status: 400 },
  'api-werewolf-games-create-validates-name-length': { status: 400 },
};

const GROUP_E_FLAGS = { legacy_modules: false };
const GROUP_E_IDS = [
  'agents-edit-redirects-when-legacy-disabled',
  'match-replay-redirects-when-legacy-disabled',
  'route-table-redirect-when-disabled',
];

const STAMP_B = 'Stream 2 残量 (Group B) 2026-05-27: added expected.http per reviewer target above.';
const STAMP_E =
  'Stream 2 残量 (Group E) 2026-05-27: added preconditions.feature_flags so the contract documents its SUT setup. ' +
  'Schema accepts feature_flags as of Stream 2 残量 schema extension; runner does not auto-toggle.';

function appendNote(doc, stamp) {
  const oldNotes = doc.getIn(['review', 'notes']);
  const stamped =
    typeof oldNotes === 'string' && oldNotes.length > 0 ? `${oldNotes}\n\n${stamp}` : stamp;
  doc.setIn(['review', 'notes'], stamped);
}

function rewriteGroupB(id) {
  const p = path.join(GT_DIR, `${id}.yml`);
  const doc = parseDocument(readFileSync(p, 'utf8'));
  doc.setIn(['expected'], { http: GROUP_B[id] });
  appendNote(doc, STAMP_B);
  writeFileSync(p, doc.toString({ lineWidth: 0 }), 'utf8');
  return p;
}

function rewriteGroupE(id) {
  const p = path.join(GT_DIR, `${id}.yml`);
  const doc = parseDocument(readFileSync(p, 'utf8'));
  // Preserve any existing auth_state/role; only inject feature_flags.
  const existing = doc.getIn(['preconditions']);
  const merged =
    existing && typeof existing === 'object' && 'toJSON' in existing
      ? { ...existing.toJSON(), feature_flags: GROUP_E_FLAGS }
      : { feature_flags: GROUP_E_FLAGS };
  doc.setIn(['preconditions'], merged);
  appendNote(doc, STAMP_E);
  writeFileSync(p, doc.toString({ lineWidth: 0 }), 'utf8');
  return p;
}

const written = [];
for (const id of Object.keys(GROUP_B)) written.push(rewriteGroupB(id));
for (const id of GROUP_E_IDS) written.push(rewriteGroupE(id));

console.log(`Stream 2 残量: rewrote ${written.length} contracts (4 Group B + 3 Group E).`);
for (const p of written) console.log(`  ✓ ${p}`);

// Sanity: re-parse each as YAML.
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
