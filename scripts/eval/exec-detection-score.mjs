// exec-detection-score.mjs — EXECUTION-grounded bug-detection scorer (Entry 14 Next #1)
//
// The coverage scorer (webtestbench-score.mjs) never runs contracts — its
// `bug_detection_coverage` is an LLM judge deciding a contract is *aimed at* a
// requirement. Entry 14 proved that overstates real detection ~2-4x: a contract
// can "cover" a bug (judge-matched) yet PASS on the buggy SUT (blind to the bug).
//
// This scorer closes that gap. For each ground-truth bug (checklist pass:false)
// it takes the contracts the coverage judge matched to it, RUNS them against the
// live buggy SUT (same runOracle path as `contractqa run`), and classifies the
// outcome into the pipeline stage where detection broke:
//
//   true_detection   — a matched contract FAILs and the failure matches the bug
//   weak_assertion   — matched contract(s) all PASS (covered-but-not-caught)
//   execution_defect — matched contract throws at runtime (e.g. brittle selector)
//   off_target_fail  — matched contract FAILs but for an unrelated reason
//   not_covered      — coverage judge matched no contract (discovery/judge gap)
//
// Usage:
//   node scripts/eval/exec-detection-score.mjs --idx 0008 [--arm reflexion-on]
//        [--base-url http://localhost:PORT] [--keep-up] [--out path.json]
// If --base-url is omitted, the script builds + runs the app's docker container
// itself (reusing the WebTestBench zip + Dockerfile), then tears it down.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const FIX = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench';
const SNAP = path.join(FIX, 'snapshots');

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

// Scorer-identical contract enumeration: recursive readdir + parseYaml, push ALL
// that parse (no schema filtering). 1-based index === coverage judge's contract id.
function loadScorerOrder(dir) {
  const out = [];
  (function rec(d) {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) {
        try { out.push({ file: p, raw: readFileSync(p, 'utf8'), ...parseYaml(readFileSync(p, 'utf8')) }); }
        catch { /* skip unparseable — matches scorer */ }
      }
    }
  })(dir);
  return out;
}

function loadChecklist(idx) {
  const raw = readFileSync(path.join(FIX, 'WebTestBench.jsonl'), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.index === `WebTestBench_${idx}`) return r;
  }
  throw new Error(`checklist not found: ${idx}`);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return r;
}

async function buildAndRun(idx) {
  const work = mkdtempSync(path.join(tmpdir(), `exec-det-${idx}-`));
  const zip = path.join(FIX, 'web_applications_zip', `WebTestBench_${idx}.zip`);
  sh('bash', ['-c', `cd ${work} && unzip -q "${zip}" -d unpacked && cp -r unpacked/*/. . && rm -rf unpacked`]);
  cpSync(path.join(ROOT, 'scripts/eval/Dockerfile.webtestbench'), path.join(work, 'Dockerfile'));
  const tag = `cqa-execdet-${idx}`;
  const name = `cqa-execdet-${idx}`;
  sh('docker', ['rm', '-f', name]);
  const b = sh('docker', ['build', '-t', tag, work]);
  if (b.status !== 0) throw new Error(`docker build failed: ${b.stderr?.slice(0, 300)}`);
  sh('docker', ['run', '-d', '--rm', '-p', '0:8080', '--name', name, tag]);
  const insp = sh('docker', ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}', name]);
  const port = insp.stdout.trim();
  // wait for vite
  let up = false;
  for (let i = 0; i < 60; i++) {
    const c = sh('curl', ['-sf', `http://localhost:${port}`]);
    if (c.status === 0) { up = true; break; }
    sh('sleep', ['1']);
  }
  if (!up) { sh('docker', ['rm', '-f', name]); throw new Error('vite did not bind in 60s'); }
  return { work, tag, name, port, baseUrl: `http://localhost:${port}` };
}

function teardown(ctx) {
  if (!ctx) return;
  sh('docker', ['rm', '-f', ctx.name]);
  sh('docker', ['rmi', '-f', ctx.tag]);
  if (ctx.work) rmSync(ctx.work, { recursive: true, force: true });
}

