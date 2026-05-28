#!/usr/bin/env node
// Docker-based parallel WebTestBench batch runner.
//
// Per app, in a Docker container (isolated port + filesystem):
//   1. Extract web_applications_zip/WebTestBench_<NNNN>.zip → tmpdir/<NNNN>/
//   2. Copy Dockerfile.webtestbench into tmpdir/<NNNN>/
//   3. docker build -t cqa-webtest-<NNNN>-<batchdate> tmpdir/<NNNN>
//   4. docker run -d --rm -p 0:8080 --name cqa-<NNNN>-<batchdate> <image>
//      (host port auto-assigned, queried via `docker port`)
//   5. Poll http://localhost:<port>/ until vite responds
//   6. contractqa autopilot --time-budget … (CONTRACTQA_BASE_URL → that port)
//      runs in fixture scratch/<NNNN> for compatibility with the existing
//      autopilot's working-dir conventions
//   7. webtestbench-score (scoring is local, no container needed)
//   8. snapshot scratch/<NNNN>/qa → snapshots/<NNNN>-<batchdate>-docker/
//   9. docker stop cqa-<NNNN>-<batchdate>   (auto-rm)
//
// Apps run in PARALLEL via p-limit (default concurrency 3). Each app's
// container is isolated from the others on its own random host port and
// container-namespaced filesystem, so port-8080 collision in launch.sh
// doesn't apply.
//
// ⚠ BLIND ONLY — never pass --checklist or otherwise leak GT to autopilot.
// (memory: webtestbench-blind-only.md)
//
// Usage:
//   node docker-batch.mjs --range 1-10 [--concurrency N] [--score-limit M]
//
// Fixture is read-only here (zip extraction → /tmp). The existing
// runner/launch.sh etc. are untouched.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const pLimitModule = require_('p-limit');
const pLimit = pLimitModule.default ?? pLimitModule;

const FIXTURE_ROOT = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench';
const QA_AGENT_ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const DOCKERFILE = path.join(QA_AGENT_ROOT, 'scripts/eval/Dockerfile.webtestbench');
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

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('exit', (code) => {
      const ms = Date.now() - start;
      if (opts.logFile) {
        writeFileSync(
          opts.logFile,
          `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n--- exit=${code} duration=${ms}ms ---\n`,
        );
      }
      resolve({ code, stdout, stderr, ms });
    });
    p.on('error', (err) => reject(err));
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Resolve `docker port <name> 8080` → host port. Container takes a moment
// after `docker run -d` before port-mapping shows up.
async function resolveHostPort(containerName) {
  for (let i = 0; i < 30; i++) {
    const r = await run('docker', ['port', containerName, '8080']);
    if (r.code === 0) {
      // Output like "0.0.0.0:54321\n:::54321\n"; grab the first numeric port.
      const m = r.stdout.match(/:(\d{2,5})\b/);
      if (m) return parseInt(m[1], 10);
    }
    await sleep(500);
  }
  throw new Error(`could not resolve host port for ${containerName}`);
}

// Poll vite until it responds. Returns true on success, false on timeout.
async function waitForVite(port, maxSeconds = 60) {
  for (let i = 0; i < maxSeconds * 2; i++) {
    const r = await run('curl', ['-fs', '-o', '/dev/null', `http://localhost:${port}/`]);
    if (r.code === 0) return true;
    await sleep(500);
  }
  return false;
}

