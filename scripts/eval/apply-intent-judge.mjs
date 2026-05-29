#!/usr/bin/env node
// Apply intent-judge decisions to qa/eval/poker/ground-truth/.
//
// Reads qa/eval/poker/run-log/intent-judge-decisions.txt. Each non-comment
// non-blank line is one decision in this format:
//
//   <id-or-cluster-key>\t<KEEP|DROP|MERGE:<canonical>>\t<optional note>
//
// CLUSTER:<key> prefix expands to all members of that borderline cluster
// (cluster keys are visible in the intent-judge report). Otherwise the
// first token is treated as a literal contract id.
//
// Effect: rewrite qa/eval/poker/ground-truth/<id>.yml with:
//   KEEP   → status=approved, validity=tp
//   DROP   → status=dropped,  validity=fp
//   MERGE  → status=merged,   duplicates_of=[<canonical>]
//
// Existing review.notes are appended to (not replaced) — the new note is
// prefixed with "intent-judge:".
//
// Dry-run by default. Pass --apply to actually write.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const DECISIONS = 'qa/eval/poker/run-log/intent-judge-decisions.txt';
const REPORT = 'qa/eval/poker/run-log/2026-05-25-intent-judge.md';
const APPLY = process.argv.includes('--apply');

if (!existsSync(DECISIONS)) {
  console.error(`Missing ${DECISIONS}.\nCreate it with one decision per line:`);
  console.error(`  <id-or-CLUSTER:key>\\t<KEEP|DROP|MERGE:canonical>\\t<note>`);
  process.exit(1);
}

// Parse decisions
const decisions = [];
for (const raw of readFileSync(DECISIONS, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [key, verdict, ...rest] = line.split('\t');
  if (!key || !verdict) { console.warn(`skip malformed: ${line}`); continue; }
  decisions.push({ key, verdict, note: rest.join('\t') });
}

// Resolve CLUSTER:<key> → set of ids by scraping the report (its borderline
// section already listed cluster members).
function expandClusters() {
  const report = readFileSync(REPORT, 'utf8');
  const clusters = new Map();
  const lines = report.split('\n');
  let activeKey = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#### Cluster \d+: `([^`]+)` — \d+ members/);
    if (m) { activeKey = m[1]; clusters.set(activeKey, []); continue; }
    if (activeKey && lines[i].startsWith('| ') && !lines[i].startsWith('| id ') && !lines[i].startsWith('|---')) {
      const id = lines[i].split('|')[1]?.trim();
      if (id && /^[a-zA-Z]/.test(id)) clusters.get(activeKey).push(id);
    }
    if (lines[i].startsWith('## ') && activeKey) activeKey = null;
  }
  return clusters;
}
const clusters = expandClusters();

const writes = [];
for (const d of decisions) {
  let ids = [];
  if (d.key.startsWith('CLUSTER:')) {
    const k = d.key.slice('CLUSTER:'.length);
    ids = clusters.get(k) ?? [];
    if (ids.length === 0) console.warn(`CLUSTER ${k} expanded to 0 ids`);
  } else {
    ids = [d.key];
  }
  for (const id of ids) writes.push({ id, verdict: d.verdict, note: d.note });
}

// Apply
let applied = 0, skipped = 0;
const log = [];
for (const w of writes) {
  // Find source contract (for fresh re-write base)
  let srcPath = null;
  for (const sub of ['agents', 'api', 'auth', 'core', '_smoke', 'dashboard', 'issues', 'simulate', 'tables']) {
    const cand = join(FIXTURE, sub, `${w.id}.yml`);
    if (existsSync(cand)) { srcPath = cand; break; }
  }
  if (!srcPath) { console.warn(`source missing: ${w.id}`); skipped++; continue; }

  const doc = parseYaml(readFileSync(srcPath, 'utf8'));
  const gtPath = join(GT_DIR, `${w.id}.yml`);
  const existing = existsSync(gtPath) ? parseYaml(readFileSync(gtPath, 'utf8')) : null;

  let status, validity, duplicates_of = [];
  if (w.verdict === 'KEEP') { status = 'approved'; validity = 'tp'; }
  else if (w.verdict === 'DROP') { status = 'dropped'; validity = 'fp'; }
  else if (w.verdict.startsWith('MERGE:')) {
    status = 'merged'; validity = 'tp';
    duplicates_of = [w.verdict.slice('MERGE:'.length)];
  } else { console.warn(`unknown verdict: ${w.verdict}`); skipped++; continue; }

  const oldNotes = existing?.review?.notes ?? '';
  const noteSep = oldNotes ? '\n' : '';
  const newNotes = `${oldNotes}${noteSep}intent-judge ${new Date().toISOString().slice(0,10)}: ${w.verdict}${w.note ? ' — ' + w.note : ''}`;

  const gt = {
    ...doc,
    category: existing?.category ?? ['unclassified'],
    provenance: {
      ...(existing?.provenance ?? {}),
      source: existing?.provenance?.source ?? 'autopilot',
      generated_at: existing?.provenance?.generated_at ?? new Date().toISOString(),
      reviewed_by: 'intent-judge',
      reviewed_at: new Date().toISOString(),
      status,
      duplicates_of,
    },
    review: {
      validity,
      validity_verified_in_product: existing?.review?.validity_verified_in_product ?? false,
      specificity: existing?.review?.specificity ?? (status === 'approved' ? 2 : 0),
      severity_original: doc.severity ?? 'P3',
      severity_final: existing?.review?.severity_final ?? doc.severity ?? 'P3',
      notes: newNotes,
    },
  };

  if (APPLY) writeFileSync(gtPath, toYaml(gt));
  applied++;
  log.push(`${APPLY ? 'WRITE' : 'DRY  '} ${w.verdict.padEnd(7)} ${w.id}`);
}

console.log(log.join('\n'));
console.log();
console.log(`${APPLY ? 'applied' : 'dry-run'}: ${applied} changes${skipped ? ` (${skipped} skipped)` : ''}`);
if (!APPLY) console.log(`\nRun with --apply to actually write.`);