// Run a single contract against the live SUT and return a structured verdict.
async function runOne(contract, baseUrl, browser, deps, authEntry) {
  const { compileContract, runOracle, snapshotBrowser, emptyNoise, applyAuth } = deps;
  // Contracts use relative goto paths ("/dashboard"); the canonical runner relies
  // on playwright config's use.baseURL. We launch chromium directly, so set
  // baseURL on the context so relative navigations resolve against the SUT.
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  const tmp = mkdtempSync(path.join(tmpdir(), `cqa-${contract.id}-`));
  const stripBase = (u) => (baseUrl && u.startsWith(baseUrl) ? u.slice(baseUrl.length) || '/' : u);
  let authed = false;
  try {
    // Auth bootstrap for logged_in contracts (scorer-side; not blind-gated).
    if (contract.preconditions?.auth_state === 'logged_in' && authEntry) {
      try { authed = await applyAuth(page, authEntry); } catch { authed = false; }
    }
    const thunk = compileContract(contract);
    const captureDom = !!contract.expected?.dom;
    const before = await snapshotBrowser(page, { screenshotPath: path.join(tmp, 'before.png'), captureDom });
    const dummySnap = async () => ({ url: page.url(), localStorageKeys: [], cookies: [] });
    await thunk({ page, snapshot: dummySnap, context });
    const after = await snapshotBrowser(page, { screenshotPath: path.join(tmp, 'after.png'), captureDom });
    const mk = (snap) => ({ url: stripBase(snap.url), localStorageKeys: Object.keys(snap.localStorage), cookies: snap.cookies.map((c) => c.name), dom: snap.dom });
    const verdict = await runOracle({ contract, before: mk(before), after: mk(after), noise: emptyNoise, missingCapabilities: [], attach: () => {}, tmpDir: tmp });
    return {
      verdict: verdict.verdict,
      violations: (verdict.violations || []).map((v) => `${v.invariantId}: ${v.message} (got ${JSON.stringify(v.actual)})`),
      threw: false,
      authed,
    };
  } catch (e) {
    return { verdict: 'ERROR', violations: [], threw: true, error: String(e.message || e).slice(0, 300), authed };
  } finally {
    await context.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

// LLM judge: does the failed assertion test the same feature/behavior as the bug?
// Hardened (Entry 17 → 18): (a) grounded — decide ONLY from the violation's
// expected-vs-got, no assuming unshown page state (bug#1 was mislabeled "login page"
// while the got text was the dashboard); (b) feature-alignment rubric, not vibe;
// (c) k-sample majority vote to damp single-shot hallucination.
async function judgeOnTarget(bug, contractTitle, violations, pickClient, k = 3) {
  const client = await pickClient();
  const sys = [
    'You decide whether a failing UI contract caught a SPECIFIC planted bug.',
    'Decide ONLY from the evidence below. Each violation line shows the EXPECTED value and the ACTUAL "got" value — reason strictly from those strings; do NOT assume any page/route/login state that is not present in the got text.',
    'on_target=true iff the assertion that FAILED tests the same feature/behavior the bug describes (different wording is fine — judge the feature, not the phrasing). on_target=false if the failed assertion is about an unrelated element/text/layout, or if the got text shows the contract never reached the bug\'s surface.',
    'Output STRICTLY one JSON object: {"on_target": true|false, "reason": "one short sentence that quotes the got text"}.',
  ].join(' ');
  const user = [
    `PLANTED BUG: ${bug}`,
    `CONTRACT (what it tests): ${contractTitle || '(unknown)'}`,
    `FAILED ASSERTIONS (expected vs got):`,
    ...violations.map((v) => `  - ${v}`),
    'Does the failed assertion test the same feature/behavior as the planted bug?',
  ].join('\n');
  const votes = [];
  for (let i = 0; i < k; i++) {
    try {
      const r = await client.generate({ system: sys, messages: [{ role: 'user', content: user }] });
      const m = String(r.content).match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); votes.push({ on: !!j.on_target, reason: j.reason || '' }); }
    } catch { /* skip this vote */ }
  }
  if (votes.length === 0) return { on_target: false, reason: 'no judge votes (all errored)', votes: '0/0' };
  const onCount = votes.filter((v) => v.on).length;
  const on_target = onCount * 2 > votes.length; // strict majority
  const reason = (votes.find((v) => v.on === on_target) || votes[0]).reason;
  return { on_target, reason, votes: `${onCount}/${votes.length} on-target` };
}

