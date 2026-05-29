import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { loadContractsFromDir, runContract } from '@contractqa/runner';

const BASE = process.env.CONTRACTQA_BASE_URL || 'http://localhost:4000';
const CONTRACTS_DIR = process.env.CONTRACTQA_CONTRACTS_DIR || 'qa/contracts';

const contracts = await loadContractsFromDir(CONTRACTS_DIR);
console.log(`Loaded ${contracts.length} contracts from ${CONTRACTS_DIR}`);

const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-'));
const artifactsRoot = path.join(scratchDir, 'artifacts');

const browser = await chromium.launch({ headless: true });
const results = [];
let pass = 0, fail = 0;

for (const c of contracts) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  try {
    await page.goto('/');
  } catch (e) {
    console.error(`[${c.id}] failed initial goto: ${e.message}`);
  }
  let verdict = 'ERROR';
  let detail = '';
  try {
    const result = await runContract({
      contract: c,
      page,
      stripBaseUrl: BASE,
      noise: {},
      artifactsRoot,
    });
    verdict = result.verdict.verdict;
    detail = result.verdict.summary || '';
  } catch (e) {
    detail = `THROW: ${e.message?.slice(0, 200) || e}`;
  }
  await context.close();
  if (verdict === 'PASS') pass++; else fail++;
  results.push({ id: c.id, area: c.area, severity: c.severity, verdict, detail });
  const tag = verdict === 'PASS' ? 'PASS' : verdict;
  console.log(`[${tag}] ${c.id}  ${detail.slice(0, 120)}`);
}

await browser.close();

console.log(`\n=== ${pass} PASS / ${fail} non-pass / ${contracts.length} total ===`);
const failures = results.filter(r => r.verdict !== 'PASS');
if (failures.length) {
  console.log('\n--- Non-pass details ---');
  for (const f of failures) {
    console.log(`${f.verdict.padEnd(6)} ${f.severity || '-'} ${f.id}\n        ${f.detail}`);
  }
}
