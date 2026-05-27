#!/usr/bin/env node
// Validate every contract touched by Stream 3 REPLACE + Stream 4 STRENGTHEN
// parses through ContractSchema (Stream 5 strict mode) and survives
// compileContract (G18 guard).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { ContractSchema } from '../../packages/core/dist/schemas/contract.schema.js';
import { compileContract } from '../../packages/runner/dist/compile.js';

const GT = 'qa/eval/poker/ground-truth';

const STREAM3_REPLACES = [
  'all-in-button-disabled-while-submitting',
  'audience-reactions-start-at-zero',
  'check-action-button-disabled-while-submitting',
  'lobby-seed-input-accepts-optional-value',
  'raise-slider-shows-validation-error',
  'replay-hand-select-button-updates-view',
  'replay-next-button-advances-timeline',
  'replay-street-filter-resets-on-hand-change',
  'werewolf-lobby-recent-tab-filters-completed-games',
  'werewolf-lobby-tab-featured-active-state',
  'werewolf-lobby-tab-live-filters-games',
].map((id) => `${id}-REPLACE`);

const STREAM4_STRENGTHENED = [
  'audience-strip-shows-watching-count',
  'agent-name-persists-on-edit-load',
  'appshell-invite-button-close-toggle',
  'audience-react-heart-independent-counts',
  'audience-wolf-reaction-initial-zero',
  'check-action-button-visible-when-legal',
  'confirm-dialog-cancel-closes-dialog',
  'table-preset-amount-sets-bet-value',
  'werewolf-room-wrapped-in-app-shell',
];

const ALL = [...STREAM3_REPLACES, ...STREAM4_STRENGTHENED];

let pass = 0;
let fail = 0;
for (const id of ALL) {
  const p = path.join(GT, `${id}.yml`);
  let parsed;
  try {
    parsed = parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`YAML PARSE ${id}: ${e.message}`);
    fail++;
    continue;
  }
  const { category, provenance, review, ...contract } = parsed;
  let validated;
  try {
    validated = ContractSchema.parse(contract);
  } catch (e) {
    console.error(`SCHEMA ${id}:`, e.issues ?? e.message);
    fail++;
    continue;
  }
  try {
    compileContract(validated, { baseUrl: 'http://x' });
  } catch (e) {
    console.error(`G18 ${id}: ${e.message}`);
    fail++;
    continue;
  }
  pass++;
}
console.log(`Stream 3+4 validation: ${pass}/${ALL.length} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
