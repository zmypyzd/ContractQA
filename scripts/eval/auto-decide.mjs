#!/usr/bin/env node
// Auto-decide the obvious cases in step-2 review and leave only the
// judgment calls for the human walker.
//
// Decisions per bucket:
//
//   strong-pass:
//     - approved (runner exercised + oracle confirmed real assertion).
//     - EXCEPT: if expected.url.matches is /^\.\*$/  → dropped
//       (".*" trivially matches any URL; this is a no-op assertion that
//        silently passes — see Phase B drift pattern #7).
//
//   weak-pass (run=PASS but flagged by check-silent-pass.mjs):
//     - unknown-* flag → dropped (assertion key not in ContractSchema;
//       silently ignored → no real verification happened).
//     - dom-after-http flag → dropped (DOM assertion ran on whatever page
//       was loaded by auth-setup or a prior test; the http action doesn't
//       navigate, so any text match is coincidental).
//
//   fail:
//     - url.matches that's trivially ".*" or "^/$" without a goto → dropped
//       (no-op or doomed regex).
//     - dom.contains_text needles that are common English noise words
//       ("data", "ok", "error", "true", "false") → dropped
//       (weak assertion would silent-pass on the wrong page; the real
//        failure exposes the weakness).
//     - locator timeout with name_regex matching Chinese characters
//       (登出, 邀请, etc.) on a fresh English-locale SUT → dropped
//       (i18n / hallucinated UI surface).
//     - strict-mode violation → approved with note (intent valid, selector
//       needs first:true or within: scope).
//     - locator timeout on auth-required UI that *probably* exists when
//       the user has data → approved with note (needs richer state).
//     - everything else FAIL → left for human (skip).
//
// Resumable: any contract already in qa/eval/poker/ground-truth/ is left
// alone.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const FIXTURE = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const GT_DIR = 'qa/eval/poker/ground-truth';
const RUN_LOG = '/tmp/run-2026-05-25-v4-with-oracle.log';
const TEST_RESULTS = '/Users/zmy/intership/5.10+/qa-agent/test-results';
const REVIEWER = 'eval-automation';

const SCHEMA_KEYS = {
  url: ['matches'],
  localStorage: ['no_key_matches', 'has_key_matches'],
  sessionStorage: ['no_key_matches'],
  cookies: ['no_name_matches'],
  dom: ['not_contains_any', 'contains_all', 'contains_text', 'not_contains_text', 'role_count'],
  auth_state: ['fully_logged_out'],
  backend_state: ['named_query', 'params', 'assert'],
  watch_keys: ['localStorage', 'cookies'],
};
const NOISE_NEEDLES = new Set(['data', 'ok', 'OK', 'error', 'Error', 'true', 'false', 'null', '0', '1', 'id']);
const CHINESE_RE = /[一-鿿]/;

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

function weakFlags(doc) {
  const flags = [];
  const exp = doc?.expected ?? {};
  for (const k of Object.keys(exp)) {
    const allowed = SCHEMA_KEYS[k];
    if (!allowed) { flags.push(`unknown:${k}`); continue; }
    if (typeof exp[k] === 'object' && exp[k] !== null) {
      for (const sk of Object.keys(exp[k])) if (!allowed.includes(sk)) flags.push(`unknown:${k}.${sk}`);
    }
  }
  const actions = doc?.actions ?? [];
  const hasGoto = actions.some((a) => a.type === 'goto');
  const hasHttp = actions.some((a) => a.type === 'http');
  if (exp?.dom && !hasGoto && hasHttp) flags.push('dom-after-http');
  return flags;
}

