import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const BASE = 'http://127.0.0.1:8080';
const runner = await import(path.join(ROOT, 'packages/runner/dist/index.js'));
const probes = await import(path.join(ROOT, 'packages/probes/dist/index.js'));
const { chromium } = await import('@playwright/test');
const emptyNoise = { project:'eval', generated_at:'2026-06-01T00:00:00.000Z', ignore:{ localStorage_keys:[], sessionStorage_keys:[], cookies:[], network_url_patterns:[], console_patterns:[] } };

// LOADABILITY test: loader applies schema defaults + rejects invalid contracts.
const loaded = await runner.loadContractsFromDir('/tmp/genexp/contracts', { lenient: true });
console.log('LOADABLE contracts:', loaded.length, '->', loaded.map(c=>c.id).join(', '));

const browser = await chromium.launch({ headless: true });
for (const contract of loaded) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  const tmp = mkdtempSync(path.join(tmpdir(), 'cqa-'));
  const stripBase = (u)=> (u.startsWith(BASE) ? u.slice(BASE.length)||'/' : u);
  try {
    const thunk = runner.compileContract(contract);
    const captureDom = !!contract.expected?.dom;
    const before = await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp,'b.png'), captureDom });
    await thunk({ page, snapshot: async()=>({url:page.url(),localStorageKeys:[],cookies:[]}), context });
    const after = await probes.snapshotBrowser(page, { screenshotPath: path.join(tmp,'a.png'), captureDom });
    const mk = (s)=>({ url:stripBase(s.url), localStorageKeys:Object.keys(s.localStorage), cookies:s.cookies.map(c=>c.name), dom:s.dom });
    const v = await runner.runOracle({ contract, before:mk(before), after:mk(after), noise:emptyNoise, missingCapabilities:[], attach:()=>{}, tmpDir:tmp });
    console.log(`\n[${contract.id}] verdict=${v.verdict}  (FAIL = bug caught)`);
    for (const vio of (v.violations||[])) console.log('   violation:', vio.invariantId, '-', vio.message, 'got', JSON.stringify(vio.actual));
  } catch(e){ console.log(`[${contract.id}] ERROR ${String(e.message||e).slice(0,200)}`); }
  finally { await context.close(); rmSync(tmp,{recursive:true,force:true}); }
}
await browser.close();
