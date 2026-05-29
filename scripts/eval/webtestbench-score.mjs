#!/usr/bin/env node
// WebTestBench scorer — LLM-as-judge for semantic checklist coverage.
//
// ⚠ Inputs:
//   - WebTestBench checklist for app NNNN (read from fixture)
//   - Agent's contract output for that app (read from scratch/NNNN/qa/contracts)
//
// ⚠ Memory: feedback_webtestbench_blind_only.md
//   The agent never sees the checklist. The scorer reads BOTH and judges,
//   AFTER the agent has finished producing its contracts.
//
// Per checklist item, we ask the LLM:
//   "Given this requirement and these N contracts (titles + actions +
//    expected blocks), is any contract semantically aimed at testing
//    this requirement? yes/no + which contract id(s) cover it."
//
// Output JSON shape:
//   {
//     project: 'WebTestBench_NNNN',
//     instruction, category,
//     counts: { agent_output, checklist_total, covered, missed,
//               covered_pass_true (real coverage), covered_pass_false (bug hits) },
//     metrics: { coverage_overall, coverage_bug_detection },
//     coverage: [ { checklist_id, content, class, pass, covered: bool,
//                   matched_contract_ids: [...], judge_reason } ]
//   }
//
// Cost note: 17 checklist items × 1 LLM call each = ~17 calls per app.
// For 100 apps: ~1700 calls. Use --limit N to bound.

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const DEFAULT_FIXTURE_ROOT = '/Users/zmy/intership/qa-eval-fixtures/WebTestBench';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[key] = val;
  }
  return a;
}

function loadChecklist(fixtureRoot, idx) {
  const targetIndex = `WebTestBench_${idx}`;
  const raw = readFileSync(path.join(fixtureRoot, 'WebTestBench.jsonl'), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.index === targetIndex) return r;
  }
  throw new Error(`checklist not found: ${targetIndex}`);
}

function loadContracts(dir) {
  if (!safeStat(dir)) return [];
  const out = [];
  function rec(d) {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) {
        try {
          out.push({ file: p, ...parseYaml(readFileSync(p, 'utf8')) });
        } catch (err) {
          // skip malformed
        }
      }
    }
  }
  rec(dir);
  return out;
}

function safeStat(p) {
  try { return statSync(p); } catch { return null; }
}

function summarizeContract(c) {
  // Compact one-line summary for the judge prompt.
  const actions = Array.isArray(c.actions)
    ? c.actions.map((a) => {
        if (a.type === 'goto') return `goto ${a.path}`;
        if (a.type === 'click') return `click ${a.target?.name_regex ?? a.target?.role ?? '?'}`;
        if (a.type === 'fill') return `fill ${a.target?.name_regex ?? a.target?.role ?? '?'}=${a.value}`;
        if (a.type === 'http') return `${a.method} ${a.path}`;
        if (a.type === 'wait') return `wait ${a.ms}ms`;
        return a.type;
      }).join(' → ')
    : '';
  const exp = c.expected ?? {};
  const expectedSummary = [];
  if (exp.url?.matches) expectedSummary.push(`url~/${exp.url.matches}/`);
  if (exp.http?.status !== undefined) expectedSummary.push(`http.status=${JSON.stringify(exp.http.status)}`);
  if (exp.http?.body) expectedSummary.push(`http.body=…`);
  if (exp.dom?.contains_text) expectedSummary.push(`dom.contains_text=${JSON.stringify(exp.dom.contains_text)}`);
  if (exp.dom?.element_text_equals) expectedSummary.push(`dom.element_text_equals=…`);
  if (exp.dom?.attribute_equals) expectedSummary.push(`dom.attribute_equals=…`);
  if (exp.dom?.input_value) expectedSummary.push(`dom.input_value=…`);
  if (exp.dom?.class_contains) expectedSummary.push(`dom.class_contains=…`);
  if (exp.localStorage) expectedSummary.push('localStorage=…');
  if (exp.cookies) expectedSummary.push('cookies=…');
  return {
    id: c.id ?? path.basename(c.file ?? ''),
    title: c.title ?? '',
    actions,
    expected: expectedSummary.join(' ; '),
  };
}

