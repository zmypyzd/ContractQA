#!/usr/bin/env node
// Intent-judge: classify each contract against three intent-side criteria
// (self-consistency, reasonable-invariant, sharpness) WITHOUT consulting the
// SUT. This re-frames ground-truth as "should the product satisfy this?"
// rather than "does the SUT currently match?". The SUT may have bugs;
// they're orthogonal to GT.
//
// Output:
//   qa/eval/poker/run-log/2026-05-25-intent-judge.md
//   - headline: total / agreement / disagreement / borderline counts
//   - "Disagreements" section: GT says X, intent-judge says Y, with reasoning
//   - "Borderline" section: needs human, fewest in number
//   - per-id appendix with all the input flags
//
// No GT files are modified. You review the report and decide what to apply.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const OUT = 'qa/eval/poker/run-log/2026-05-25-intent-judge.md';

const SCHEMA_KEYS = {
  url: ['matches'], localStorage: ['no_key_matches', 'has_key_matches'],
  sessionStorage: ['no_key_matches'], cookies: ['no_name_matches'],
  dom: ['not_contains_any', 'contains_all', 'contains_text', 'not_contains_text', 'role_count'],
  auth_state: ['fully_logged_out'], backend_state: ['named_query', 'params', 'assert'],
  watch_keys: ['localStorage', 'cookies'],
};
const NOISE_NEEDLES = new Set(['data', 'ok', 'OK', 'error', 'Error', 'true', 'false', 'null', '0', '1', 'id', 'yes', 'no', 'on', 'off']);

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

// ── (1) Sharpness: would this assertion catch any real product mistake?
function sharpnessFlags(doc) {
  const flags = [];
  const exp = doc?.expected ?? {};

  // unknown sub-keys → silently dropped by ExpectedBlock → zero assertion
  for (const k of Object.keys(exp)) {
    const allowed = SCHEMA_KEYS[k];
    if (!allowed) { flags.push(`silent:top-key-${k}`); continue; }
    if (typeof exp[k] === 'object' && exp[k] !== null) {
      for (const sk of Object.keys(exp[k])) if (!allowed.includes(sk)) flags.push(`silent:${k}.${sk}`);
    }
  }

  // url.matches: ".*" or "^$" or empty → no-op
  const m = exp.url?.matches;
  if (typeof m === 'string') {
    if (m === '.*' || m === '.*?' || m === '' || m === '^$' || m === '^.*$') flags.push('weak:trivial-url-regex');
  }

  // dom.contains_text: empty array or all noise tokens
  const ct = exp.dom?.contains_text;
  if (Array.isArray(ct)) {
    if (ct.length === 0) flags.push('weak:empty-contains-text');
    else if (ct.every((t) => typeof t === 'string' && NOISE_NEEDLES.has(t))) flags.push('weak:noise-needles-only');
    else if (ct.every((t) => typeof t === 'string' && t.length <= 2)) flags.push('weak:micro-needles');
  }

  // dom.not_contains_text empty
  const nct = exp.dom?.not_contains_text;
  if (Array.isArray(nct) && nct.length === 0) flags.push('weak:empty-not-contains-text');

  return flags;
}

// ── (2) Self-consistency: does the body actually exercise what the title claims?
function selfConsistencyFlags(doc) {
  const flags = [];
  const title = (doc?.title ?? '').toLowerCase();
  const actions = doc?.actions ?? [];
  const actionTypes = new Set(actions.map((a) => a.type));
  const actionTexts = actions.map((a) => JSON.stringify(a)).join(' ').toLowerCase();
  const exp = doc?.expected ?? {};

  // Title mentions a keyboard interaction but no fill/wait+specific-key
  if (/\b(escape|enter|tab|arrow|keyboard|key press|presses?)\b/.test(title)) {
    if (!actions.some((a) => a.type === 'fill' || (a.type === 'wait' && a.ms > 0))) {
      // we don't model key actions in contract DSL — flag as potential mismatch
      flags.push('mismatch:title-says-keyboard-but-no-key-action');
    }
  }

  // Title says "redirects" or "navigates" but no expected.url
  if (/\b(redirect|navigates?|goes to|sends? to)\b/.test(title) && !exp.url?.matches) {
    flags.push('mismatch:title-says-navigation-but-no-url-assertion');
  }

  // Title says "displays" / "shows" / "renders" but no dom assertion
  if (/\b(displays?|shows?|renders?|appears?|visible)\b/.test(title) && !exp.dom && !exp.url) {
    flags.push('mismatch:title-says-visible-but-no-dom-or-url-assertion');
  }

  // Title says "disabled" / "hidden" but expected only has positive presence
  if (/\b(disabled|hidden|removed|cleared)\b/.test(title) && exp.dom?.contains_text && !exp.dom?.not_contains_text && !exp.dom?.role_count) {
    flags.push('mismatch:title-says-removal-but-asserts-presence');
  }

  // Title mentions status code (404, 401, etc) but expected has no http_status proxy
  // (since http_status isn't schema-recognized anyway, this is informative not lethal)
  const statusInTitle = title.match(/\b(2\d\d|3\d\d|4\d\d|5\d\d)\b/);
  if (statusInTitle && !exp.dom && !exp.url) {
    flags.push(`info:title-mentions-${statusInTitle[1]}-no-dom-or-url`);
  }

  // http action + dom assertion (dom-after-http) — captured already by sharpness but worth marking
  const hasGoto = actions.some((a) => a.type === 'goto');
  const hasHttp = actions.some((a) => a.type === 'http');
  if (hasHttp && !hasGoto && exp.dom) flags.push('mismatch:dom-assertion-on-http-only-action');

  return flags;
}

