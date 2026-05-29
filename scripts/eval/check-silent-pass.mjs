// Detect silent-pass contracts — contracts that "pass" trivially because
// the runner never evaluates a real assertion. Two failure modes:
//   1. expected.<key> uses a key that isn't in the ContractSchema → silently
//      dropped (ExpectedBlock is non-strict).
//   2. expected.dom.* asserted on a contract whose only action is `type: http`
//      → no page navigation, DOM is the previous page (about:blank when
//      no prior goto), so `contains_text` checks an empty document.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const DIR = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const RUN_LOG = process.env.CONTRACTQA_RUN_LOG || '/tmp/run-2026-05-25-v3-with-auth.log';

// Authoritative from packages/core/src/schemas/contract.schema.ts (ExpectedBlock).
const SCHEMA = {
  url: ['matches'],
  localStorage: ['no_key_matches', 'has_key_matches'],
  sessionStorage: ['no_key_matches'],
  cookies: ['no_name_matches'],
  dom: ['not_contains_any', 'contains_all', 'contains_text', 'not_contains_text', 'role_count'],
  auth_state: ['fully_logged_out'],
  backend_state: ['named_query', 'params', 'assert'],
  watch_keys: ['localStorage', 'cookies'],
};

function walk(root) {
  const out = [];
  (function rec(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) out.push(p);
    }
  })(root);
  return out;
}

const log = readFileSync(RUN_LOG, 'utf8');
const passed = new Set();
for (const m of log.matchAll(/^\s+✓\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) passed.add(m[1]);

const issues = [];
let totalPass = 0;
let cleanPass = 0;

for (const f of walk(DIR)) {
  let doc;
  try { doc = parseYaml(readFileSync(f, 'utf8')); } catch { continue; }
  if (!doc || !passed.has(doc.id)) continue;
  totalPass++;

  const flags = [];
  const exp = doc.expected ?? {};

  // (1) top-level + nested key recognition
  const topRecognized = Object.keys(exp).filter((k) => SCHEMA[k]);
  const topIgnored = Object.keys(exp).filter((k) => !SCHEMA[k]);
  if (topIgnored.length > 0) flags.push(`unknown-top:${topIgnored.join(',')}`);

  const meaningfulNested = [];
  for (const k of topRecognized) {
    const v = exp[k];
    if (typeof v !== 'object' || v === null) continue;
    const allowed = SCHEMA[k];
    const subKeys = Object.keys(v);
    const recognized = subKeys.filter((s) => allowed.includes(s));
    const ignored = subKeys.filter((s) => !allowed.includes(s));
    if (ignored.length > 0) flags.push(`unknown-${k}:${ignored.join(',')}`);
    if (recognized.length > 0) meaningfulNested.push(k);
  }

  // (2) dom-after-http: no goto, only http action, expected has dom assertion
  const actions = doc.actions ?? [];
  const hasGoto = actions.some((a) => a.type === 'goto');
  const hasHttp = actions.some((a) => a.type === 'http');
  const usesDom = topRecognized.includes('dom');
  if (usesDom && !hasGoto && hasHttp) flags.push('dom-after-http');

  if (meaningfulNested.length === 0 || flags.includes('dom-after-http')) {
    issues.push({ id: doc.id, area: doc.area, flags, file: f.split('/contracts/')[1] });
  } else {
    cleanPass++;
  }
}

console.log(`PASS contracts examined: ${totalPass}`);
console.log(`  - clean (at least one meaningful nested expected assertion): ${cleanPass}`);
console.log(`  - flagged (silent or weak): ${issues.length}`);
console.log();

const histF = new Map();
for (const i of issues) for (const f of i.flags) histF.set(f, (histF.get(f) || 0) + 1);
console.log('Flag histogram:');
for (const [k, n] of [...histF.entries()].sort((a,b) => b[1]-a[1])) console.log(`  ${n}\t${k}`);

console.log();
console.log('Flagged PASS by area:');
const byArea = new Map();
for (const i of issues) byArea.set(i.area, (byArea.get(i.area) || 0) + 1);
for (const [a, n] of [...byArea.entries()].sort((x,y) => y[1]-x[1])) console.log(`  ${n}\t${a}`);

console.log();
console.log('First 15 flagged:');
for (const i of issues.slice(0, 15)) console.log(`  - ${i.id}  [${i.flags.join('; ')}]`);
