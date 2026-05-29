import path from 'node:path';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { loadContractsFromDir, runContract } from '@contractqa/runner';

const BASE = process.env.CONTRACTQA_BASE_URL || 'http://localhost:4000';
const ROOT = process.env.CONTRACTQA_CONTRACTS_DIR || 'qa/contracts';

async function gatherDirs(root) {
  const out = [root];
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...await gatherDirs(path.join(root, e.name)));
    }
  }
  return out;
}

const dirs = await gatherDirs(ROOT);
const contracts = [];
for (const d of dirs) {
  try {
    const cs = await loadContractsFromDir(d);
    contracts.push(...cs);
  } catch {}
}
console.log(`Loaded ${contracts.length} contracts from ${ROOT}`);

const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-'));
const artifactsRoot = path.join(scratchDir, 'artifacts');

const browser = await chromium.launch({ headless: true });
const results = [];
let pass = 0, fail = 0, error = 0;

for (const c of contracts) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const before = path.join(scratchDir, `${c.id}-before.png`);
  const after = path.join(scratchDir, `${c.id}-after.png`);
  let verdict = 'ERROR';
  let detail = '';
  try {
    await page.goto('/');
    const result = await runContract({
      contract: c,
      page,
      stripBaseUrl: BASE,
      noise: {},
      artifactsRoot,
      screenshotPaths: { before, after },
    });
    verdict = result.verdict.verdict;
    detail = result.verdict.summary || JSON.stringify(result.verdict.failures || []).slice(0, 200);
  } catch (e) {
    detail = `THROW: ${(e.message || String(e)).slice(0, 200)}`;
  }
  await context.close();
  if (verdict === 'PASS') pass++;
  else if (verdict === 'FAIL') fail++;
  else error++;
  results.push({ id: c.id, area: c.area, severity: c.severity, verdict, detail });
  console.log(`[${verdict.padEnd(5)}] ${c.id}  ${detail.slice(0, 120)}`);
}

await browser.close();

console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${error} ERROR / ${contracts.length} total ===`);
const nonpass = results.filter(r => r.verdict !== 'PASS');
if (nonpass.length) {
  console.log('\n--- Non-pass details ---');
  for (const f of nonpass) {
    console.log(`${f.verdict.padEnd(5)} ${(f.severity || '-').padEnd(3)} ${f.id}\n        ${f.detail}`);
  }
}
