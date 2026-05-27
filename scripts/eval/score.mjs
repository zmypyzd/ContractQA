#!/usr/bin/env node
// Eval scorer for ContractQA autopilot.
// Reads frozen ground truth from qa/eval/<project>/ground-truth/ and a fresh
// autopilot output set, emits the 6 metrics defined in qa/eval/schema.md.
//
// Usage:
//   node scripts/eval/score.mjs \
//     --project wolfmind \
//     --autopilot-dir qa/contracts \
//     [--out qa/eval/wolfmind/score-YYYY-MM-DD.json]

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    args[key] = val;
  }
  return args;
}

function walkYaml(root) {
  const out = [];
  function rec(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) rec(p);
      else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) out.push(p);
    }
  }
  rec(root);
  return out;
}

function loadContracts(dir) {
  const files = walkYaml(dir);
  return files.map((f) => {
    const raw = readFileSync(f, 'utf8');
    const doc = parseYaml(raw) ?? {};
    return { file: f, ...doc };
  });
}

function normalizePath(p) {
  if (typeof p !== 'string') return '';
  let s = p.toLowerCase();
  // Strip API version prefix so /api/v1/x ↔ /x match. Agents inconsistently
  // include the prefix depending on prompt phrasing; the underlying endpoint
  // is the same. Strips `/api/v<digits>` at start.
  s = s.replace(/^\/api\/v\d+/, '');
  // Normalize URL templates: /{tableId} → /:tableId so OpenAPI-style and
  // colon-style agents match on the same path.
  s = s.replace(/\{([^}]+)\}/g, ':$1');
  const [base, query = ''] = s.split('?');
  const noTrail = base.endsWith('/') && base.length > 1 ? base.slice(0, -1) : base;
  const qs = query
    ? '?' + query.split('&').filter(Boolean).sort().join('&')
    : '';
  return noTrail + qs;
}

function actionPaths(c) {
  return Array.isArray(c.actions)
    ? c.actions
        .map((a) => normalizePath(a?.path ?? ''))
        .filter(Boolean)
        .join('|')
    : '';
}

function fingerprint(c) {
  const area = (c.area ?? '').toLowerCase();
  const paths = actionPaths(c);
  const expected = JSON.stringify(c.expected ?? {}, Object.keys(c.expected ?? {}).sort());
  return `${area}::${paths}::${expected}`;
}

// Weak fingerprint = area + action paths only (no expected). Two contracts
// with the same area and same target endpoints almost always test the same
// thing, even when expected blocks differ. Used as a 3rd-tier match to
// recover from LLM-invented IDs and divergent expected shapes — without
// it, agents that emit INV-AUTH-1 against GT api-auth-login-* always
// score tp=0 even when semantically aligned. See score-2026-05-27-
// stream1-2.json + commit 6dcf10a for the motivating case.
function weakFingerprint(c) {
  const area = (c.area ?? '').toLowerCase();
  const paths = actionPaths(c);
  return `${area}::${paths}`;
}

// Apply duplicates_of from GT to collapse identifiers. Returns a Map<id, canonicalId>.
function buildDupMap(gt) {
  const map = new Map();
  for (const c of gt) {
    if (c.provenance?.status === 'merged' && Array.isArray(c.provenance.duplicates_of)) {
      const canonical = c.provenance.duplicates_of[0];
      if (canonical) map.set(c.id, canonical);
    }
  }
  // resolve transitive
  for (const k of [...map.keys()]) {
    let seen = new Set([k]);
    let cur = map.get(k);
    while (cur && map.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = map.get(cur);
    }
    if (cur) map.set(k, cur);
  }
  return map;
}

function canonicalId(id, dupMap) {
  return dupMap.get(id) ?? id;
}

function matchAgainstGT(agentContract, gtApproved, dupMap, opts = {}) {
  const { weakMatch = true } = opts;
  const aId = canonicalId(agentContract.id, dupMap);
  const aFp = fingerprint(agentContract);
  const aWfp = weakFingerprint(agentContract);
  // Tier 1: canonical id
  for (const g of gtApproved) {
    if (canonicalId(g.id, dupMap) === aId) return { hit: g, matchType: 'id' };
  }
  // Tier 2: full fingerprint (area + paths + expected)
  for (const g of gtApproved) {
    if (fingerprint(g) === aFp) return { hit: g, matchType: 'fingerprint' };
  }
  // Tier 3: weak fingerprint (area + paths only). Skip if path component is
  // empty — would over-match contracts whose actions have no path (e.g.
  // click-only DOM-test contracts). Skip if weakMatch=false.
  if (weakMatch && aWfp.endsWith('::') === false) {
    for (const g of gtApproved) {
      if (weakFingerprint(g) === aWfp) return { hit: g, matchType: 'weak-fingerprint' };
    }
  }
  return null;
}

