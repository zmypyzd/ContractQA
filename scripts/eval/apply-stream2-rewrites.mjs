#!/usr/bin/env node
// Stream 2: apply Group A REWRITEs to qa/eval/poker/ground-truth/.
// Each rewrite replaces `expected.dom.*` with `expected.http.*` per the
// reviewer's target in the contract's notes (already captured in fix-plan).
//
// Why a script vs. 21 manual edits: machine-readable, re-runnable, and the
// rewrite map below doubles as documentation of WHAT the user-review decided.
//
// After running, re-validate via `pnpm --filter @contractqa/core test` —
// the Stream 1 ExpectedBlock.strict() schema check fires on load, and
// G18 (compileContract) would throw at run time if any rewrite left a
// stale `dom` block.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseDocument } from 'yaml';

const GT_DIR = 'qa/eval/poker/ground-truth';

// Target: expected.http block per the user-review notes.
// `status` is the response code(s) expected; `body` is optional.
const REWRITES = {
  'api-agent-invites-register-invalid-token': { status: 404 },
  'api-agent-invites-revoke-hash-not-found': { status: 404 },
  'api-decision-trace-returns-404-for-missing-match': { status: 404 },
  'api-decision-trace-strips-private-fields': {
    status: 200,
    body: { not_contains_keys: ['privateStateHash', 'reasoningSummary'] },
  },
  'api-matches-decision-trace-returns-match-not-found': { status: 404 },
  'api-matches-get-excludes-sensitive-fields': {
    status: 200,
    body: { not_contains_keys: ['seed', 'internalState'] },
  },
  'api-matches-get-not-found-invalid-id': { status: 404 },
  'api-matches-list-excludes-seed': {
    status: 200,
    body: { not_contains_keys: ['seed'] },
  },
  'api-me-werewolf-agents-create-requires-csrf': {
    status: 403,
    body: { not_contains_keys: ['agentId'] },
  },
  'api-me-werewolf-agents-create-validates-body': {
    status: 400,
    body: { contains: ['validation_error'] },
  },
  'api-tables-add-agent-validates-adapter-type': {
    status: 400,
    body: { contains: ['adapterType'] },
  },
  // IDOR boundary — server may distinguish 403 (auth'd but wrong owner)
  // from 404 (hand simply missing). Accept either; the failure mode this
  // contract guards against is the 200 silent-leak.
  'api-tables-get-hand-validates-hand-belongs-to-table': {
    status: [403, 404],
  },
  'api-tables-get-hand-validates-table-exists': { status: 404 },
  'api-tables-hand-replay-requires-auth': { status: 401 },
  'api-tables-watch-not-found-invalid-table': { status: 404 },
  'api-werewolf-invite-npc-requires-csrf': { status: 403 },
  'api-werewolf-match-get-strips-seed': {
    status: 200,
    body: { not_contains_keys: ['seed'] },
  },
  'api-werewolf-matches-strips-seed': {
    status: 200,
    body: { not_contains_keys: ['seed'] },
  },
  'delete-agent-requires-auth': { status: 401 },
  'simulate-requires-csrf-token': { status: 403 },
  'simulate-validates-request-schema': { status: 400 },
};

const REWRITE_STAMP =
  'Stream 2 REWRITE applied 2026-05-27: expected.dom.* → expected.http.* per reviewer target above. ' +
  'Layer 7 lenient loader + G18 (compileContract) now guard this contract structurally.';

function rewriteOne(id) {
  const p = path.join(GT_DIR, `${id}.yml`);
  const src = readFileSync(p, 'utf8');
  const doc = parseDocument(src);
  const target = REWRITES[id];

  // Replace expected.{dom,...} with expected.http only. Backend_state / url
  // /etc. would survive — but Group A contracts only carry dom today, so
  // we just overwrite the whole expected block to keep it tidy.
  doc.setIn(['expected'], { http: target });

  // Append rewrite stamp to review.notes (preserve existing target line).
  const oldNotes = doc.getIn(['review', 'notes']);
  const stampedNotes =
    typeof oldNotes === 'string' && oldNotes.length > 0
      ? `${oldNotes}\n\n${REWRITE_STAMP}`
      : REWRITE_STAMP;
  doc.setIn(['review', 'notes'], stampedNotes);

  const out = doc.toString({ lineWidth: 0 });
  writeFileSync(p, out, 'utf8');
  return p;
}

const written = [];
for (const id of Object.keys(REWRITES)) {
  const p = rewriteOne(id);
  written.push(p);
}

console.log(`Stream 2: rewrote ${written.length} contracts.`);
for (const p of written) console.log(`  ✓ ${p}`);

// Sanity check: parse each rewritten file as YAML to catch malformed output.
// (Schema validation against ContractSchema happens in the test suite —
// re-running `pnpm --filter @contractqa/core test` will catch real breakages.)
let bad = 0;
for (const p of written) {
  try {
    parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`  ✗ malformed YAML after rewrite: ${p}: ${e.message}`);
    bad++;
  }
}
if (bad > 0) {
  console.error(`Stream 2: ${bad} contracts failed YAML re-parse — investigate.`);
  process.exit(1);
}
