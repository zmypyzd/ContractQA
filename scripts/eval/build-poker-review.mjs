#!/usr/bin/env node
// Build the step-2 review table for the poker fixture's autopilot output.
// Joins: scratch/qa/contracts/**/*.yml + run log (PASS/FAIL) + schema-skip log
// → qa/eval/poker/run-log/<date>-step2-review.md

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FIXTURE_CONTRACTS = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const RUN_LOG = process.env.CONTRACTQA_RUN_LOG || '/tmp/run-2026-05-25-v3-with-auth.log';
const OUT = process.env.CONTRACTQA_REVIEW_OUT || 'qa/eval/poker/run-log/2026-05-25-step2-review-v3.md';

function walkYaml(root) {
  const out = [];
  (function rec(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) out.push(p);
    }
  })(root);
  return out;
}

const log = readFileSync(RUN_LOG, 'utf8');

const passed = new Set();
const failed = new Set();
for (const m of log.matchAll(/^\s+✓\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) passed.add(m[1]);
for (const m of log.matchAll(/^\s+✘\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) failed.add(m[1]);

// Schema-recognized expected sub-keys (verified vs contract.schema.ts ExpectedBlock).
const SCHEMA_KEYS = {
  url: ['matches'],
  localStorage: ['no_key_matches', 'has_key_matches'],
  sessionStorage: ['no_key_matches'],
  cookies: ['no_name_matches'],
  dom: ['not_contains_any', 'contains_all', 'contains_text', 'not_contains_text', 'role_count'],
  auth_state: ['fully_logged_out'],
  backend_state: ['named_query', 'params', 'assert'],
  watch_keys: ['localStorage', 'cookies'],
};
function weakPassFlags(doc) {
  const flags = [];
  const exp = doc?.expected ?? {};
  for (const k of Object.keys(exp)) {
    const allowed = SCHEMA_KEYS[k];
    if (!allowed) { flags.push(`unknown:${k}`); continue; }
    if (typeof exp[k] === 'object' && exp[k] !== null) {
      for (const sk of Object.keys(exp[k])) if (!allowed.includes(sk)) flags.push(`unknown:${k}.${sk}`);
    }
  }
  const actions = doc?.actions ?? [];
  const hasGoto = actions.some((a) => a.type === 'goto');
  const hasHttp = actions.some((a) => a.type === 'http');
  if (exp?.dom && !hasGoto && hasHttp) flags.push('dom-after-http');
  return flags;
}

// schema-skip: path → first-issue reason
const skipReason = new Map();
for (const m of log.matchAll(/loader: skipping (\S+\.yml): schema validation failed \(\d+ issues?; first: "([^"]+)"(.*?)\)/g)) {
  if (!skipReason.has(m[1])) skipReason.set(m[1], m[2].slice(0, 80));
}

const files = walkYaml(FIXTURE_CONTRACTS).sort();
const rows = [];
for (const f of files) {
  let id = '', title = '', area = '', severity = '', auth = '', doc = {};
  try {
    doc = parseYaml(readFileSync(f, 'utf8')) ?? {};
    id = doc.id ?? '';
    title = (doc.title ?? '').replace(/\|/g, '\\|');
    area = doc.area ?? f.split('/contracts/')[1].split('/')[0];
    severity = doc.severity ?? '';
    auth = doc.preconditions?.auth_state ?? '';
  } catch (e) { /* malformed yaml; let loader-skip flag it */ }
  const loaded = !skipReason.has(f);
  let run = passed.has(id) ? 'PASS' : failed.has(id) ? 'FAIL' : (loaded ? '—' : 'skip');
  const flags = run === 'PASS' ? weakPassFlags(doc) : [];
  if (run === 'PASS' && flags.length > 0) run = 'PASS?';
  const note = loaded ? (flags.length ? `weak: ${flags.join(',')}` : '') : ('schema: ' + skipReason.get(f));
  rows.push({ id, title, area, severity, auth, loaded, run, note, file: f });
}

// cluster by normalized title stem (first 4 significant words)
function stem(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the','for','and','with','from','that','this','when','have','should','must'].includes(w)).slice(0, 4).join('-');
}
const clusters = new Map();
for (const r of rows) {
  const k = stem(r.title) + '|' + r.area;
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(r);
}
const clusterOf = new Map();
let cid = 0;
for (const [k, members] of clusters) {
  if (members.length >= 2) {
    cid++;
    const tag = `C${cid}`;
    for (const m of members) clusterOf.set(m.id, tag);
  }
}

const totalLoaded = rows.filter(r => r.loaded).length;
const totalPass = rows.filter(r => r.run === 'PASS' || r.run === 'PASS?').length;
const totalFail = rows.filter(r => r.run === 'FAIL').length;
const totalSkip = rows.filter(r => !r.loaded).length;

const skipBuckets = new Map();
for (const r of rows.filter(x => !x.loaded)) skipBuckets.set(r.note, (skipBuckets.get(r.note) || 0) + 1);
const skipTopList = [...skipBuckets.entries()].sort((a,b) => b[1]-a[1]).slice(0, 6);

const failByArea = new Map();
const passByArea = new Map();
for (const r of rows) {
  if (r.run === 'FAIL') failByArea.set(r.area, (failByArea.get(r.area) || 0) + 1);
  if (r.run === 'PASS' || r.run === 'PASS?') passByArea.set(r.area, (passByArea.get(r.area) || 0) + 1);
}

const out = [];
out.push(`# Step 2 review log — poker (5-4-claude fixture) — 2026-05-25`);
out.push('');
out.push(`Reviewer: <fill in>`);
out.push(`Source: \`/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts/\``);
out.push(`Autopilot baseline: \`AUTOPILOT_REPORT.json\` (phase B + 4 smoke patterns)`);
out.push(`Run log: \`${RUN_LOG}\` (${totalLoaded} loaded, ${totalSkip} schema-skipped, ${totalPass} passed, ${totalFail} failed)`);
out.push('');
out.push(`> **Process** — for each row, open the contract YAML + the product, fill \`decision\` (\`approved\`/\`dropped\`/\`merged\`) and \`duplicates_of\`. Materialize approved/dropped/merged into \`qa/eval/poker/ground-truth/<id>.yml\` per \`qa/eval/schema.md\`. Don't silently delete dropped/merged — they're evidence for fp_rate and dedup_inflation.`);
out.push('');
out.push(`## Headline numbers`);
out.push('');
const N = rows.length;
out.push(`| Bucket | Count | % of ${N} |`);
out.push(`|---|---|---|`);
out.push(`| Loaded (schema valid) | ${totalLoaded} | ${(totalLoaded/N*100).toFixed(1)}% |`);
out.push(`| Schema-skipped | ${totalSkip} | ${(totalSkip/N*100).toFixed(1)}% |`);
const strongPass = rows.filter((r) => r.run === 'PASS').length;
const weakPass = rows.filter((r) => r.run === 'PASS?').length;
out.push(`| Run: **PASS (strong)** | ${strongPass} | ${(strongPass/N*100).toFixed(1)}% |`);
out.push(`| Run: PASS? (weak — silent / wrong-page) | ${weakPass} | ${(weakPass/N*100).toFixed(1)}% |`);
out.push(`| Run: FAIL | ${totalFail} | ${(totalFail/N*100).toFixed(1)}% |`);
out.push('');
out.push(`## Schema-skip reasons (top 6)`);
out.push('');
out.push(`| Count | First-issue (truncated to 80 chars) |`);
out.push(`|---|---|`);
for (const [reason, n] of skipTopList) out.push(`| ${n} | ${reason || '(parse error)'} |`);
out.push('');
out.push(`These rows are unrunnable as-is. **decision** for them defaults to \`dropped\` unless reviewer judges the *intent* is correct and the autopilot just emitted a malformed shape; in that case \`approved\` is fine but include a note ("schema bug, intent valid").`);
out.push('');
out.push(`## Run failures by area (${totalFail})`);
out.push('');
out.push(`| Area | Failed |`);
out.push(`|---|---|`);
for (const [a, n] of [...failByArea.entries()].sort((x,y) => y[1]-x[1])) out.push(`| ${a} | ${n} |`);
out.push('');
out.push(`Failures now break down into two real signal classes (with the runner bug + auth gap closed): **(a)** locator timeout — element doesn't exist on the page the contract navigated to (agent hallucinated UI, OR contract needs more state than a fresh logged-in user has, e.g. existing tables/matches); **(b)** strict-mode multi-match — agent's \`name_regex\` matches several elements, contract needs \`first: true\` or \`within:\` scope. Reviewer should mark \`dropped\` when the feature truly doesn't exist, \`approved\` when the intent is real but selector/state needs sharpening.`);
out.push('');
out.push(`## Run passes by area (${totalPass})`);
out.push('');
out.push(`| Area | Passed |`);
out.push(`|---|---|`);
for (const [a, n] of [...passByArea.entries()].sort((x,y) => y[1]-x[1])) out.push(`| ${a} | ${n} |`);
out.push('');
out.push(`PASSes are the most reliable signal — runner exercised the contract and the SUT matched expectations. Suggested review order: PASS rows first (fastest \`verified_in_product\` confirmation), then FAIL+intent-valid, then schema-skipped.`);
out.push('');
out.push(`## Decision table (${rows.length} rows)`);
out.push('');
out.push(`Fill \`decision\` ∈ {\`approved\`, \`dropped\`, \`merged\`}, \`duplicates_of\` if merged, \`verified_in_product\` (\`y\`/\`n\`) — required \`y\` for \`approved\`.`);
out.push('');
out.push(`Cluster column **C<N>** flags candidate duplicate groups (auto-clustered by title-stem + area). Verify before merging — close titles can hide different selectors / states.`);
out.push('');
out.push(`| # | area | id | title | sev | auth | load | run | cluster | decision | duplicates_of | verified | notes |`);
out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
rows.sort((a, b) => {
  if (a.area !== b.area) return a.area.localeCompare(b.area);
  return (a.id || '').localeCompare(b.id || '');
});
let i = 0;
for (const r of rows) {
  i++;
  const cluster = clusterOf.get(r.id) || '';
  out.push(`| ${i} | ${r.area} | ${r.id} | ${r.title} | ${r.severity} | ${r.auth} | ${r.loaded ? 'y' : 'n'} | ${r.run} | ${cluster} | | | | ${r.note} |`);
}
out.push('');
out.push(`## After review`);
out.push('');
out.push('```bash');
out.push(`# Materialize ground-truth (per qa/eval/schema.md):`);
out.push(`# for each non-blank row, write qa/eval/poker/ground-truth/<id>.yml`);
out.push(`# with original YAML body + eval-only fields (provenance, review, category)`);
out.push('');
out.push(`# Then score:`);
out.push(`node scripts/eval/score.mjs --project poker \\`);
out.push(`  --autopilot-dir /Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts \\`);
out.push(`  --out qa/eval/poker/score-2026-05-25.json`);
out.push('```');

writeFileSync(OUT, out.join('\n') + '\n');
console.log(`wrote ${OUT}: ${rows.length} rows, ${cid} multi-member clusters`);
