#!/usr/bin/env node
// Interactive walker for Finding 3 step-2 review on the poker fixture.
//
// Walks the contracts that aren't yet materialized into qa/eval/poker/ground-truth/,
// in this order: strong-PASS → weak-PASS → FAIL → schema-skip. For each, prints
// id/title/area/severity/run-status/expected/action/notes plus the per-test
// error-context.md tail if FAIL — then prompts:
//
//   a / <enter>  approve  (writes status=approved + verified_in_product=false;
//                          you flip verified=true after eyeballing the product)
//   d            drop     (writes status=dropped, validity=fp)
//   m <id>       merge    (writes status=merged, duplicates_of=[<id>])
//   s            skip     (leave for next pass)
//   v            view     (print the full YAML)
//   o            open URL hint (prints the goto path or http endpoint for you to inspect)
//   q            quit     (saves progress; resumable — already-written GT files are
//                          skipped on next run)
//
// Resumable: re-runs skip anything that already has a qa/eval/poker/ground-truth/<id>.yml.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const RUN_LOG = process.env.CONTRACTQA_RUN_LOG || '/tmp/run-2026-05-25-v4-with-oracle.log';
const TEST_RESULTS = '/Users/zmy/intership/5.10+/qa-agent/test-results';
const REVIEWER = process.env.REVIEWER || 'marchettireeva';
const BASE_URL = process.env.CONTRACTQA_BASE_URL || 'http://127.0.0.1:5273';

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

