#!/usr/bin/env node
// Second-pass auto-decision for FAIL contracts using SUT source code as
// evidence of intent.
//
// For each FAIL with no ground-truth yet:
//   - Extract every actions[*].path (goto + http).
//   - Extract every actions[*].target.name_regex.
//   - Search the fixture's apps/api/src/routes and apps/web/src for matches.
//   - Decision:
//       evidence-of-route     → approved (intent valid; failure is state/selector)
//       evidence-of-text-only → approved (UI element likely exists)
//       no-evidence          → dropped (probable hallucination)
//
// "Evidence" is intentionally loose — a single grep hit. The point is to
// drain the obvious hallucinations vs obvious-real cases. Anything still
// ambiguous is left for the human walker.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const RUN_LOG = '/tmp/run-2026-05-25-v4-with-oracle.log';
const SUT_API = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/apps/api/src';
const SUT_WEB = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/apps/web/src';
const REVIEWER = 'eval-automation';

function walk(root) {
  const out = [];
  (function rec(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) out.push(p);
    }
  })(root);
  return out;
}

function loadFailed() {
  const log = readFileSync(RUN_LOG, 'utf8');
  const failed = new Set();
  for (const m of log.matchAll(/^\s+✘\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) failed.add(m[1]);
  return failed;
}

// shell-safe grep: pattern → bool (any hit)
function greps(pattern, paths) {
  try {
    const escaped = pattern.replace(/'/g, "'\"'\"'");
    const cmd = `grep -RlE -- '${escaped}' ${paths.join(' ')} 2>/dev/null | head -1`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    return out.trim().length > 0;
  } catch { return false; }
}

// Normalise a contract's goto/http paths into route templates the SUT might
// have. Replace dynamic id segments with a regex pattern.
function pathPatterns(p) {
  if (typeof p !== 'string' || !p) return [];
  // Strip /api/v1 prefix (api server mounts routes WITHOUT this in source).
  const stripped = p.replace(/^\/api\/v\d+/, '');
  // Replace path params with a non-greedy capture for grep.
  const r = stripped.replace(/\/[^/]+-id|\/[a-f0-9-]{8,}|\/\d+|\/:[a-zA-Z]+/g, '/[^/]+');
  return [
    // literal match (for static routes like /health, /werewolf)
    stripped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    // wildcarded route (for /tables/:id/seats etc.)
    r.replace(/[.*+?^${}()|[\]\\]/g, (m) => m === '[' || m === ']' || m === '^' ? m : '\\' + m).replace(/\\\[\\\^\\\/\\\]\\\+/g, '[^/]+'),
  ];
}

// Search the agent's name_regex for a concrete token, then grep that token
// in the web source as a heuristic for "this UI element exists".
function nameTokens(re) {
  if (typeof re !== 'string' || !re) return [];
  return re
    .replace(/\(\?[a-zA-Z]+\)/g, '')       // drop inline flags
    .split(/[|\\^$()?*+{}.[\]]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && /[a-zA-Z一-鿿]/.test(t));
}

function categorize(doc) {
  const c = [];
  const exp = doc?.expected ?? {};
  if (exp.auth_state || doc.preconditions?.auth_state === 'logged_in') c.push('auth-boundary');
  if (exp.url?.matches) c.push('happy-path');
  if (exp.dom?.contains_text?.some?.((t) => /error|fail|unauth|forbid|not.found|404|500|invalid/i.test(t))) c.push('error-state');
  if (c.length === 0) c.push('happy-path');
  return c;
}

function write(doc, status, opts) {
  const now = new Date().toISOString();
  const gt = {
    ...doc,
    category: categorize(doc),
    provenance: {
      source: 'autopilot',
      generated_at: now,
      reviewed_by: REVIEWER,
      reviewed_at: now,
      status,
      duplicates_of: opts.duplicatesOf ?? [],
    },
    review: {
      validity: opts.validity ?? (status === 'dropped' ? 'fp' : 'tp'),
      validity_verified_in_product: false,
      specificity: opts.specificity ?? (status === 'approved' ? 2 : 1),
      severity_original: doc.severity ?? 'P3',
      severity_final: doc.severity ?? 'P3',
      notes: opts.notes ?? '',
    },
  };
  writeFileSync(join(GT_DIR, `${doc.id}.yml`), toYaml(gt));
}

const failed = loadFailed();
const all = walk(FIXTURE).map((f) => {
  try {
    const doc = parseYaml(readFileSync(f, 'utf8'));
    if (!doc?.id) return null;
    return { f, doc };
  } catch { return null; }
}).filter(Boolean);

const remaining = all.filter((x) => failed.has(x.doc.id) && !existsSync(join(GT_DIR, `${x.doc.id}.yml`)));

console.log(`Examining ${remaining.length} unresolved FAILs against SUT source...\n`);

const stats = { approvedRoute: 0, approvedText: 0, dropped: 0, skipped: 0 };

for (const { doc } of remaining) {
  const actions = doc.actions ?? [];
  const paths = actions.flatMap((a) => (a.type === 'goto' || a.type === 'http') && a.path ? pathPatterns(a.path) : []);
  const texts = actions.flatMap((a) => a.target?.name_regex ? nameTokens(a.target.name_regex) : []);

  let routeHit = false;
  let textHit = false;
  for (const p of paths) {
    if (greps(`['"\`]${p}['"\`]`, [SUT_API, SUT_WEB])) { routeHit = true; break; }
  }
  if (!routeHit) {
    for (const p of paths) {
      // looser: just substring match in route files
      if (greps(p, [SUT_API + '/routes', SUT_WEB + '/router.tsx', SUT_WEB + '/pages'])) { routeHit = true; break; }
    }
  }
  if (!routeHit) {
    for (const t of texts) {
      if (greps(t, [SUT_WEB])) { textHit = true; break; }
    }
  }

  if (routeHit) {
    write(doc, 'approved', { specificity: 2, notes: `FAIL but path "${paths[0]}" exists in SUT source — intent likely valid, failure is state/selector. PENDING verified_in_product flip.` });
    stats.approvedRoute++;
  } else if (textHit && (doc.preconditions?.auth_state === 'logged_in')) {
    write(doc, 'approved', { specificity: 2, notes: `FAIL but selector text exists in SUT web source — UI element probably real, contract may need richer state. PENDING verified_in_product flip.` });
    stats.approvedText++;
  } else if (paths.length === 0 && texts.length === 0) {
    // Action sequence with no path/text — can't evidence anything
    stats.skipped++;
  } else {
    // No evidence found anywhere
    write(doc, 'dropped', { validity: 'fp', specificity: 0, notes: `FAIL with no SUT source evidence: paths=${JSON.stringify(paths.slice(0,3))} texts=${JSON.stringify(texts.slice(0,3))}. Likely hallucination.` });
    stats.dropped++;
  }
}

console.log(`Auto-decided FAILs: ${stats.approvedRoute} approved-by-route + ${stats.approvedText} approved-by-text + ${stats.dropped} dropped + ${stats.skipped} skipped`);
console.log();
console.log(`Total ground-truth now: ${readdirSync(GT_DIR).filter(f => f.endsWith('.yml')).length} / 369`);
