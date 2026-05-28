#!/usr/bin/env node
// Batch-run the WebTestBench fixture across a range of apps.
//
// Per app, serially:
//   1. teardown (best-effort, ignores empty port)
//   2. reset <NNNN>           (re-extract from zip)
//   3. launch <NNNN>          (lazy npm install + vite on :8080)
//   4. contractqa autopilot   (deep mode default — see CLI bin)
//   5. webtestbench-score     (LLM judge coverage)
//   6. snapshot scratch/<NNNN>/qa → snapshots/<NNNN>-<batch-date>/
//   7. teardown
//
// Strictly serial — port 8080 is single-use. Aggregates per-app scores
// into snapshots/batch-<date>/summary.json so the user can read one file.
//
// ⚠ BLIND ONLY — never pass --checklist or otherwise leak GT to autopilot.
// (memory: webtestbench-blind-only.md)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE_ROOT = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench';
const QA_AGENT_ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const TIME_BUDGET_MS = 1800000; // 30 min per app

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

function pad4(n) {
  return String(n).padStart(4, '0');
}

// Async exec that streams stdout/stderr to a log file but also captures
// exit code. Lets us inspect failure mode without blocking the parent.
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d.toString();
      if (opts.tee) process.stderr.write(`    [stdout] ${d.toString().trim().split('\n').slice(-1)[0]}\n`);
    });
    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    p.on('exit', (code) => {
      const ms = Date.now() - start;
      if (opts.logFile) {
        writeFileSync(opts.logFile, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n--- exit=${code} duration=${ms}ms ---\n`);
      }
      resolve({ code, stdout, stderr, ms });
    });
    p.on('error', (err) => reject(err));
    const start = Date.now();
  });
}

async function runApp(idx, batchDir, opts) {
  const log = (msg) => process.stderr.write(`[${idx}] ${msg}\n`);
  const appLogDir = path.join(batchDir, `${idx}-logs`);
  mkdirSync(appLogDir, { recursive: true });

  // 1. teardown
  log('teardown');
  await run(path.join(FIXTURE_ROOT, 'runner/teardown.sh'), [], {
    logFile: path.join(appLogDir, '1-teardown.log'),
  });

  // 2. reset (auto-confirm any prompt by piping 'n' — reset prompts when
  //    scratch has un-snapshotted qa output; in batch mode we snapshot AT
  //    THE END of each iteration so the prompt should never fire, but be
  //    safe).
  log('reset');
  const resetRes = await run('bash', ['-c', `printf 'y\\n' | "${path.join(FIXTURE_ROOT, 'runner/reset.sh')}" ${idx}`], {
    logFile: path.join(appLogDir, '2-reset.log'),
  });
  if (resetRes.code !== 0) {
    log(`reset FAILED exit=${resetRes.code} — skipping app`);
    return { idx, ok: false, stage: 'reset', error: resetRes.stderr.slice(0, 200) };
  }

  // 3. launch
  log('launch (npm install lazy + vite)');
  const launchRes = await run(path.join(FIXTURE_ROOT, 'runner/launch.sh'), [idx], {
    logFile: path.join(appLogDir, '3-launch.log'),
  });
  if (launchRes.code !== 0) {
    log(`launch FAILED exit=${launchRes.code} — skipping app`);
    return { idx, ok: false, stage: 'launch', error: launchRes.stderr.slice(0, 200) };
  }

  // 4. autopilot (deep mode is the new CLI default — DO NOT pass
  //    --discovery-mode modules; user explicitly required deep for webtb)
  log(`autopilot (deep, ${TIME_BUDGET_MS / 60000}min budget)`);
  const apRes = await run('contractqa', [
    'autopilot',
    '--no-fix', '--yes',
    '--time-budget', String(TIME_BUDGET_MS),
  ], {
    cwd: path.join(FIXTURE_ROOT, 'scratch', idx),
    env: { CONTRACTQA_BASE_URL: 'http://127.0.0.1:8080' },
    logFile: path.join(appLogDir, '4-autopilot.log'),
  });
  if (apRes.code !== 0) {
    log(`autopilot FAILED exit=${apRes.code}, will still try to score what exists`);
  }

  // 5. score (limit param respected if set; otherwise full checklist)
  log('score (LLM judge)');
  const scoreArgs = ['scripts/eval/webtestbench-score.mjs', '--idx', idx];
  if (opts.scoreLimit) scoreArgs.push('--limit', String(opts.scoreLimit));
  const scoreRes = await run('node', scoreArgs, {
    cwd: QA_AGENT_ROOT,
    logFile: path.join(appLogDir, '5-score.log'),
  });

  // 6. snapshot
  log('snapshot');
  const snapDir = path.join(FIXTURE_ROOT, 'snapshots', `${idx}-${opts.batchDate}-batch`);
  mkdirSync(snapDir, { recursive: true });
  try {
    cpSync(path.join(FIXTURE_ROOT, 'scratch', idx, 'qa'), path.join(snapDir, 'qa'), { recursive: true });
    if (existsSync(path.join(FIXTURE_ROOT, 'scratch', idx, 'score.json'))) {
      cpSync(path.join(FIXTURE_ROOT, 'scratch', idx, 'score.json'), path.join(snapDir, 'score.json'));
    }
  } catch (err) {
    log(`snapshot FAILED: ${err.message}`);
  }

  // 7. teardown
  log('teardown');
  await run(path.join(FIXTURE_ROOT, 'runner/teardown.sh'), [], {
    logFile: path.join(appLogDir, '7-teardown.log'),
  });

  // Read score
  let score = null;
  try {
    score = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'scratch', idx, 'score.json'), 'utf8'));
  } catch {
    /* nothing */
  }

  const summary = {
    idx,
    ok: scoreRes.code === 0 && score !== null,
    autopilot_exit: apRes.code,
    score_exit: scoreRes.code,
    autopilot_ms: apRes.ms,
    score_ms: scoreRes.ms,
    contracts: score?.counts?.agent_output ?? null,
    checklist_total: score?.counts?.checklist_total ?? null,
    covered: score?.counts?.covered ?? null,
    coverage_overall: score?.metrics?.coverage_overall ?? null,
    bug_detection_coverage: score?.metrics?.bug_detection_coverage ?? null,
    total_bugs: score?.counts?.total_pass_false ?? null,
    bugs_covered: score?.counts?.covered_pass_false ?? null,
  };
  log(
    `done coverage=${summary.coverage_overall !== null ? (summary.coverage_overall * 100).toFixed(1) + '%' : 'n/a'} bugs=${summary.bugs_covered}/${summary.total_bugs}`,
  );
  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  const range = args.range;
  if (!range || !/^\d{1,4}-\d{1,4}$/.test(range)) {
    console.error('usage: batch-webtestbench.mjs --range <a>-<b> [--score-limit N]');
    console.error('  e.g. --range 1-10  (runs WebTestBench_0001 through WebTestBench_0010)');
    process.exit(1);
  }
  const [a, b] = range.split('-').map((s) => parseInt(s, 10));
  if (b < a) {
    console.error('error: range end must be >= start');
    process.exit(1);
  }
  const scoreLimit = args['score-limit'] ? parseInt(args['score-limit'], 10) : null;
  const batchDate = new Date().toISOString().slice(0, 10);
  const batchDir = path.join(FIXTURE_ROOT, 'snapshots', `batch-${batchDate}`);
  mkdirSync(batchDir, { recursive: true });

  const summary = {
    batch: batchDate,
    range: { start: a, end: b },
    started_at: new Date().toISOString(),
    discovery_mode: 'deep',
    score_limit: scoreLimit,
    apps: [],
  };
  const summaryPath = path.join(batchDir, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  for (let i = a; i <= b; i++) {
    const idx = pad4(i);
    process.stderr.write(`\n========== app ${idx} (${i - a + 1}/${b - a + 1}) ==========\n`);
    const result = await runApp(idx, batchDir, { batchDate, scoreLimit });
    summary.apps.push(result);
    // Persist after each app so a crash doesn't lose progress.
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  }

  summary.finished_at = new Date().toISOString();
  // Aggregate metrics
  const completed = summary.apps.filter((a) => a.ok);
  const coverages = completed.map((a) => a.coverage_overall).filter((v) => v !== null);
  const bugCoverages = completed.map((a) => a.bug_detection_coverage).filter((v) => v !== null);
  summary.aggregate = {
    completed: completed.length,
    failed: summary.apps.length - completed.length,
    total_contracts: completed.reduce((s, a) => s + (a.contracts ?? 0), 0),
    total_bugs: completed.reduce((s, a) => s + (a.total_bugs ?? 0), 0),
    total_bugs_covered: completed.reduce((s, a) => s + (a.bugs_covered ?? 0), 0),
    mean_coverage: coverages.length ? coverages.reduce((s, v) => s + v, 0) / coverages.length : null,
    mean_bug_detection: bugCoverages.length ? bugCoverages.reduce((s, v) => s + v, 0) / bugCoverages.length : null,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  process.stderr.write(`\n========== batch complete ==========\n`);
  process.stderr.write(`summary: ${summaryPath}\n`);
  process.stderr.write(
    `  apps completed: ${summary.aggregate.completed}/${summary.apps.length}\n` +
      `  mean coverage:        ${summary.aggregate.mean_coverage !== null ? (summary.aggregate.mean_coverage * 100).toFixed(1) + '%' : 'n/a'}\n` +
      `  mean bug detection:   ${summary.aggregate.mean_bug_detection !== null ? (summary.aggregate.mean_bug_detection * 100).toFixed(1) + '%' : 'n/a'}\n` +
      `  total bugs covered:   ${summary.aggregate.total_bugs_covered}/${summary.aggregate.total_bugs}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
