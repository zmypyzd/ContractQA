// exec-detection-batch.mjs — run exec-detection-score across a range of apps and
// aggregate a suite-level stage-attribution histogram + true-detection rate.
//
// Each app's exec-detection-score builds/tears down its own container, so this is
// a sequential loop (no shared port/OAuth-burst risk). Reads the per-app
// exec-detection.json each writes, plus the arm's summary.json for the coverage
// ("aim") number, to print coverage-aim vs execution-true-detection side by side.
//
// Usage: node scripts/eval/exec-detection-batch.mjs [--range 1-10] [--arm reflexion-on]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const SNAP = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench/snapshots';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[key] = val;
  }
  return a;
}
const pad4 = (n) => String(n).padStart(4, '0');

const args = parseArgs(process.argv);
const range = typeof args.range === 'string' ? args.range : '1-10';
const arm = typeof args.arm === 'string' ? args.arm : 'reflexion-on';
const [a, b] = range.split('-').map((s) => parseInt(s, 10));

const results = [];
for (let i = a; i <= b; i++) {
  const idx = pad4(i);
  console.log(`\n========== exec-detection ${idx} ==========`);
  const r = spawnSync('node', [path.join(ROOT, 'scripts/eval/exec-detection-score.mjs'), '--idx', idx, '--arm', arm], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, CONTRACTQA_LLM_MODEL: process.env.CONTRACTQA_LLM_MODEL || 'claude-haiku-4-5-20251001' },
  });
  const re = new RegExp(`^${idx}-\\d{4}-\\d\\d-\\d\\d-${arm}-docker$`);
  const matches = readdirSync(SNAP).filter((d) => re.test(d)).sort();
  const outPath = matches.length ? path.join(SNAP, matches[matches.length - 1], 'exec-detection.json') : path.join(SNAP, `${idx}-2026-05-29-${arm}-docker`, 'exec-detection.json');
  if (r.status === 0 && existsSync(outPath)) {
    results.push(JSON.parse(readFileSync(outPath, 'utf8')));
  } else {
    console.error(`[batch] ${idx} FAILED (exit ${r.status})`);
    results.push({ idx, failed: true });
  }
}

// aggregate
const ok = results.filter((r) => !r.failed);
const stageTotals = {};
let totBugs = 0, totAim = 0, totTrue = 0;
console.log('\n\n=== SUITE exec-detection vs coverage-aim ===');
console.log('app  | bugs | aim(covered) | TRUE detection | stages');
console.log('-----|------|--------------|----------------|------------------------------------');
for (const r of ok) {
  totBugs += r.total_bugs; totAim += r.coverage_detected; totTrue += r.execution_true_detection;
  for (const [k, v] of Object.entries(r.stage_breakdown || {})) stageTotals[k] = (stageTotals[k] || 0) + v;
  console.log(`${r.idx} | ${String(r.total_bugs).padStart(4)} | ${String(r.coverage_detected).padStart(12)} | ${String(r.execution_true_detection).padStart(14)} | ${JSON.stringify(r.stage_breakdown)}`);
}
console.log('-----|------|--------------|----------------|------------------------------------');
console.log(`TOT  | ${totBugs} bugs | aim ${totAim} (${(100 * totAim / totBugs).toFixed(1)}%) | TRUE ${totTrue} (${(100 * totTrue / totBugs).toFixed(1)}%)`);
console.log('\nstage histogram (all bugs):', JSON.stringify(stageTotals, null, 0));
console.log(`\napps ok: ${ok.length}/${results.length}`);
