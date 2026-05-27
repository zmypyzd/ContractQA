import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { ContractSchema } from '../../packages/core/dist/schemas/contract.schema.js';
import { compileContract } from '../../packages/runner/dist/compile.js';

const GT = 'qa/eval/poker/ground-truth';
const STREAM2 = [
  'api-agent-invites-register-invalid-token',
  'api-agent-invites-revoke-hash-not-found',
  'api-decision-trace-returns-404-for-missing-match',
  'api-decision-trace-strips-private-fields',
  'api-matches-decision-trace-returns-match-not-found',
  'api-matches-get-excludes-sensitive-fields',
  'api-matches-get-not-found-invalid-id',
  'api-matches-list-excludes-seed',
  'api-me-werewolf-agents-create-requires-csrf',
  'api-me-werewolf-agents-create-validates-body',
  'api-tables-add-agent-validates-adapter-type',
  'api-tables-get-hand-validates-hand-belongs-to-table',
  'api-tables-get-hand-validates-table-exists',
  'api-tables-hand-replay-requires-auth',
  'api-tables-watch-not-found-invalid-table',
  'api-werewolf-invite-npc-requires-csrf',
  'api-werewolf-match-get-strips-seed',
  'api-werewolf-matches-strips-seed',
  'delete-agent-requires-auth',
  'simulate-requires-csrf-token',
  'simulate-validates-request-schema',
];

let pass = 0, fail = 0;
for (const id of STREAM2) {
  const p = path.join(GT, `${id}.yml`);
  const raw = readFileSync(p, 'utf8');
  let parsed;
  try { parsed = parse(raw); } catch (e) { console.error(`YAML PARSE ${id}: ${e.message}`); fail++; continue; }
  // Strip review-only fields the schema doesn't know about (category, provenance, review)
  // so we test the contract surface, not the metadata bundle.
  const { category, provenance, review, ...contract } = parsed;
  let validated;
  try { validated = ContractSchema.parse(contract); }
  catch (e) { console.error(`SCHEMA ${id}:`, e.issues ?? e.message); fail++; continue; }
  // G18 smoke — compileContract throws if dom set with no nav action. We
  // pass baseUrl so the http action would resolve. The function returns a
  // thunk; we don't execute the thunk, just compile.
  try { compileContract(validated, { baseUrl: 'http://x' }); }
  catch (e) { console.error(`G18 ${id}: ${e.message}`); fail++; continue; }
  pass++;
}
console.log(`Stream 2 validation: ${pass}/${STREAM2.length} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