function weakFlags(doc) {
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

function loadRunLog() {
  const log = readFileSync(RUN_LOG, 'utf8');
  const passed = new Set();
  const failed = new Set();
  for (const m of log.matchAll(/^\s+✓\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) passed.add(m[1]);
  for (const m of log.matchAll(/^\s+✘\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) failed.add(m[1]);
  const skip = new Map();
  for (const m of log.matchAll(/loader: skipping (\S+\.yml): schema validation failed \(\d+ issues?; first: "([^"]+)"/g)) {
    if (!skip.has(m[1])) skip.set(m[1], m[2].slice(0, 120));
  }
  return { passed, failed, skip };
}

function findErrorContext(id) {
  if (!existsSync(TEST_RESULTS)) return null;
  // Playwright test-results dir naming: qa-runner-<prefix>-<hash>-<suffix>/
  // The id appears as a substring inside, sliced at 25 chars then hash then 25 chars.
  // Brute force: scan all dirs and find one whose error-context.md mentions the id.
  for (const d of readdirSync(TEST_RESULTS)) {
    const p = join(TEST_RESULTS, d, 'error-context.md');
    if (existsSync(p)) {
      const c = readFileSync(p, 'utf8');
      if (c.includes(`>> ${id}:`)) return c;
    }
  }
  return null;
}

function bucket(doc, run, flags) {
  if (run === 'skip') return 'schema-skip';
  if (run === 'FAIL') return 'fail';
  if (run === 'PASS' && flags.length > 0) return 'weak-pass';
  if (run === 'PASS') return 'strong-pass';
  return 'other';
}

const RUN = loadRunLog();
const all = walk(FIXTURE).map((f) => {
  try {
    const doc = parseYaml(readFileSync(f, 'utf8'));
    if (!doc?.id) return null;
    let run = 'other';
    if (RUN.skip.has(f)) run = 'skip';
    else if (RUN.passed.has(doc.id)) run = 'PASS';
    else if (RUN.failed.has(doc.id)) run = 'FAIL';
    const flags = weakFlags(doc);
    return { f, doc, run, flags, bucket: bucket(doc, run, flags), skipReason: RUN.skip.get(f) ?? '' };
  } catch { return null; }
}).filter(Boolean);

// Filter out anything already in ground-truth
const remaining = all.filter((x) => !existsSync(join(GT_DIR, `${x.doc.id}.yml`)));

// Order: strong-pass → weak-pass → fail → schema-skip; within bucket by area then id
const ORDER = { 'strong-pass': 0, 'weak-pass': 1, 'fail': 2, 'schema-skip': 3, 'other': 4 };
remaining.sort((a, b) => {
  if (ORDER[a.bucket] !== ORDER[b.bucket]) return ORDER[a.bucket] - ORDER[b.bucket];
  if (a.doc.area !== b.doc.area) return a.doc.area.localeCompare(b.doc.area);
  return a.doc.id.localeCompare(b.doc.id);
});

const counts = remaining.reduce((m, x) => (m[x.bucket] = (m[x.bucket] || 0) + 1, m), {});
console.log(`\n=== walk-review ===\n  remaining: ${remaining.length} (strong=${counts['strong-pass']||0}  weak=${counts['weak-pass']||0}  fail=${counts['fail']||0}  schema-skip=${counts['schema-skip']||0})\n  ground-truth dir: ${GT_DIR}\n  reviewer: ${REVIEWER}\n  run log: ${RUN_LOG}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise((res) => rl.question(q, (a) => res(a.trim()))); }

function summarize(x) {
  const lines = [];
  lines.push('');
  lines.push('───────────────────────────────────────────────');
  lines.push(`[${x.bucket}]  ${x.doc.area}/${x.doc.id}  (sev=${x.doc.severity})`);
  lines.push(`  ${x.doc.title}`);
  lines.push(`  preconditions: ${JSON.stringify(x.doc.preconditions ?? {})}`);
  lines.push(`  actions: ${JSON.stringify(x.doc.actions).slice(0, 200)}`);
  lines.push(`  expected: ${JSON.stringify(x.doc.expected).slice(0, 200)}`);
  if (x.flags.length) lines.push(`  weak flags: ${x.flags.join(', ')}`);
  if (x.bucket === 'schema-skip') lines.push(`  schema: ${x.skipReason}`);
  if (x.bucket === 'fail') {
    const err = findErrorContext(x.doc.id);
    if (err) {
      const m = err.match(/```\n([\s\S]+?)\n```/);
      if (m) lines.push(`  error: ${m[1].slice(0, 200).replace(/\n/g, ' | ')}`);
    }
  }
  // URL hint for inspection
  const gotos = (x.doc.actions ?? []).filter((a) => a.type === 'goto').map((a) => a.path);
  const https = (x.doc.actions ?? []).filter((a) => a.type === 'http').map((a) => `${a.method} ${a.path}`);
  if (gotos.length) lines.push(`  inspect: ${gotos.map((p) => `${BASE_URL}${p}`).join('  ')}`);
  if (https.length) lines.push(`  http: ${https.join('; ')}`);
  return lines.join('\n');
}

function ensureCategory(doc) {
  // Heuristic: area + dom assertion → infer category. Reviewer can adjust later.
  const c = [];
  const exp = doc?.expected ?? {};
  if (exp.auth_state || (doc.preconditions?.auth_state === 'logged_in')) c.push('auth-boundary');
  if (exp.url?.matches) c.push('happy-path');
  if (exp.dom?.contains_text?.some?.((t) => /error|fail|unauth|forbid|not found|404|500|invalid/i.test(t))) c.push('error-state');
  if (c.length === 0) c.push('happy-path');
  return c;
}

function write(doc, status, opts) {
  const now = new Date().toISOString();
  const gt = {
    ...doc,
    category: ensureCategory(doc),
    provenance: {
      source: 'autopilot',
      generated_at: now,
      reviewed_by: REVIEWER,
      reviewed_at: now,
      status,
      duplicates_of: opts.duplicatesOf ?? [],
    },
    review: {
      validity: opts.validity ?? (status === 'dropped' ? 'fp' : 'tp'),
      validity_verified_in_product: false,
      specificity: opts.specificity ?? (status === 'approved' ? 2 : 1),
      severity_original: doc.severity ?? 'P3',
      severity_final: doc.severity ?? 'P3',
      notes: opts.notes ?? '',
    },
  };
  writeFileSync(join(GT_DIR, `${doc.id}.yml`), toYaml(gt));
}

let touched = 0;
for (const x of remaining) {
  console.log(summarize(x));
  while (true) {
    const ans = (await ask('  → a(approve) | d(rop) | m <id> | s(kip) | v(iew) | o(pen) | q(uit) > ')).toLowerCase();
    if (!ans || ans === 'a') {
      write(x.doc, 'approved', { specificity: 2, notes: `Reviewed via walk-review on ${new Date().toISOString().slice(0,10)}. Bucket=${x.bucket}. PENDING verified_in_product flip after product inspection.` });
      touched++; break;
    }
    if (ans === 'd') {
      const why = await ask('    drop reason (one line, blank ok): ');
      write(x.doc, 'dropped', { validity: 'fp', specificity: 0, notes: why || `Bucket=${x.bucket}.` });
      touched++; break;
    }
    if (ans.startsWith('m')) {
      const dupId = ans.slice(1).trim() || (await ask('    duplicate of <id>: '));
      if (!dupId) { console.log('    need an id, retry'); continue; }
      write(x.doc, 'merged', { duplicatesOf: [dupId], specificity: 1, notes: `Merged into ${dupId} via walk-review.` });
      touched++; break;
    }
    if (ans === 's') break;
    if (ans === 'v') { console.log(readFileSync(x.f, 'utf8')); continue; }
    if (ans === 'o') {
      const gotos = (x.doc.actions ?? []).filter((a) => a.type === 'goto').map((a) => `${BASE_URL}${a.path}`);
      const https = (x.doc.actions ?? []).filter((a) => a.type === 'http').map((a) => `curl -i -H 'x-requested-with: fetch' -X ${a.method} ${BASE_URL}${a.path}${a.body ? ` -d '${JSON.stringify(a.body)}'` : ''}`);
      console.log('    ' + [...gotos, ...https].join('\n    '));
      continue;
    }
    if (ans === 'q') { console.log(`\nsaved ${touched} decisions; ${remaining.length - touched - (remaining.indexOf(x))} unreviewed remain.\n`); rl.close(); process.exit(0); }
    console.log('    unknown — a/d/m/s/v/o/q');
  }
}
console.log(`\ndone — wrote ${touched} ground-truth files. all ${remaining.length} reviewed.\n`);
rl.close();
