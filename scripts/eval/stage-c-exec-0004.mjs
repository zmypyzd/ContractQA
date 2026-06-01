// Stage-C execution harness for the app-0004 autopilot run.
// Loads every contract the autopilot generated into scratch/0004/qa/contracts,
// runs each against the LIVE app on :8080, and prints a per-contract verdict so
// the tuner can map FAIL→GT-bug-id (true detection) and spot false-fails on
// pass:true checklist items.
//
// Deep-mode writes browser contracts as DEFERRED (not executed inline), so this
// is where execution truth actually comes from — the webtestbench LLM judge only
// scores topical coverage, never runs anything.
//
// Usage: node scripts/eval/stage-c-exec-0004.mjs
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const BASE = 'http://127.0.0.1:8080';
const CONTRACTS = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench/scratch/0004/qa/contracts';

const runner = await import(path.join(ROOT, 'packages/runner/dist/index.js'));
const probes = await import(path.join(ROOT, 'packages/probes/dist/index.js'));
const { chromium } = await import('@playwright/test');

const emptyNoise = {
  project: 'eval',
  generated_at: '2026-06-01T00:00:00.000Z',
  ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] },
};

const loaded = await runner.loadContractsFromDir(CONTRACTS, { lenient: true });
console.log(`LOADABLE contracts: ${loaded.length}`);

const browser = await chromium.launch({ headless: true });
const stripBase = (u) => (u.startsWith(BASE) ? u.slice(BASE.length) || '/' : u);
const results = [];

for (const contract of loaded) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const tmp = mkdtempSync(path.join(tmpdir(), 'cqa-c-'));
  try {
    const thunk = runner.compileContract(contract);
    const captureDom = !!contract.expected?.dom;
    await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'b.png'), captureDom });
    await thunk({ page, snapshot: async () => ({ url: page.url(), localStorageKeys: [], cookies: [] }), context });
    const after = await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'a.png'), captureDom });
    const mk = (s) => ({ url: stripBase(s.url), localStorageKeys: Object.keys(s.localStorage), cookies: s.cookies.map((c) => c.name), dom: s.dom });
    const v = await runner.runOracle({ contract, before: mk(await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'b2.png'), captureDom: false })), after: mk(after), noise: emptyNoise, missingCapabilities: [], attach: () => {}, tmpDir: tmp });
    const viol = (v.violations || []).map((x) => x.message).join(' | ');
    results.push({ id: contract.id, area: contract.area, verdict: v.verdict, expected_keys: Object.keys(contract.expected || {}), dom_keys: Object.keys(contract.expected?.dom || {}), violations: viol });
    console.log(`[${v.verdict === 'FAIL' ? 'FAIL✓bug' : v.verdict}] ${contract.id}  exp=${Object.keys(contract.expected||{}).join('+')}${viol ? '  ::: ' + viol.slice(0, 160) : ''}`);
  } catch (e) {
    results.push({ id: contract.id, verdict: 'ERROR', error: String(e.message || e).slice(0, 160) });
    console.log(`[ERROR] ${contract.id}  ${String(e.message || e).slice(0, 140)}`);
  } finally {
    await context.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
await browser.close();

const fails = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== SUMMARY ===`);
console.log(`total=${results.length}  FAIL(bug-caught)=${fails.length}  PASS=${results.filter(r=>r.verdict==='PASS').length}  ERROR=${results.filter(r=>r.verdict==='ERROR').length}`);
console.log(`FAIL contract ids:`, fails.map((f) => f.id).join(', '));
writeFileSync('/tmp/stage-c-0004.json', JSON.stringify(results, null, 2));
console.log(`(full per-contract results → /tmp/stage-c-0004.json)`);