// ── (3) Reasonable invariant: does the title describe an assertion a product owner would want?
function reasonableInvariantSignals(doc) {
  const signals = { strong: [], weak: [] };
  const title = (doc?.title ?? '').toLowerCase();
  const id = (doc?.id ?? '').toLowerCase();

  // Strong: universal product invariants
  const STRONG_PATTERNS = [
    { re: /requires?\s+auth|requires?\s+(login|bearer|token|csrf|session)/, why: 'auth/csrf boundary' },
    { re: /returns?\s+(401|403|404|400|429)|rejects?|not\s+found|forbidden|unauth/i, why: 'security/error response' },
    { re: /validates?|invalid|rejects?\s+invalid/, why: 'input validation' },
    { re: /strips?\s+(seed|private|secret)|excludes?\s+(seed|sensitive)|no\s+secret/, why: 'data leak prevention' },
    { re: /redirects?\s+(to|when)|navigates?\s+to/, why: 'navigation invariant' },
    { re: /no_key_matches|no_name_matches|fully_logged_out/, why: 'auth-state invariant' },
  ];
  for (const p of STRONG_PATTERNS) if (p.re.test(title) || p.re.test(id)) signals.strong.push(p.why);

  // Weak: optional or implementation-specific invariants (still potentially valid, just less universal)
  const WEAK_PATTERNS = [
    { re: /focus|aria-pressed|aria-expanded|tab\s+order/, why: 'a11y detail (valid but secondary)' },
    { re: /default\s+value|placeholder|tooltip/, why: 'UI detail (often not load-bearing)' },
    { re: /preset|shortcut|quick\s+action/, why: 'UI affordance (optional feature)' },
    { re: /tab|toggle|switch.*tab/, why: 'tab-switching UI (specific to current layout)' },
  ];
  for (const p of WEAK_PATTERNS) if (p.re.test(title) || p.re.test(id)) signals.weak.push(p.why);

  return signals;
}

// ── Final verdict for a contract
function judge(doc) {
  const sharp = sharpnessFlags(doc);
  const consistency = selfConsistencyFlags(doc);
  const invariant = reasonableInvariantSignals(doc);

  const hardSharp = sharp.filter((f) => f.startsWith('silent:') || f === 'weak:trivial-url-regex' || f === 'weak:noise-needles-only' || f === 'weak:empty-contains-text' || f === 'weak:empty-not-contains-text');
  const hardMismatch = consistency.filter((f) => f.startsWith('mismatch:'));

  // Special case: dom-assertion-on-http-only-action is a RUNNER DSL gap, not
  // an intent failure. The agent identified a real product invariant
  // (often an API/auth/validation rule) but tried to express it via
  // dom.contains_text on a non-navigating http action. If the title has
  // strong invariant keywords, the intent is real → KEEP. Treat the dom
  // mismatch as a "needs-expression-fix" annotation, not a kill.
  const onlyDomAfterHttp = hardMismatch.length === 1 && hardMismatch[0] === 'mismatch:dom-assertion-on-http-only-action';
  if (onlyDomAfterHttp && invariant.strong.length > 0 && hardSharp.length === 0) {
    return {
      verdict: 'KEEP', confidence: 'medium',
      why: `intent valid (${invariant.strong.join(', ')}); expression uses dom on http-only action — runner DSL gap, not intent failure`,
      flags: { sharp, consistency, invariant },
    };
  }
  if (onlyDomAfterHttp && invariant.strong.length === 0 && hardSharp.length === 0) {
    // dom-after-http but no obvious invariant signal — borderline, let user decide
    return {
      verdict: 'BORDERLINE', confidence: 'low',
      why: 'expression uses dom on http-only action AND title gives no strong invariant signal — could be intent-valid or vague test',
      flags: { sharp, consistency, invariant },
    };
  }

  // Other hard mismatches (self-contradictions like "Escape closes" with no
  // key press, "redirects" with no url, etc) are real intent failures
  const otherMismatch = hardMismatch.filter((f) => f !== 'mismatch:dom-assertion-on-http-only-action');
  if (otherMismatch.length > 0) {
    return { verdict: 'DROP', confidence: 'high', why: `self-consistency: ${otherMismatch.join(', ')}`, flags: { sharp, consistency, invariant } };
  }

  // Decisive DROP: sharpness hard-failure with only one expected key
  if (hardSharp.length > 0 && (doc?.expected && Object.keys(doc.expected).length === 1 || hardSharp.length >= 2)) {
    return { verdict: 'DROP', confidence: 'high', why: `sharpness: ${hardSharp.join(', ')}`, flags: { sharp, consistency, invariant } };
  }

  // Decisive KEEP: strong universal invariant + no hard fails
  if (invariant.strong.length > 0 && hardSharp.length === 0) {
    return { verdict: 'KEEP', confidence: 'high', why: `invariant: ${invariant.strong.join(', ')}`, flags: { sharp, consistency, invariant } };
  }

  // Default-trust: sharp body + self-consistent + has assertion
  const hasAssertion = doc?.expected && Object.keys(doc.expected).length > 0;
  if (hardSharp.length === 0 && hardMismatch.length === 0 && hasAssertion) {
    const reason = invariant.weak.length > 0
      ? `default-keep: sharp body + weak signal (${invariant.weak.join(', ')})`
      : `default-keep: sharp body + self-consistent + has assertion`;
    return { verdict: 'KEEP', confidence: 'medium', why: reason, flags: { sharp, consistency, invariant } };
  }

  return { verdict: 'BORDERLINE', confidence: 'low', why: 'mixed signals; needs human read', flags: { sharp, consistency, invariant } };
}

