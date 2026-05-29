// assertion-gap-fingerprints.mjs — Entry 19 next step. The bottleneck is assertion
// specificity: contracts reach the bug's surface but assert the wrong/weak thing.
// This characterizes HOW they're weak, into a fixed fingerprint taxonomy, so we can
// design an assertion-specificity generation pass.
//
// For each planted bug (pass:false) that has ≥1 contract on its surface, a grounded
// LLM (scoring/reflection side — may see checklist+app) picks the closest contract,
// states what it asserts vs what assertion WOULD catch the bug, and classifies the
// gap. Output: a fingerprint histogram + examples.
//
// Usage: node scripts/eval/assertion-gap-fingerprints.mjs [--range 1-10] [--arm reflexion-on]

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const FIX = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench';
const SNAP = path.join(FIX, 'snapshots');

function parseArgs(argv) { const a = {}; for (let i = 2; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) continue; a[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } return a; }
const pad4 = (n) => String(n).padStart(4, '0');

function loadContracts(dir) {
  const out = [];
  (function rec(d) { if (!existsSync(d)) return; for (const e of readdirSync(d)) { const p = path.join(d, e); const s = statSync(p); if (s.isDirectory()) rec(p); else if (e.endsWith('.yml') || e.endsWith('.yaml')) { try { const c = parseYaml(readFileSync(p, 'utf8')); if (c?.id) out.push(c); } catch {} } } })(dir);
  return out;
}
function loadChecklist(idx) { const raw = readFileSync(path.join(FIX, 'WebTestBench.jsonl'), 'utf8'); for (const l of raw.split('\n')) { if (!l.trim()) continue; const r = JSON.parse(l); if (r.index === `WebTestBench_${idx}`) return r; } throw new Error(`checklist ${idx}`); }
function expectedSummary(c) { try { return JSON.stringify(c.expected || {}).slice(0, 180); } catch { return '{}'; } }

const TAXONOMY = `
  F1_presence_not_value: asserts an element/text EXISTS but not its CORRECTNESS, while the bug is a wrong/stale VALUE.
  F2_happy_path_not_violation: asserts the normal flow; never exercises the negative/edge/constraint the bug violates (e.g. duplicate-registration, validation, ordering).
  F3_wrong_element: asserts on a different element/section than where the bug manifests.
  F4_generic_render: only asserts the page renders / contains a generic string — no bug-relevant invariant.
  F5_single_view_not_consistency: bug is cross-view/consistency; contract checks one view only.
  F6_missing_interaction: bug manifests only after an action (click/submit/switch) the contract never performs.
  F7_other: none of the above.`;

async function judgeFingerprint(bug, content, lines, pickClient) {
  const client = await pickClient();
  const sys = [
    'You diagnose WHY a UI test suite would miss a planted bug. You are given the bug, the requirement, and the full list of generated contracts (area | title | expected-assertion-JSON).',
    'Pick the SINGLE contract closest to the bug\'s surface. State concisely what it actually asserts, and what specific assertion WOULD catch the bug. Then classify the assertion gap into exactly one fingerprint code from this taxonomy:',
    TAXONOMY,
    'Output STRICTLY one JSON object: {"closest_contract": "<id-or-title>", "asserts": "<short>", "needed": "<short>", "fingerprint": "F1_presence_not_value|F2_happy_path_not_violation|F3_wrong_element|F4_generic_render|F5_single_view_not_consistency|F6_missing_interaction|F7_other"}.',
  ].join('\n');
  const user = [`PLANTED BUG: ${bug}`, `REQUIREMENT: ${content}`, `CONTRACTS (area | title | expected):`, ...lines, 'Diagnose the assertion gap.'].join('\n');
  try {
    const r = await client.generate({ system: sys, messages: [{ role: 'user', content: user }] });
    const m = String(r.content).match(/\{[\s\S]*\}/);
    if (!m) return { fingerprint: 'F7_other', asserts: '', needed: '', closest_contract: '', reason: 'non-JSON' };
    return JSON.parse(m[0]);
  } catch (e) { return { fingerprint: 'F7_other', asserts: '', needed: '', closest_contract: '', reason: String(e.message || e).slice(0, 80) }; }
}

async function main() {
  const args = parseArgs(process.argv);
  const range = typeof args.range === 'string' ? args.range : '1-10';
  const arm = typeof args.arm === 'string' ? args.arm : 'reflexion-on';
  const [a, b] = range.split('-').map((s) => parseInt(s, 10));
  const { pickClient } = await import(path.join(ROOT, 'packages/orchestrator/dist/llm/pick-client.js'));
  // true discovery gaps (no surface contract) — skip; this analysis is about assertion gaps
  const trueGaps = new Set(['0007:6', '0009:16', '0010:16']);

  const fp = {}; const examples = {}; const all = [];
  for (let i = a; i <= b; i++) {
    const idx = pad4(i);
    const snapDir = path.join(SNAP, `${idx}-2026-05-29-${arm}-docker`);
    const cDir = path.join(snapDir, 'qa', 'contracts');
    if (!existsSync(cDir)) { console.error(`[${idx}] skip`); continue; }
    const checklist = loadChecklist(idx);
    const contracts = loadContracts(cDir);
    const lines = contracts.map((c) => `  ${c.area || '?'} | ${c.title || c.id} | ${expectedSummary(c)}`);
    for (const item of checklist.checklist.filter((x) => x.pass === false)) {
      if (trueGaps.has(`${idx}:${item.id}`)) continue;
      const j = await judgeFingerprint(item.bug || item.content, item.content, lines, pickClient);
      const code = j.fingerprint || 'F7_other';
      fp[code] = (fp[code] || 0) + 1;
      if (!examples[code]) examples[code] = `[${idx}#${item.id}] bug="${(item.bug || item.content).slice(0, 70)}" | asserts="${(j.asserts || '').slice(0, 60)}" | needed="${(j.needed || '').slice(0, 60)}"`;
      all.push({ idx, bug_id: item.id, ...j });
      process.stderr.write(`[${idx}] bug#${item.id}: ${code}\n`);
    }
  }
  const total = Object.values(fp).reduce((s, x) => s + x, 0);
  console.log('\n=== ASSERTION-GAP FINGERPRINTS (bugs with a surface contract) ===');
  for (const [k, v] of Object.entries(fp).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${k.padEnd(34)} ${String(v).padStart(3)} (${(100 * v / total).toFixed(0)}%)`);
    if (examples[k]) console.log(`        e.g. ${examples[k]}`);
  }
  console.log(`  total: ${total}`);
  const outPath = path.join(ROOT, 'qa/eval/entry13-logs/assertion-gap-fingerprints.json');
  writeFileSync(outPath, JSON.stringify({ histogram: fp, examples, all }, null, 2));
  console.log(`→ ${outPath}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
