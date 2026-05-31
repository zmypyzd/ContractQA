// Full-pipeline re-measure helper: from the autopilot-generated app4 qa/contracts,
// find the NEGATIVE-OUTCOME contracts (fill a negative value -> commit -> not_contains_text)
// targeting the planning modal, run each against live app4 (:8080), and report whether
// the budget (id8) / guests (id9) omission bugs are caught by the REAL pipeline output.
// Prereq: app4 live on :8080; CONTRACTQA_GEN_PROMPT=priors-neg autopilot run finished.
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const CONTRACTS = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench/scratch/0004/qa/contracts';
const BASE = 'http://127.0.0.1:8080';

const runner = await import(path.join(ROOT, 'packages/runner/dist/index.js'));
const probes = await import(path.join(ROOT, 'packages/probes/dist/index.js'));
const { chromium } = await import('@playwright/test');
const emptyNoise = { project: 'eval', generated_at: '2026-06-01T00:00:00.000Z', ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] } };

const all = await runner.loadContractsFromDir(CONTRACTS, { lenient: true });
console.log(`loaded ${all.length} contracts from the autopilot run`);

// A "negative-outcome" contract: fills a value beginning with "-" AND asserts not_contains_text.
const isNeg = (c) => {
  const fillsNeg = (c.actions || []).some((a) => a.type === 'fill' && typeof a.value === 'string' && /^-/.test(a.value.trim()));
  const negAssert = !!c.expected?.dom?.not_contains_text?.some((s) => /-\d/.test(s));
  return fillsNeg && negAssert;
};
const negs = all.filter(isNeg);
console.log(`NEGATIVE-OUTCOME contracts emitted by the full pipeline: ${negs.length}`);
for (const c of negs) console.log('  -', c.id, '| fills', (c.actions.find(a => a.type==='fill'&&/^-/.test(String(a.value).trim()))||{}).value, '| asserts not', JSON.stringify(c.expected?.dom?.not_contains_text));

const browser = await chromium.launch({ headless: true });
for (const contract of negs) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  const tmp = mkdtempSync(path.join(tmpdir(), 'cqa-'));
  const stripBase = (u) => (u.startsWith(BASE) ? u.slice(BASE.length) || '/' : u);
  try {
    const thunk = runner.compileContract(contract);
    const captureDom = !!contract.expected?.dom;
    const before = await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'b.png'), captureDom });
    await thunk({ page, snapshot: async () => ({ url: page.url(), localStorageKeys: [], cookies: [] }), context });
    const after = await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'a.png'), captureDom });
    const mk = (s) => ({ url: stripBase(s.url), localStorageKeys: Object.keys(s.localStorage), cookies: s.cookies.map(c => c.name), dom: s.dom });
    const v = await runner.runOracle({ contract, before: mk(before), after: mk(after), noise: emptyNoise, missingCapabilities: [], attach: () => {}, tmpDir: tmp });
    console.log(`\n[${contract.id}] verdict=${v.verdict}  (FAIL = bug caught)`);
    for (const vio of (v.violations || [])) console.log('   ', vio.invariantId, '-', vio.message, 'got', JSON.stringify(vio.actual));
  } catch (e) { console.log(`[${contract.id}] ERROR ${String(e.message || e).slice(0, 180)}`); }
  finally { await context.close(); rmSync(tmp, { recursive: true, force: true }); }
}
await browser.close();