async function main() {
  const args = parseArgs(process.argv);
  const idx = args.idx;
  if (!idx || !/^\d{4}$/.test(idx)) { console.error('usage: --idx NNNN [--arm reflexion-on] [--base-url URL] [--keep-up] [--out path]'); process.exit(1); }
  const arm = typeof args.arm === 'string' ? args.arm : 'reflexion-on';
  const snapDir = path.join(SNAP, `${idx}-2026-05-29-${arm}-docker`);
  const contractsDir = path.join(snapDir, 'qa', 'contracts');
  const coveragePath = path.join(snapDir, 'score.json');
  if (!existsSync(contractsDir)) throw new Error(`no contracts at ${contractsDir}`);
  if (!existsSync(coveragePath)) throw new Error(`no coverage score at ${coveragePath}`);

  const scorerOrder = loadScorerOrder(contractsDir); // raw, for index→id mapping (matches coverage judge)
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
  const checklist = loadChecklist(idx);
  const bugItems = checklist.checklist.filter((c) => c.pass === false);

  // deps (ESM dynamic)
  const runner = await import(path.join(ROOT, 'packages/runner/dist/index.js'));
  const probes = await import(path.join(ROOT, 'packages/probes/dist/index.js'));
  // Normalized contracts (loader applies schema defaults like verification.wait_ms
  // that compileContract requires). Index by id; raw parseYaml objects can't be run.
  const normalized = await runner.loadContractsFromDir(contractsDir, { lenient: true });
  const byId = new Map(normalized.map((c) => [c.id, c]));
  const { chromium } = await import('@playwright/test');
  const { pickClient } = await import(path.join(ROOT, 'packages/orchestrator/dist/llm/pick-client.js'));
  const { AUTH_REGISTRY, applyAuth } = await import(path.join(ROOT, 'scripts/eval/auth-registry.mjs'));
  const authEntry = AUTH_REGISTRY[idx] || null;
  if (authEntry) console.error(`[exec-det ${idx}] auth bootstrap available (${authEntry.strategy}: ${authEntry.note || ''})`);
  const emptyNoise = { project: 'eval', generated_at: '2026-05-29T00:00:00.000Z', ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] } };
  const deps = { compileContract: runner.compileContract, runOracle: runner.runOracle, snapshotBrowser: probes.snapshotBrowser, emptyNoise, applyAuth };

  let ctx = null;
  let baseUrl = typeof args['base-url'] === 'string' ? args['base-url'] : null;
  if (!baseUrl) { console.error(`[exec-det ${idx}] building container…`); ctx = await buildAndRun(idx); baseUrl = ctx.baseUrl; console.error(`[exec-det ${idx}] SUT up at ${baseUrl}`); }

  const browser = await chromium.launch({ headless: true });
  const ranCache = new Map(); // contract index -> result (run once, reused across bugs)

  const bugResults = [];
  try {
    for (const bug of bugItems) {
      const cov = coverage.coverage.find((c) => c.checklist_id === bug.id);
      // Prefer stable string ids (reconciled scores have matched_contract_keys);
      // fall back to numeric ordinals into scorer order (legacy score.json).
      let matched;
      if (Array.isArray(cov?.matched_contract_keys)) {
        const idToIx = new Map(scorerOrder.map((c, i) => [c.id, i + 1]));
        matched = cov.matched_contract_keys.map((k) => idToIx.get(k)).filter((n) => Number.isInteger(n));
      } else {
        matched = (cov?.matched_contract_ids || []).map(Number).filter((n) => Number.isFinite(n));
      }
      if (!cov?.covered || matched.length === 0) {
        bugResults.push({ bug_id: bug.id, bug: bug.bug, covered: !!cov?.covered, matched: [], stage: 'not_covered', detail: 'coverage judge matched no contract' });
        continue;
      }
      const runs = [];
      for (const ix of matched) {
        const meta = scorerOrder[ix - 1];
        if (!meta) { runs.push({ ix, id: '(out-of-range)', verdict: 'MISSING' }); continue; }
        const c = byId.get(meta.id); // normalized, runnable
        if (!ranCache.has(ix)) {
          if (!c) {
            // raw file parsed for indexing but loader rejected it (schema-invalid) → can't run
            ranCache.set(ix, { verdict: 'UNLOADABLE', violations: [], threw: true, error: 'schema-invalid: loader skipped (lenient)' });
          } else {
            process.stderr.write(`[exec-det ${idx}] run [${ix}] ${meta.id} … `);
            const res = await runOne(c, baseUrl, browser, deps, authEntry);
            process.stderr.write(`${res.verdict}${res.authed ? ' (authed)' : ''}\n`);
            ranCache.set(ix, res);
          }
        }
        const r = ranCache.get(ix);
        runs.push({ ix, id: meta.id, title: meta.title, auth_state: meta.preconditions?.auth_state ?? 'anonymous', authed: !!r.authed, verdict: r.verdict, threw: r.threw, error: r.error, violations: r.violations });
      }
      // classify — separate the pipeline stage where detection broke.
      // A contract whose precondition is auth_state:logged_in but ran without an
      // auth bootstrap (this eval has none) never reaches the gated surface — its
      // FAIL is the login wall, not detection. Treat those as auth_unreached, not
      // as off-target assertions, so the back-trace blames the right stage.
      // A logged_in contract is reachable IF the auth bootstrap put us in session
      // (r.authed); otherwise it's blocked at the login wall.
      const authBlocked = runs.filter((r) => r.auth_state === 'logged_in' && !r.authed);
      const reachable = runs.filter((r) => r.auth_state !== 'logged_in' || r.authed);
      const reachFails = reachable.filter((r) => r.verdict === 'FAIL');
      const reachPass = reachable.filter((r) => r.verdict === 'PASS');
      const reachThrew = reachable.filter((r) => r.threw);
      let stage, detail;
      if (reachFails.length > 0) {
        // judge whether ANY reachable fail is on-target for the bug
        let onTarget = null;
        for (const f of reachFails) {
          const j = await judgeOnTarget(bug.bug, f.title, f.violations, pickClient);
          if (j.on_target) { onTarget = { ...j, contract: f.id }; break; }
          onTarget = onTarget || { ...j, contract: f.id };
        }
        if (onTarget?.on_target) { stage = 'true_detection'; detail = `${onTarget.contract} [${onTarget.votes}]: ${onTarget.reason}`; }
        else { stage = 'off_target_fail'; detail = `failed but unrelated to bug [${onTarget?.votes}]: ${onTarget?.reason || ''}`; }
      } else if (reachPass.length > 0) {
        stage = 'weak_assertion'; detail = 'reachable contract(s) PASS on buggy SUT (covered-but-not-caught)';
      } else if (reachThrew.length > 0) {
        stage = 'execution_defect'; detail = reachThrew.map((t) => `${t.id}: ${t.error}`).join(' | ');
      } else if (authBlocked.length > 0) {
        stage = 'auth_unreached'; detail = `matched contract(s) require auth_state:logged_in but eval has no auth bootstrap — never reached the buggy surface (${authBlocked.map((r) => r.id).join(', ')})`;
      } else {
        stage = 'inconclusive'; detail = 'no reachable run produced a verdict';
      }
      bugResults.push({ bug_id: bug.id, bug: bug.bug, covered: true, matched, runs, stage, detail });
    }
  } finally {
    await browser.close();
    if (!args['keep-up']) teardown(ctx);
    else if (ctx) console.error(`[exec-det ${idx}] left SUT up at ${baseUrl} (container ${ctx.name})`);
  }

  const stages = bugResults.reduce((m, b) => ((m[b.stage] = (m[b.stage] || 0) + 1), m), {});
  const trueDet = bugResults.filter((b) => b.stage === 'true_detection').length;
  const out = {
    idx, arm, base_url: baseUrl,
    total_bugs: bugItems.length,
    coverage_detected: bugItems.filter((b) => coverage.coverage.find((c) => c.checklist_id === b.id)?.covered).length,
    execution_true_detection: trueDet,
    stage_breakdown: stages,
    bugs: bugResults,
  };
  const outPath = typeof args.out === 'string' ? args.out : path.join(snapDir, 'exec-detection.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n=== exec-detection ${idx} (${arm}) ===`);
  console.log(`coverage "detected": ${out.coverage_detected}/${out.total_bugs}  |  execution true detection: ${trueDet}/${out.total_bugs}`);
  console.log('stage breakdown:', JSON.stringify(stages));
  for (const b of bugResults) console.log(`  bug#${b.bug_id} [${b.stage}] ${b.detail}`);
  console.log(`→ ${outPath}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