// ── Load contracts + current GT decisions
const contracts = walk(FIXTURE).map((f) => {
  try { return { f, doc: parseYaml(readFileSync(f, 'utf8')) }; } catch { return null; }
}).filter((x) => x && x.doc?.id);

const currentGt = {};
if (existsSync(GT_DIR)) {
  for (const e of readdirSync(GT_DIR)) {
    if (!e.endsWith('.yml')) continue;
    try {
      const doc = parseYaml(readFileSync(join(GT_DIR, e), 'utf8'));
      if (doc?.id) currentGt[doc.id] = doc?.provenance?.status ?? 'unknown';
    } catch {}
  }
}

// ── Judge each
const rows = contracts.map(({ doc }) => {
  const j = judge(doc);
  const gt = currentGt[doc.id] ?? '—';
  const gtVerdict = gt === 'approved' ? 'KEEP' : (gt === 'dropped' ? 'DROP' : (gt === 'merged' ? 'MERGED' : '—'));
  const agree = j.verdict === gtVerdict || gtVerdict === 'MERGED';
  return { id: doc.id, area: doc.area, title: doc.title, gt, gtVerdict, ...j, agree };
});

// ── Buckets
const agreed = rows.filter((r) => r.agree);
const disagreed = rows.filter((r) => !r.agree && r.verdict !== 'BORDERLINE');
const borderline = rows.filter((r) => r.verdict === 'BORDERLINE');

// ── Emit report
const out = [];
out.push('# Intent judge — 2026-05-25');
out.push('');
out.push('Re-frames ground-truth as "should the product hold this invariant?" rather than "does the SUT currently match?". SUT bugs are orthogonal. Pure body+title analysis; no SUT consulted.');
out.push('');
out.push('## Headline');
out.push('');
out.push(`- Total contracts: ${rows.length}`);
out.push(`- Agree with current GT: ${agreed.length} (${(agreed.length/rows.length*100).toFixed(1)}%)`);
out.push(`- **Disagree** with current GT (high confidence): ${disagreed.length}`);
out.push(`- Borderline (needs your read): ${borderline.length}`);
out.push('');