function score({ project, autopilotDir, evalRoot }) {
  const gtDir = resolve(evalRoot, project, 'ground-truth');
  let gt = [];
  try {
    gt = loadContracts(gtDir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const gtEmpty = gt.length === 0;

  const dupMap = buildDupMap(gt);
  const gtApproved = gt.filter((c) => c.provenance?.status === 'approved');
  const gtDropped = gt.filter((c) => c.provenance?.status === 'dropped');
  const gtMerged = gt.filter((c) => c.provenance?.status === 'merged');
  const gtHuman = gtApproved.filter(
    (c) => c.provenance?.source === 'human-explore',
  );

  // Build lookup tables keyed by canonical id + fingerprint for dropped/merged.
  const droppedById = new Set(gtDropped.map((c) => c.id));
  const droppedByFp = new Set(gtDropped.map((c) => fingerprint(c)));
  const mergedById = new Set(gtMerged.map((c) => c.id));
  const mergedByFp = new Set(gtMerged.map((c) => fingerprint(c)));

  const agent = loadContracts(autopilotDir);

  let tp = 0;
  const tpByTier = { id: 0, fingerprint: 0, 'weak-fingerprint': 0 };
  let tpHuman = 0;
  let fp = 0;
  let dup = 0;
  const severityHits = [];
  const matchedGtIds = new Set();
  const weakMatches = [];  // [{agentId, gtId, area, paths}] for inspection

  for (const a of agent) {
    if (droppedById.has(a.id) || droppedByFp.has(fingerprint(a))) {
      fp++;
      continue;
    }
    if (mergedById.has(a.id) || mergedByFp.has(fingerprint(a))) {
      dup++;
      continue;
    }
    const m = matchAgainstGT(a, gtApproved, dupMap);
    if (m) {
      tp++;
      tpByTier[m.matchType]++;
      matchedGtIds.add(canonicalId(m.hit.id, dupMap));
      if (m.matchType === 'weak-fingerprint') {
        weakMatches.push({
          agentId: a.id,
          gtId: m.hit.id,
          area: (a.area ?? '').toLowerCase(),
          paths: actionPaths(a),
        });
      }
      if (m.hit.provenance?.source === 'human-explore') tpHuman++;
      const so = m.hit.review?.severity_original;
      const sf = m.hit.review?.severity_final;
      if (so && sf) severityHits.push(so === sf ? 1 : 0);
    }
  }

  const A = agent.length;
  const GT = gtApproved.length;
  const GT_human = gtHuman.length;

  const precision = A === 0 ? null : tp / A;
  const recall = GT === 0 ? null : tp / GT;
  const net_new_recall = GT_human === 0 ? null : tpHuman / GT_human;
  const fp_rate = A === 0 ? null : fp / A;
  const dedup_inflation = A === 0 ? null : dup / A;
  const severity_agree =
    severityHits.length === 0
      ? null
      : severityHits.reduce((a, b) => a + b, 0) / severityHits.length;

  return {
    project,
    gt_empty: gtEmpty,
    counts: {
      agent_output: A,
      gt_approved: GT,
      gt_approved_human: GT_human,
      gt_dropped: gtDropped.length,
      gt_merged: gtMerged.length,
      tp,
      tp_human: tpHuman,
      tp_by_match_tier: tpByTier,
      fp,
      dup,
    },
    weak_matches: weakMatches,
    metrics: {
      precision,
      recall,
      net_new_recall,
      fp_rate,
      dedup_inflation,
      severity_agree,
    },
    missed_gt: gtApproved
      .filter((c) => !matchedGtIds.has(canonicalId(c.id, dupMap)))
      .map((c) => ({ id: c.id, category: c.category, source: c.provenance?.source })),
  };
}

function fmt(n) {
  return n === null ? 'n/a' : n.toFixed(3);
}

function main() {
  const args = parseArgs(process.argv);
  const project = args.project;
  const autopilotDir = args['autopilot-dir'] ?? 'qa/contracts';
  const evalRoot = args['eval-root'] ?? 'qa/eval';
  if (!project) {
    console.error('usage: score.mjs --project <slug> [--autopilot-dir qa/contracts] [--eval-root qa/eval] [--out path.json]');
    process.exit(2);
  }
  const result = score({
    project,
    autopilotDir: resolve(autopilotDir),
    evalRoot: resolve(evalRoot),
  });

  const { metrics, counts } = result;
  console.log(`\nProject: ${result.project}`);
  if (result.gt_empty) {
    console.log(`  [warn] ground-truth/ is empty — review step 2 not started. Agent output: ${counts.agent_output}.`);
    console.log(`         Fill qa/eval/${result.project}/ground-truth/ then re-run.`);
    if (args.out) {
      writeFileSync(resolve(args.out), JSON.stringify(result, null, 2));
      console.log(`\nWrote ${args.out}`);
    }
    return;
  }
  console.log(`  A (agent output):      ${counts.agent_output}`);
  console.log(`  GT (approved):         ${counts.gt_approved}  (human-explore: ${counts.gt_approved_human})`);
  console.log(`  TP / FP / Dup:         ${counts.tp} / ${counts.fp} / ${counts.dup}`);
  console.log(`\nMetrics:`);
  console.log(`  precision:             ${fmt(metrics.precision)}`);
  console.log(`  recall:                ${fmt(metrics.recall)}`);
  console.log(`  net_new_recall:        ${fmt(metrics.net_new_recall)}   ← honest blind-spot signal`);
  console.log(`  fp_rate:               ${fmt(metrics.fp_rate)}`);
  console.log(`  dedup_inflation:       ${fmt(metrics.dedup_inflation)}`);
  console.log(`  severity_agree:        ${fmt(metrics.severity_agree)}`);

  if (result.missed_gt.length) {
    console.log(`\nMissed GT (${result.missed_gt.length}):`);
    for (const m of result.missed_gt) {
      console.log(`  - ${m.id}  [${(m.category ?? []).join(',')}]  (${m.source})`);
    }
  }

  if (args.out) {
    writeFileSync(resolve(args.out), JSON.stringify(result, null, 2));
    console.log(`\nWrote ${args.out}`);
  }
}

main();
