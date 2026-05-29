// discovery-gap-analysis.mjs — split the `not_covered` bugs (Entry 18: 50% of all
// bugs) into two root causes, WITHOUT re-running autopilot:
//
//   coverage_false_negative — a generated contract DOES target the bug's surface/
//     feature, but the coverage judge failed to match it (S8 sensitivity problem).
//   discovery_or_generation_gap — NO contract targets the bug's surface at all
//     (the agent never produced one — S1 discovery or S2 generation gap).
//
// Method (scoring/reflection side — allowed to see checklist+app): for each bug the
// coverage scorer marked covered:false, ask a grounded k-vote LLM whether any
// generated contract (by title/area) targets the SAME page/feature as the bug —
// even loosely, even if it wouldn't actually catch it. Surface-existence, not
// detection. This isolates "we never looked there" from "we looked but mis-scored".
//
// Usage: node scripts/eval/discovery-gap-analysis.mjs [--range 1-10] [--arm reflexion-on]

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = '/Users/zmy/intership/5.10+/qa-agent';
const FIX = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench';
const SNAP = path.join(FIX, 'snapshots');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]; if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    a[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return a;
}
const pad4 = (n) => String(n).padStart(4, '0');

function loadContracts(dir) {
  const out = [];
  (function rec(d) {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = path.join(d, e); const s = statSync(p);
      if (s.isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) { try { const c = parseYaml(readFileSync(p, 'utf8')); if (c?.id) out.push(c); } catch {} }
    }
  })(dir);
  return out;
}
function loadChecklist(idx) {
  const raw = readFileSync(path.join(FIX, 'WebTestBench.jsonl'), 'utf8');
  for (const l of raw.split('\n')) { if (!l.trim()) continue; const r = JSON.parse(l); if (r.index === `WebTestBench_${idx}`) return r; }
  throw new Error(`checklist ${idx} not found`);
}

// Grounded k-vote: does ANY contract target the bug's surface/feature?
async function judgeSurfaceExists(bug, content, contractLines, pickClient, k = 3) {
  const client = await pickClient();
  const sys = [
    'You are auditing test COVERAGE. Given a planted bug and a numbered list of test contracts (each: area | title), decide whether ANY contract targets the SAME page / feature / surface the bug is about.',
    'This is about surface OVERLAP, not whether the test would catch the bug — a contract that merely navigates to or asserts anything on the bug\'s feature counts as targeting its surface.',
    'Output STRICTLY one JSON object: {"surface_contract_ids": [<the [n] numbers that target the surface>], "reason": "one short sentence"}. Empty array = no contract goes anywhere near this feature.',
  ].join(' ');
  const user = [
    `PLANTED BUG: ${bug}`,
    `REQUIREMENT (the feature): ${content}`,
    `CONTRACTS (area | title):`,
    ...contractLines,
    'Which contracts (if any) target the same page/feature/surface as the bug?',
  ].join('\n');
  const votes = [];
  for (let i = 0; i < k; i++) {
    try {
      const r = await client.generate({ system: sys, messages: [{ role: 'user', content: user }] });
      const m = String(r.content).match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); votes.push({ has: Array.isArray(j.surface_contract_ids) && j.surface_contract_ids.length > 0, reason: j.reason || '' }); }
    } catch {}
  }
  if (!votes.length) return { surface_exists: false, reason: 'no votes', votes: '0/0' };
  const hasCount = votes.filter((v) => v.has).length;
  const surface_exists = hasCount * 2 > votes.length;
  return { surface_exists, reason: (votes.find((v) => v.has === surface_exists) || votes[0]).reason, votes: `${hasCount}/${votes.length} say surface exists` };
}

async function main() {
  const args = parseArgs(process.argv);
  const range = typeof args.range === 'string' ? args.range : '1-10';
  const arm = typeof args.arm === 'string' ? args.arm : 'reflexion-on';
  const [a, b] = range.split('-').map((s) => parseInt(s, 10));
  const { pickClient } = await import(path.join(ROOT, 'packages/orchestrator/dist/llm/pick-client.js'));

  const perApp = [];
  let totNotCovered = 0, totFalseNeg = 0, totGap = 0;
  for (let i = a; i <= b; i++) {
    const idx = pad4(i);
    const snapDir = path.join(SNAP, `${idx}-2026-05-29-${arm}-docker`);
    const scorePath = path.join(snapDir, 'score.json');
    const cDir = path.join(snapDir, 'qa', 'contracts');
    if (!existsSync(scorePath) || !existsSync(cDir)) { console.error(`[${idx}] skip (no snapshot)`); continue; }
    const score = JSON.parse(readFileSync(scorePath, 'utf8'));
    const checklist = loadChecklist(idx);
    const contracts = loadContracts(cDir);
    const lines = contracts.map((c, n) => `  [${n + 1}] ${c.area || '?'} | ${c.title || c.id}`);
    // not_covered bugs = pass:false items the coverage judge marked covered:false
    const notCovered = score.coverage.filter((c) => c.pass === false && !c.covered);
    const items = [];
    for (const cov of notCovered) {
      const j = await judgeSurfaceExists(cov.content + (checklist.checklist.find((x) => x.id === cov.checklist_id)?.bug ? ` (bug: ${checklist.checklist.find((x) => x.id === cov.checklist_id).bug})` : ''), cov.content, lines, pickClient);
      const cls = j.surface_exists ? 'coverage_false_negative' : 'discovery_or_generation_gap';
      process.stderr.write(`[${idx}] bug#${cov.checklist_id}: ${cls} (${j.votes})\n`);
      items.push({ bug_id: cov.checklist_id, content: cov.content, classification: cls, votes: j.votes, reason: j.reason });
    }
    const fn = items.filter((x) => x.classification === 'coverage_false_negative').length;
    const gap = items.length - fn;
    totNotCovered += items.length; totFalseNeg += fn; totGap += gap;
    perApp.push({ idx, not_covered: items.length, coverage_false_negative: fn, discovery_or_generation_gap: gap, items });
    console.log(`[${idx}] not_covered=${items.length} → false_neg=${fn}, true_gap=${gap}`);
  }

  console.log('\n=== DISCOVERY-GAP ANALYSIS (not_covered bugs) ===');
  console.log(`total not_covered: ${totNotCovered}`);
  console.log(`  coverage_false_negative (contract for surface exists, judge missed): ${totFalseNeg} (${(100 * totFalseNeg / totNotCovered).toFixed(0)}%)`);
  console.log(`  discovery_or_generation_gap (no contract for surface at all):        ${totGap} (${(100 * totGap / totNotCovered).toFixed(0)}%)`);
  const outPath = path.join(ROOT, 'qa/eval/entry13-logs/discovery-gap-analysis.json');
  writeFileSync(outPath, JSON.stringify({ totNotCovered, totFalseNeg, totGap, perApp }, null, 2));
  console.log(`→ ${outPath}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