function loadRunLog() {
  const log = readFileSync(RUN_LOG, 'utf8');
  const passed = new Set();
  const failed = new Set();
  for (const m of log.matchAll(/^\s+✓\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) passed.add(m[1]);
  for (const m of log.matchAll(/^\s+✘\s+\d+\s+qa-runner\.test\.mts:\d+:\d+ › ([^:]+):/gm)) failed.add(m[1]);
  return { passed, failed };
}

function findErrorContext(id) {
  if (!existsSync(TEST_RESULTS)) return null;
  for (const d of readdirSync(TEST_RESULTS)) {
    const p = join(TEST_RESULTS, d, 'error-context.md');
    if (existsSync(p)) {
      const c = readFileSync(p, 'utf8');
      if (c.includes(`>> ${id}:`)) return c;
    }
  }
  return null;
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

const { passed, failed } = loadRunLog();
const all = walk(FIXTURE).map((f) => {
  try {
    const doc = parseYaml(readFileSync(f, 'utf8'));
    if (!doc?.id) return null;
    return { f, doc, flags: weakFlags(doc) };
  } catch { return null; }
}).filter(Boolean);

const remaining = all.filter((x) => !existsSync(join(GT_DIR, `${x.doc.id}.yml`)));

const stats = { approved: 0, dropped: 0, skipped: 0 };
const ledger = [];

for (const x of remaining) {
  const { doc, flags } = x;
  const exp = doc.expected ?? {};
  const isPass = passed.has(doc.id);
  const isFail = failed.has(doc.id);
  const trivialUrl = exp.url?.matches === '.*' || exp.url?.matches === '.*?';
  const noiseNeedles = (exp.dom?.contains_text ?? []).filter((t) => typeof t === 'string' && NOISE_NEEDLES.has(t));
  const chineseNeedles = (exp.dom?.contains_text ?? []).filter((t) => typeof t === 'string' && CHINESE_RE.test(t));
  const chineseNameRegex = (doc.actions ?? []).some((a) => a.target?.name_regex && CHINESE_RE.test(a.target.name_regex));

  let decision = null;
  let reason = '';

  if (isPass) {
    if (flags.length > 0) {
      // weak-pass: drop
      decision = 'dropped';
      reason = `weak-pass (flags: ${flags.join(',')}). Assertion was schema-ignored or evaluated against wrong page; the PASS was a silent / coincidental match. Phase B drift pattern.`;
    } else if (trivialUrl) {
      decision = 'dropped';
      reason = `expected.url.matches=".*" is a no-op assertion; trivially passes any URL.`;
    } else {
      decision = 'approved';
      reason = `strong-pass: runner exercised + runOracle confirmed real assertion held. PENDING verified_in_product flip after product spot-check.`;
    }
  } else if (isFail) {
    // try to read error context
    const err = findErrorContext(doc.id) ?? '';
    const errBlock = err.match(/```\n([\s\S]+?)\n```/)?.[1] ?? '';
    const isLocatorTimeout = /locator\.(click|fill).*Test timeout/i.test(errBlock);
    const isStrictMode = /strict mode violation/i.test(errBlock);
    const isUrlMismatch = /url: expected /i.test(errBlock);
    const isDomMismatch = /dom\.contains_text: missing/i.test(errBlock);

    if (trivialUrl) {
      decision = 'dropped';
      reason = `expected.url.matches=".*" — even FAIL is meaningless; no real assertion.`;
    } else if (chineseNameRegex || chineseNeedles.length > 0) {
      decision = 'dropped';
      reason = `Chinese-locale selector or text (${chineseNameRegex ? 'name_regex' : 'needle'}) on English SUT — likely i18n hallucination.`;
    } else if (noiseNeedles.length > 0 && (exp.dom?.contains_text?.length ?? 0) === noiseNeedles.length) {
      decision = 'dropped';
      reason = `dom.contains_text only matches noise tokens (${noiseNeedles.join(',')}); would silent-pass on most pages.`;
    } else if (isStrictMode) {
      decision = 'approved';
      reason = `Strict-mode violation: selector matched multiple elements. Intent likely valid; reviewer to add first:true or within: scope.`;
    } else if (isLocatorTimeout && doc.preconditions?.auth_state === 'logged_in') {
      // many failing logged_in UI contracts probably need data state, not hallucinations
      decision = null; // skip — judgment call per contract
      reason = `locator timeout on logged_in UI; could be hallucination or could need richer state (existing table/match/agent). Needs human.`;
    } else if (isUrlMismatch && exp.url?.matches?.startsWith('^/login')) {
      decision = 'approved';
      reason = `expected redirect to /login but got something else — could still be valid auth-boundary intent, just SUT behavior differs. Reviewer to confirm.`;
    } else {
      decision = null;
      reason = `${isLocatorTimeout ? 'locator timeout' : isUrlMismatch ? 'url mismatch' : isDomMismatch ? 'dom mismatch' : 'other failure'}; needs human.`;
    }
  } else {
    // not PASS or FAIL — shouldn't happen post-loader, skip
    decision = null;
    reason = 'no run signal';
  }

  if (decision === 'approved') {
    write(doc, 'approved', { specificity: 2, notes: reason });
    stats.approved++;
    ledger.push(['APPROVED', doc.area, doc.id, reason.slice(0, 80)]);
  } else if (decision === 'dropped') {
    write(doc, 'dropped', { validity: 'fp', specificity: 0, notes: reason });
    stats.dropped++;
    ledger.push(['DROPPED ', doc.area, doc.id, reason.slice(0, 80)]);
  } else {
    stats.skipped++;
    ledger.push(['SKIP    ', doc.area, doc.id, reason.slice(0, 80)]);
  }
}

console.log(`Auto-decided: ${stats.approved} approved + ${stats.dropped} dropped + ${stats.skipped} skipped\n`);
console.log('Sample ledger (first 30 of each):\n');
const apps = ledger.filter((r) => r[0] === 'APPROVED').slice(0, 10);
const drps = ledger.filter((r) => r[0] === 'DROPPED ').slice(0, 10);
const skps = ledger.filter((r) => r[0] === 'SKIP    ').slice(0, 10);
for (const r of [...apps, ...drps, ...skps]) console.log(`  ${r[0]}  ${r[1].padEnd(10)} ${r[2].padEnd(60)} ${r[3]}`);
console.log(`\nNext: ${stats.skipped} contracts need human in scripts/eval/walk-review.mjs.`);