// Disagreements table
out.push('## Disagreements — intent-judge thinks current GT is wrong');
out.push('');
out.push('| # | id | area | current GT | judge verdict | reason |');
out.push('|---|---|---|---|---|---|');
disagreed.sort((a, b) => a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
disagreed.forEach((r, i) => {
  out.push(`| ${i+1} | ${r.id} | ${r.area} | ${r.gt} | **${r.verdict}** | ${r.why.replace(/\|/g,'\\|')} |`);
});
out.push('');
out.push('**To apply**: for each row where you agree with the judge, flip the GT file:');
out.push('- DROP → set provenance.status=dropped, review.validity=fp');
out.push('- KEEP → set provenance.status=approved, review.validity=tp');
out.push('');

// Borderline grouped by cluster — decide once per cluster, not per contract
out.push('## Borderline — judge has no strong signal');
out.push('');
out.push(`${borderline.length} contracts. Grouped into clusters of similar product affordance. For each cluster: decide once (k/d/m), applies to all members. Per-cluster decisions live in qa/eval/poker/run-log/borderline-decisions.txt — see "How to apply" below.`);
out.push('');

// Cluster borderline by area + first 3 hyphen-separated title-stem tokens
function clusterKey(r) {
  const tokens = (r.title || '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['the','for','and','with','from','that','this','when','have','should','must','displays','shows','clicked','clicking','button','dialog','form','input','page','test'].includes(w))
    .slice(0, 3).join('-');
  return `${r.area}|${tokens || r.id.split('-').slice(0,3).join('-')}`;
}
const clusters = new Map();
borderline.forEach((r) => {
  const k = clusterKey(r);
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(r);
});
const sortedClusters = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

out.push(`### ${sortedClusters.length} clusters (largest first)`);
out.push('');
sortedClusters.forEach(([key, members], i) => {
  const sig = [...new Set(members.flatMap((m) => [...m.flags.invariant.weak, ...m.flags.consistency.filter((f) => f.startsWith('info:'))]))].join('; ') || '(no signal)';
  out.push(`#### Cluster ${i+1}: \`${key}\` — ${members.length} members`);
  out.push(`Signals: ${sig.replace(/\n/g, ' ')}`);
  out.push('');
  out.push('| id | current GT | title |');
  out.push('|---|---|---|');
  members.forEach((r) => out.push(`| ${r.id} | ${r.gt} | ${r.title.replace(/\|/g,'\\|')} |`));
  out.push('');
});

out.push('');
out.push('## How to apply');
out.push('');
out.push('### Step 1 — apply high-confidence disagreements');
out.push('');
out.push('Edit `qa/eval/poker/run-log/intent-judge-decisions.txt` (one line per change you accept):');
out.push('```');
out.push('# format: <id>\\t<KEEP|DROP|MERGE:<canonical>>\\t<optional note>');
out.push('agents-connect-empty-bearer-token\tDROP\tdom-after-http; weak assertion');
out.push('api-tables-create-validates-schema\tKEEP\tinput validation invariant');
out.push('```');
out.push('Then run `node scripts/eval/apply-intent-judge.mjs` to overwrite the matching GT files.');
out.push('');
out.push('### Step 2 — borderline by cluster');
out.push('');
out.push('For each cluster, append a single decision to `intent-judge-decisions.txt`:');
out.push('```');
out.push('# uses CLUSTER:<key> prefix to apply to every member');
out.push('CLUSTER:core|preset-amount-button\tDROP\tnot in fixture spec');
out.push('CLUSTER:core|tab-active-state\tKEEP\tstandard UI tabs');
out.push('```');
out.push('apply-intent-judge.mjs expands these into per-member writes.');
out.push('');
out.push('### Step 3 — re-score');
out.push('');
out.push('```');
out.push('node scripts/eval/score.mjs --project poker --autopilot-dir /Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts --out qa/eval/poker/score-2026-05-25-postjudge.json');
out.push('```');

// Agreement summary
const dropAg = agreed.filter(r => r.verdict === 'DROP').length;
const keepAg = agreed.filter(r => r.verdict === 'KEEP').length;
const mergedAg = agreed.filter(r => r.gtVerdict === 'MERGED').length;
out.push('## Agreement summary');
out.push('');
out.push(`- KEEP confirmed: ${keepAg}`);
out.push(`- DROP confirmed: ${dropAg}`);
out.push(`- MERGED (intent-judge treats as not-applicable): ${mergedAg}`);
out.push('');

writeFileSync(OUT, out.join('\n') + '\n');

// ── Also emit a pre-filled decisions file with my recommendations
const decisions = [];
decisions.push('# Intent-judge recommended decisions — review and edit, then run:');
decisions.push('#   node scripts/eval/apply-intent-judge.mjs --apply');
decisions.push('# Comment out (#) any line you disagree with; the rest will be applied.');
decisions.push('# Format: <id>\\t<KEEP|DROP|MERGE:<canonical>>\\t<note>');
decisions.push('');
decisions.push('# --- high-confidence disagreements (judge says current GT is wrong) ---');
for (const r of disagreed) {
  decisions.push(`${r.id}\t${r.verdict}\t${r.why.replace(/\n/g, ' ')}`);
}
const DECISIONS_OUT = 'qa/eval/poker/run-log/intent-judge-decisions.txt';
writeFileSync(DECISIONS_OUT, decisions.join('\n') + '\n');

console.log(`wrote ${OUT}`);
console.log(`wrote ${DECISIONS_OUT}  (${disagreed.length} pre-filled disagreements)`);
console.log(`  agree=${agreed.length}  disagree=${disagreed.length}  borderline=${borderline.length}`);
