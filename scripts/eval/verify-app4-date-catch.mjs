// Live end-to-end verification for the app4 (Wedding planner) date-omission bug
// (WebTestBench id11): the "Wedding Details" modal accepts a PAST wedding date
// and the dashboard displays it, because there is no min attr and handleSave
// has no guard.
//
// This is the catch the date_constraint oracle was built for. The missing piece
// was snapshot coverage — the displayed date renders as a plain-text node, and
// the probe only captured roled/interactive elements. After extending
// collectDomShape with a text-bearing pass, {target:{text:"2020"}, rule:future}
// should ground onto the displayed "Jan 1, 2020" and FAIL.
//
// Prereq: app4 running on :8080
//   cd /Users/zmy/intership/qa-eval-fixtures/WebTestBench && ./runner/launch.sh 0004
// Run:
//   node scripts/eval/verify-app4-date-catch.mjs
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const BASE = 'http://127.0.0.1:8080';

const runner = await import(path.join(ROOT, 'packages/runner/dist/index.js'));
const probes = await import(path.join(ROOT, 'packages/probes/dist/index.js'));
const { chromium } = await import('@playwright/test');

const emptyNoise = {
  project: 'eval',
  generated_at: '2026-06-01T00:00:00.000Z',
  ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] },
};

// Author the contract as YAML and load it through the real loader so the schema
// (Target.css / Target.nth / expected.dom.date_constraint) is exercised exactly
// as the agent's generated contracts are.
const CONTRACT = `
id: app4-wedding-date-must-be-future
title: Wedding date entered in the planning modal must be in the future
area: core
severity: P1
preconditions:
  auth_state: anonymous
actions:
  - type: goto
    path: /
  - type: click
    target:
      name_regex: "Get Started|Update Details"
      first: true
  - type: wait
    ms: 400
  - type: fill
    target:
      css: 'input[type="number"]'
      nth: 0
    value: "20000"
  - type: fill
    target:
      css: 'input[type="number"]'
      nth: 1
    value: "100"
  - type: fill
    target:
      css: 'input[type="date"]'
    value: "2020-01-01"
  - type: click
    target:
      name_regex: "^Save"
      first: true
  - type: wait
    ms: 800
expected:
  dom:
    date_constraint:
      - target:
          text: "2020"
        rule: future
`;

const cdir = mkdtempSync(path.join(tmpdir(), 'cqa-app4-date-'));
mkdirSync(path.join(cdir, 'contracts'), { recursive: true });
writeFileSync(path.join(cdir, 'contracts', 'date.yml'), CONTRACT);

const loaded = await runner.loadContractsFromDir(path.join(cdir, 'contracts'), { lenient: true });
console.log('LOADABLE contracts:', loaded.length, '->', loaded.map((c) => c.id).join(', '));
if (loaded.length !== 1) {
  console.error('FAILED to load the date contract (schema rejected it).');
  process.exit(2);
}
const contract = loaded[0];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const tmp = mkdtempSync(path.join(tmpdir(), 'cqa-run-'));
const stripBase = (u) => (u.startsWith(BASE) ? u.slice(BASE.length) || '/' : u);

let verdict;
try {
  const thunk = runner.compileContract(contract);
  const captureDom = !!contract.expected?.dom;
  await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'b.png'), captureDom });
  await thunk({ page, snapshot: async () => ({ url: page.url(), localStorageKeys: [], cookies: [] }), context });
  const after = await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'a.png'), captureDom });

  // Diagnostic: which text-bearing elements carry "2020"?
  const dated = (after.dom?.elements || []).filter((e) => e.text.includes('2020'));
  console.log(`\nText-bearing elements containing "2020": ${dated.length}`);
  for (const e of dated.slice(0, 8)) console.log(`   role=${e.role} text=${JSON.stringify(e.text.slice(0, 60))}`);

  const mk = (s) => ({ url: stripBase(s.url), localStorageKeys: Object.keys(s.localStorage), cookies: s.cookies.map((c) => c.name), dom: s.dom });
  const before2 = mk(await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp, 'b2.png'), captureDom: false }));
  verdict = await runner.runOracle({ contract, before: before2, after: mk(after), noise: emptyNoise, missingCapabilities: [], attach: () => {}, tmpDir: tmp });
  console.log(`\n[${contract.id}] verdict=${verdict.verdict}  (FAIL = bug caught)`);
  for (const vio of verdict.violations || []) console.log('   violation:', vio.invariantId, '-', vio.message, 'got', JSON.stringify(vio.actual));
} catch (e) {
  console.log(`[${contract.id}] ERROR ${String(e.stack || e.message || e).slice(0, 400)}`);
} finally {
  await context.close();
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
  rmSync(cdir, { recursive: true, force: true });
}

process.exit(verdict?.verdict === 'FAIL' ? 0 : 1);