async function runApp(idx, batchDir, opts) {
  const log = (msg) => process.stderr.write(`[${idx}] ${msg}\n`);
  const appLogDir = path.join(batchDir, `${idx}-logs`);
  mkdirSync(appLogDir, { recursive: true });

  const imageTag = `cqa-webtest-${idx}-${opts.batchDate}`;
  const containerName = `cqa-${idx}-${opts.batchDate}`;
  const tmpBuildDir = mkdtempSync(path.join(tmpdir(), `cqa-build-${idx}-`));

  // 1. Extract zip into tmpBuildDir
  log(`extract zip → ${tmpBuildDir}`);
  const zipPath = path.join(FIXTURE_ROOT, 'web_applications_zip', `WebTestBench_${idx}.zip`);
  if (!existsSync(zipPath)) {
    log(`zip not found: ${zipPath}`);
    return { idx, ok: false, stage: 'extract', error: 'zip not found' };
  }
  // Each zip extracts to a top-level dir; unzip with strip-1 to flatten
  const unzipRes = await run('bash', ['-c', `cd ${tmpBuildDir} && unzip -q "${zipPath}" -d unpacked && cp -r unpacked/*/. . && rm -rf unpacked`], {
    logFile: path.join(appLogDir, '1-extract.log'),
  });
  if (unzipRes.code !== 0) {
    log(`extract FAILED exit=${unzipRes.code}`);
    rmSync(tmpBuildDir, { recursive: true, force: true });
    return { idx, ok: false, stage: 'extract', error: unzipRes.stderr.slice(0, 200) };
  }

  // 2. Copy Dockerfile in
  cpSync(DOCKERFILE, path.join(tmpBuildDir, 'Dockerfile'));

  // 3. Build image (cached on subsequent runs if package.json unchanged)
  log('docker build');
  const buildRes = await run('docker', ['build', '-t', imageTag, tmpBuildDir], {
    logFile: path.join(appLogDir, '2-build.log'),
  });
  if (buildRes.code !== 0) {
    log(`build FAILED exit=${buildRes.code}`);
    rmSync(tmpBuildDir, { recursive: true, force: true });
    return { idx, ok: false, stage: 'build', error: buildRes.stderr.slice(0, 200) };
  }

  // 4. Run container with random host port
  log('docker run -d');
  const runRes = await run('docker', ['run', '-d', '--rm', '-p', '0:8080', '--name', containerName, imageTag], {
    logFile: path.join(appLogDir, '3-docker-run.log'),
  });
  if (runRes.code !== 0) {
    log(`docker run FAILED exit=${runRes.code}`);
    rmSync(tmpBuildDir, { recursive: true, force: true });
    return { idx, ok: false, stage: 'docker-run', error: runRes.stderr.slice(0, 200) };
  }

  let summary;
  try {
    // 5. Resolve host port + wait for vite
    const hostPort = await resolveHostPort(containerName);
    log(`vite expected on host port ${hostPort}; waiting…`);
    const viteUp = await waitForVite(hostPort, 90);
    if (!viteUp) {
      log(`vite did not respond on :${hostPort}`);
      const dockerLog = await run('docker', ['logs', containerName]);
      writeFileSync(path.join(appLogDir, '4-vite-log.log'), dockerLog.stdout + '\n--- stderr ---\n' + dockerLog.stderr);
      return { idx, ok: false, stage: 'vite-up', error: 'vite did not bind in 90s' };
    }

    // 6. autopilot — use scratch/<NNNN> as cwd so contracts land in the
    // fixture's scratch directory exactly like the serial runner does.
    // We use --regenerate to clear stale qa/contracts/ from prior runs.
    log(`autopilot (deep, ${TIME_BUDGET_MS / 60000}min budget, target :${hostPort})`);
    // Ensure scratch/<NNNN>/qa is reset so --regenerate has something to wipe
    const scratchApp = path.join(FIXTURE_ROOT, 'scratch', idx);
    mkdirSync(scratchApp, { recursive: true });
    // Mirror the source tree minimally for scorer (needs paths to exist)
    // Actually autopilot needs the source code (interaction-discovery walks it).
    // Easiest: cp -r tmpBuildDir → scratchApp so autopilot sees the same files
    rmSync(scratchApp, { recursive: true, force: true });
    mkdirSync(scratchApp, { recursive: true });
    cpSync(tmpBuildDir, scratchApp, { recursive: true });

    const apRes = await run('contractqa', [
      'autopilot',
      '--no-fix', '--yes',
      '--regenerate',
      '--time-budget', String(TIME_BUDGET_MS),
    ], {
      cwd: scratchApp,
      env: { CONTRACTQA_BASE_URL: `http://localhost:${hostPort}` },
      logFile: path.join(appLogDir, '5-autopilot.log'),
    });

    // 7. score
    log('score (LLM judge)');
    const scoreArgs = ['scripts/eval/webtestbench-score.mjs', '--idx', idx];
    if (opts.scoreLimit) scoreArgs.push('--limit', String(opts.scoreLimit));
    const scoreRes = await run('node', scoreArgs, {
      cwd: QA_AGENT_ROOT,
      logFile: path.join(appLogDir, '6-score.log'),
    });

    // 8. snapshot
    log('snapshot');
    const snapDir = path.join(FIXTURE_ROOT, 'snapshots', `${idx}-${opts.batchDate}-docker`);
    mkdirSync(snapDir, { recursive: true });
    try {
      cpSync(path.join(scratchApp, 'qa'), path.join(snapDir, 'qa'), { recursive: true });
      if (existsSync(path.join(scratchApp, 'score.json'))) {
        cpSync(path.join(scratchApp, 'score.json'), path.join(snapDir, 'score.json'));
      }
    } catch (err) {
      log(`snapshot FAILED: ${err.message}`);
    }

    let score = null;
    try {
      score = JSON.parse(readFileSync(path.join(scratchApp, 'score.json'), 'utf8'));
    } catch { /* nothing */ }

    summary = {
      idx,
      ok: scoreRes.code === 0 && score !== null,
      autopilot_exit: apRes.code,
      score_exit: scoreRes.code,
      autopilot_ms: apRes.ms,
      score_ms: scoreRes.ms,
      host_port: hostPort,
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
  } finally {
    // 9. teardown — stop container (auto-rm), drop tmp dir.
    await run('docker', ['stop', containerName], {
      logFile: path.join(appLogDir, '9-docker-stop.log'),
    });
    rmSync(tmpBuildDir, { recursive: true, force: true });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  const range = args.range;
  if (!range || !/^\d{1,4}-\d{1,4}$/.test(range)) {
    console.error('usage: docker-batch.mjs --range <a>-<b> [--concurrency N] [--score-limit M]');
    console.error('  e.g. --range 1-10 --concurrency 3');
    process.exit(1);
  }
  const [a, b] = range.split('-').map((s) => parseInt(s, 10));
  if (b < a) {
    console.error('error: range end must be >= start');
    process.exit(1);
  }
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
  const scoreLimit = args['score-limit'] ? parseInt(args['score-limit'], 10) : null;
  const batchDate = new Date().toISOString().slice(0, 10);
  const batchDir = path.join(FIXTURE_ROOT, 'snapshots', `batch-${batchDate}-docker`);
  mkdirSync(batchDir, { recursive: true });

  const summary = {
    batch: batchDate,
    range: { start: a, end: b },
    concurrency,
    runner: 'docker',
    started_at: new Date().toISOString(),
    discovery_mode: 'deep',
    score_limit: scoreLimit,
    apps: [],
  };
  const summaryPath = path.join(batchDir, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Signal handler — on SIGINT, stop all containers we know about.
  const myContainers = [];
  process.on('SIGINT', async () => {
    process.stderr.write('\n[docker-batch] SIGINT — stopping containers\n');
    for (const name of myContainers) {
      try { await run('docker', ['stop', name]); } catch { /* */ }
    }
    process.exit(130);
  });

  const limit = pLimit(concurrency);
  const indices = [];
  for (let i = a; i <= b; i++) indices.push(pad4(i));
  process.stderr.write(`\n========== docker-batch starting (concurrency=${concurrency}, apps=${indices.length}) ==========\n`);

  const tasks = indices.map((idx) =>
    limit(async () => {
      process.stderr.write(`[${idx}] start\n`);
      myContainers.push(`cqa-${idx}-${batchDate}`);
      const result = await runApp(idx, batchDir, { batchDate, scoreLimit });
      summary.apps.push(result);
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      return result;
    }),
  );
  await Promise.all(tasks);

  summary.finished_at = new Date().toISOString();
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
  process.stderr.write(`\n========== docker-batch complete ==========\n`);
  process.stderr.write(`summary: ${summaryPath}\n`);
  process.stderr.write(
    `  concurrency:          ${concurrency}\n` +
      `  apps completed:       ${summary.aggregate.completed}/${summary.apps.length}\n` +
      `  mean coverage:        ${summary.aggregate.mean_coverage !== null ? (summary.aggregate.mean_coverage * 100).toFixed(1) + '%' : 'n/a'}\n` +
      `  mean bug detection:   ${summary.aggregate.mean_bug_detection !== null ? (summary.aggregate.mean_bug_detection * 100).toFixed(1) + '%' : 'n/a'}\n` +
      `  total bugs covered:   ${summary.aggregate.total_bugs_covered}/${summary.aggregate.total_bugs}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