async function judgeCoverage(checklistItem, contractSummaries, opts) {
  // LLM judge using the orchestrator's pickClient — picks whichever
  // provider autopilot uses (OPENAI_API_KEY > ANTHROPIC_API_KEY > Claude
  // Code SDK). No extra SDK install needed for the common case where
  // Claude Code is already configured.
  //
  // Returns { covered: bool, matched_contract_ids: [...], reason: '...' }
  const sys = [
    'You are a QA test reviewer. You decide whether a given product requirement is COVERED by any of a list of contract specs.',
    '',
    'COVERED means: at least one contract is clearly aimed at testing that requirement\'s behavior — the contract\'s actions + expected block, taken at face value, would exercise (or assert on) the requirement.',
    '',
    'NOT covered means: no contract\'s actions/expected map to the requirement, OR the contracts only tangentially touch the surface area but never assert on the requirement\'s specific claim.',
    '',
    'Be strict but not pedantic: a contract that tests "create product" covers the requirement "users can create products", even if the wording differs. A contract that merely navigates to a page does NOT cover a requirement about a behavior on that page.',
    '',
    'Output STRICTLY a single-line JSON object: {"covered": true|false, "matched_contract_ids": ["id1", "id2"], "reason": "one short sentence"}',
    'No prose, no markdown fences.',
  ].join('\n');

  const user = [
    'REQUIREMENT (one checklist item from a QA spec):',
    `  class: ${checklistItem.class}`,
    `  content: ${checklistItem.content}`,
    '',
    `CONTRACT CORPUS (${contractSummaries.length} contracts the test agent generated):`,
    ...contractSummaries.map((c, i) =>
      `  [${i + 1}] id=${c.id} | title="${c.title}" | actions: ${c.actions || '(none)'} | expected: ${c.expected || '(none)'}`,
    ),
    '',
    'Decide: does any contract above semantically cover this requirement?',
  ].join('\n');

  if (opts.dryRun) {
    return { covered: false, matched_contract_ids: [], reason: '[dry-run] not called' };
  }

  // Lazy-cache the client so we don't pay pickClient cost per call.
  // Judge model selection (hybrid Sonnet+Haiku setups):
  //   CONTRACTQA_JUDGE_MODEL     — preferred; lets scorer use a different
  //                                model than autopilot (e.g. Haiku judge
  //                                while Sonnet discovers)
  //   CONTRACTQA_LLM_MODEL       — fallback shared across all callers
  //   unset                       — Claude Code's default model
  // We temp-swap CONTRACTQA_LLM_MODEL so pickClient's provider selection
  // (Anthropic SDK direct vs Claude Code SDK) still applies — only the
  // model id changes for the judge call path.
  if (!opts._client) {
    const { pickClient } = await import('../../packages/orchestrator/dist/llm/pick-client.js');
    const judgeModel = process.env.CONTRACTQA_JUDGE_MODEL;
    const saved = process.env.CONTRACTQA_LLM_MODEL;
    if (judgeModel) process.env.CONTRACTQA_LLM_MODEL = judgeModel;
    try {
      opts._client = await pickClient();
    } finally {
      if (saved === undefined) delete process.env.CONTRACTQA_LLM_MODEL;
      else process.env.CONTRACTQA_LLM_MODEL = saved;
    }
    process.stderr.write(`  (judge model: ${opts._client.modelHint})\n`);
  }
  // Inline retry — same shape as generateWithBackoff in cli/autopilot/
  // interaction-discovery.ts. Scorer doesn't import from cli (to avoid a
  // build-order dep), so duplicate the 20-line helper rather than refactor.
  // Retries on Claude Code SDK exit-1 + HTTP 5xx + transient network errors.
  // See tuning log Entry 2 — scorer was the unrecovered failure mode.
  const callWithBackoff = async () => {
    const maxRetries = 3;
    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      try {
        return await opts._client.generate({
          system: sys,
          messages: [{ role: 'user', content: user }],
          temperature: 0.2,
          maxTokens: 400,
        });
      } catch (err) {
        lastErr = err;
        const status = err?.statusCode ?? err?.status;
        const message = (err?.message ?? '').toString();
        const isHttpRetryable = status === 429 || status === 503 || (status !== undefined && status >= 500);
        const isSdkTransient = /Claude Code process exited|Claude Agent SDK call failed|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(message);
        if (!(isHttpRetryable || isSdkTransient) || attempt >= maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        attempt++;
      }
    }
    throw lastErr;
  };
  const resp = await callWithBackoff();
  const text = resp.content.trim();
  // Strip any wrapping; pull out the first {...} block.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    return { covered: false, matched_contract_ids: [], reason: `judge returned non-JSON: ${text.slice(0, 80)}` };
  }
  try {
    const parsed = JSON.parse(m[0]);
    return {
      covered: !!parsed.covered,
      matched_contract_ids: Array.isArray(parsed.matched_contract_ids) ? parsed.matched_contract_ids : [],
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return { covered: false, matched_contract_ids: [], reason: `judge JSON.parse failed: ${m[0].slice(0, 80)}` };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const idx = args.idx ?? args.app;
  if (!idx || !/^\d{4}$/.test(idx)) {
    console.error('usage: node webtestbench-score.mjs --idx <NNNN> [--contracts <dir>] [--out <path>] [--limit N] [--dry-run] [--model <id>]');
    process.exit(1);
  }
  const fixtureRoot = args['fixture-root'] ?? DEFAULT_FIXTURE_ROOT;
  const contractsDir = args.contracts ?? path.join(fixtureRoot, 'scratch', idx, 'qa', 'contracts');
  const outPath = args.out ?? path.join(fixtureRoot, 'scratch', idx, 'score.json');
  const limit = args.limit ? parseInt(args.limit, 10) : null;

  const entry = loadChecklist(fixtureRoot, idx);
  // S4 corpus reconciliation: judge coverage over the RUNNER-LOADABLE set only.
  // An unloadable (schema-invalid / .yaml) contract can never execute, so crediting
  // it for "coverage" inflates the metric. `rawContracts` is the full readdir set
  // (used only to count + name what the runner drops). See EVAL-AUDIT-AND-REDESIGN.md.
  const rawContracts = loadContracts(contractsDir); // all .yml + .yaml, raw parseYaml
  let runnable = rawContracts;
  try {
    const { loadContractsFromDir } = await import('../../packages/runner/dist/index.js');
    runnable = await loadContractsFromDir(contractsDir, { lenient: true });
  } catch (e) {
    console.warn(`  WARN: runner loader unavailable (${e.message}); falling back to raw corpus — coverage will NOT be runner-reconciled`);
  }
  const runnableIds = new Set(runnable.map((c) => c.id));
  const unloadable = rawContracts.filter((c) => !runnableIds.has(c.id ?? path.basename(c.file ?? '')));
  const contracts = runnable;
  const summaries = contracts.map(summarizeContract);

  console.log(`webtestbench-score: ${entry.index} (${entry.category})`);
  console.log(`  checklist: ${entry.checklist.length} items`);
  console.log(`  agent_output: ${rawContracts.length} raw → ${runnable.length} runner-loadable (${unloadable.length} unloadable, judged over loadable)`);
  if (args['dry-run']) console.log('  mode: DRY-RUN (no LLM calls)');

  const coverage = [];
  const items = limit ? entry.checklist.slice(0, limit) : entry.checklist;
  // Shared opts so judgeCoverage can lazy-cache the LLM client across calls.
  const judgeOpts = { dryRun: !!args['dry-run'], model: args.model };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    process.stderr.write(`  [${i + 1}/${items.length}] judging #${it.id} (${it.class})… `);
    const j = await judgeCoverage(it, summaries, judgeOpts);
    // Resolve the judge's ordinals/ids to stable contract STRING ids so downstream
    // attribution (exec-detection-score) maps by id, robust to readdir ordering.
    // Drop ids that aren't members of the judged corpus (S8: hallucinated matches).
    const keys = [];
    for (const m of j.matched_contract_ids || []) {
      const n = Number(m);
      if (Number.isInteger(n) && n >= 1 && n <= summaries.length) keys.push(summaries[n - 1].id);
      else if (runnableIds.has(String(m))) keys.push(String(m));
      // else: non-member id → hallucinated, dropped
    }
    coverage.push({
      checklist_id: it.id,
      content: it.content,
      class: it.class,
      pass: it.pass,
      covered: j.covered,
      matched_contract_ids: j.matched_contract_ids,
      matched_contract_keys: keys,
      judge_reason: j.reason,
    });
    process.stderr.write(`${j.covered ? '✓' : '✗'}\n`);
  }

  const covered = coverage.filter((c) => c.covered).length;
  const missed = coverage.length - covered;
  const coveredPassTrue = coverage.filter((c) => c.covered && c.pass === true).length;
  const coveredPassFalse = coverage.filter((c) => c.covered && c.pass === false).length;
  const totalPassTrue = coverage.filter((c) => c.pass === true).length;
  const totalPassFalse = coverage.filter((c) => c.pass === false).length;

  const out = {
    project: entry.index,
    instruction: entry.instruction,
    category: entry.category,
    counts: {
      agent_output: contracts.length, // runner-loadable contracts judged
      agent_output_total: rawContracts.length, // raw readdir set (.yml + .yaml)
      unloadable: unloadable.length, // dropped by the runner's schema loader — can never execute
      checklist_total: coverage.length, // items actually judged
      checklist_total_true: entry.checklist.length, // full checklist (differs when --limit set)
      score_limit: limit ?? null,
      covered,
      missed,
      covered_pass_true: coveredPassTrue,
      covered_pass_false: coveredPassFalse,
      total_pass_true: totalPassTrue,
      total_pass_false: totalPassFalse,
    },
    // Files the runner's loader rejected (schema-invalid / .yaml) — coverage no
    // longer credits these. Relative paths for readability.
    unloadable_files: unloadable.map((c) => path.relative(contractsDir, c.file ?? '')),
    coverage_corpus: runnable === rawContracts ? 'raw-unreconciled' : 'runner-loadable',
    metrics: {
      // Fraction of all requirements with a contract the judge deems AIMED at it,
      // judged over the runner-loadable corpus.
      coverage_overall: coverage.length === 0 ? null : covered / coverage.length,
      // RENAMED: this is topical AIM coverage, NOT execution detection. Of the
      // requirements the SUT actually FAILS (pass=false), how many did the agent
      // aim a (loadable) contract at? For real detection (does the contract FAIL
      // on the buggy SUT) see exec-detection-score.mjs → true_detection_rate.
      bug_aim_coverage: totalPassFalse === 0 ? null : coveredPassFalse / totalPassFalse,
      // DEPRECATED alias of bug_aim_coverage — kept so existing aggregators
      // (docker-batch.mjs) keep working. Do NOT report as "detection".
      bug_detection_coverage: totalPassFalse === 0 ? null : coveredPassFalse / totalPassFalse,
    },
    coverage,
  };

  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('');
  console.log(`Wrote ${outPath}`);
  console.log(`  overall coverage:        ${covered}/${coverage.length} (${((out.metrics.coverage_overall ?? 0) * 100).toFixed(1)}%)`);
  console.log(`  bug-detection coverage:  ${coveredPassFalse}/${totalPassFalse} (${((out.metrics.bug_detection_coverage ?? 0) * 100).toFixed(1)}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
