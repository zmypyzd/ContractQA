// packages/cli/src/commands/autopilot.ts
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { pickClient, type LLMClient } from '@contractqa/orchestrator/llm';
import type { ContractDoc } from '@contractqa/core';
import { runHttpContract } from '@contractqa/runner';
import { assembleTargetContext } from '../autopilot/bootstrap.js';
import { startTimeBudget } from '../autopilot/budget-watchdog.js';
import { createStashGuard } from '../autopilot/stash-guard.js';
import { applicablePatterns } from '../autopilot/smoke-patterns.js';
import { discoverByModule, type ContractProposal } from '../autopilot/llm-discovery.js';
import { confirmUncertainProposals } from '../autopilot/interactive-prompt.js';
import { renderReportMarkdown, type AutopilotReport, type SmokeFailure } from '../autopilot/report.js';

const DEFAULT_TIME_BUDGET_MS = 30 * 60 * 1000;

export interface AutopilotOptions {
  cwd: string;
  timeBudgetMs?: number;
  fix?: boolean;
  yes?: boolean;
  regenerate?: boolean;
  llmClient?: LLMClient;
  /** Controls which contracts are re-run after a successful fix to detect regressions. */
  regressionScope?: 'one' | 'touched-files' | 'all';
}

interface QueuedFailure {
  priority: 0 | 1; // 0 = smoke (Phase A), 1 = module (Phase B)
  failure: SmokeFailure;
  contractPath: string;
}

async function writeSmokeContracts(cwd: string, patterns: ReturnType<typeof applicablePatterns>, ctx: Parameters<typeof applicablePatterns>[0]): Promise<string[]> {
  const dir = join(cwd, 'qa/contracts/_smoke');
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const p of patterns) {
    const spec = p.generate(ctx);
    const yaml = yamlStringify(spec);
    const path = join(dir, `${p.id}.yml`);
    await writeFile(path, yaml);
    paths.push(path);
  }
  return paths;
}

async function writeProposals(cwd: string, module: string, proposals: ContractProposal[]): Promise<string[]> {
  const dir = join(cwd, 'qa/contracts', module);
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const p of proposals) {
    const id = /id:\s*(\S+)/.exec(p.yaml)?.[1] ?? `unnamed-${paths.length}`;
    const path = join(dir, `${id}.yml`);
    await writeFile(path, p.yaml);
    paths.push(path);
  }
  return paths;
}

async function writeQuarantine(cwd: string, module: string, raw: string): Promise<void> {
  const dir = join(cwd, 'qa/contracts/_quarantine');
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(dir, `${module}-${ts}.txt`), raw);
}

/**
 * Run a contract via @contractqa/runner programmatic API.
 *
 * For contracts whose actions are all type:'http', uses runHttpContract directly
 * and forwards the AbortSignal to each fetch call.
 *
 * For Playwright-based contracts (goto, click, fill actions), autopilot cannot
 * run them without a live browser — returns { passed: 'deferred', reason: ... }
 * so the caller can honestly report them as deferred rather than silently passing.
 *
 * The base URL is read from CONTRACTQA_BASE_URL env var, or defaults to
 * http://localhost:3000 which is the Next.js/Vite dev-server default.
 */
async function runContractPath(
  contractPath: string,
  _cwd: string,
  signal: AbortSignal,
): Promise<{ passed: true | false | 'deferred'; reason?: string }> {
  try {
    const raw = await readFile(contractPath, 'utf8');
    const spec = yamlParse(raw) as ContractDoc;
    const actions = spec.actions ?? [];
    const allHttp = actions.length > 0 && actions.every((a) => (a as { type: string }).type === 'http');
    if (!allHttp) {
      // Playwright-based contracts: cannot run without a live browser session.
      // Report as deferred so Phase A statistics are honest.
      return {
        passed: 'deferred',
        reason: 'requires browser; run via contractqa run',
      };
    }
    const baseUrl = process.env.CONTRACTQA_BASE_URL ?? 'http://localhost:3000';
    const result = await runHttpContract({ contract: spec, baseUrl, signal });
    return {
      passed: result.verdict.verdict === 'PASS',
      reason: result.verdict.verdict !== 'PASS'
        ? (result.verdict.violations[0]?.message ?? result.verdict.verdict)
        : undefined,
    };
  } catch (err) {
    if (signal.aborted) return { passed: false, reason: 'aborted' };
    return { passed: false, reason: (err as Error).message };
  }
}

export async function runAutopilot(opts: AutopilotOptions): Promise<AutopilotReport> {
  // I4: default fix to true when not explicitly set to false
  const fixEnabled = opts.fix !== false;

  const startedAt = Date.now();
  const abortController = new AbortController();
  const budget = startTimeBudget(opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS, abortController);
  let budgetTriggered: AutopilotReport['budgetTriggered'] = null;

  abortController.signal.addEventListener('abort', () => {
    if (!budgetTriggered) budgetTriggered = 'time-budget';
  });

  const stashGuard = createStashGuard(opts.cwd);
  try {
    await stashGuard.protect({
      confirmSensitive: async (items) => {
        if (opts.yes) return true; // CI / non-interactive — accept (the stash itself is reversible)
        // eslint-disable-next-line no-console
        console.error('autopilot: sensitive files detected:', items.map((i) => i.path).join(', '));
        return false;
      },
    });

    const llmClient = opts.llmClient ?? await pickClient();
    const ctx = await assembleTargetContext(opts.cwd);

    // Phase A: write smoke patterns; run HTTP ones inline, defer Playwright ones.
    const patterns = applicablePatterns(ctx);
    const smokePaths = await writeSmokeContracts(opts.cwd, patterns, ctx);
    const phaseA = { passed: 0, failed: 0, deferred: 0, failures: [] as SmokeFailure[] };
    const queue: QueuedFailure[] = [];
    for (const p of smokePaths) {
      if (abortController.signal.aborted) break;
      const r = await runContractPath(p, opts.cwd, abortController.signal);
      if (r.passed === true) {
        phaseA.passed++;
      } else if (r.passed === 'deferred') {
        phaseA.deferred++;
      } else {
        phaseA.failed++;
        const f: SmokeFailure = { id: p.split('/').pop()!, reason: r.reason ?? 'unknown' };
        phaseA.failures.push(f);
        queue.push({ priority: 0, failure: f, contractPath: p });
      }
    }

    // Phase B (sequential per module) — concurrent with Phase C consumer.
    const phaseB = { generated: 0, failed: 0, userConfirmed: 0, userRejected: 0 };
    // Phase C: stub — orchestrator wiring deferred to v1.1.0-beta.
    // The runShadowFix API requires createWorktree, runClaude, openFixPR, bundlePath, issueId
    // and other fields that autopilot cannot sensibly provide; full wiring exceeds 100 LOC of glue.
    // TODO(v1.1.0-beta): wire runShadowFix from @contractqa/orchestrator here.
    const phaseC = { attempted: 0, fixed: 0, givenUp: 0, skipped: 0, diffs: [] as string[] };

    let phaseBDone = false;

    const phaseCDone = (async () => {
      while (true) {
        if (abortController.signal.aborted) break;

        // I3: sort queue by priority before dequeuing so Phase A failures (priority 0)
        // are processed before Phase B failures (priority 1).
        queue.sort((a, b) => a.priority - b.priority);
        const next = queue.shift();
        if (!next) {
          await new Promise((r) => setTimeout(r, 50));
          if (queue.length === 0 && phaseBDone) break;
          continue;
        }
        if (!fixEnabled) {
          // I1: record the failure count even in --no-fix mode, but don't attempt a fix.
          continue;
        }
        // Phase C orchestrator integration is deferred to v1.1.0-beta.
        // Record as skipped so the report accurately reflects this limitation.
        phaseC.skipped++;
      }
    })();

    const phaseBRun = (async () => {
      await discoverByModule(
        ctx,
        llmClient,
        async (module, proposals) => {
          phaseB.generated += proposals.length;
          const highConf = proposals.filter((p) => p.confidence === 'high');
          const uncertain = proposals.filter((p) => p.confidence !== 'high');
          const written: ContractProposal[] = [...highConf];
          if (uncertain.length > 0) {
            const result = await confirmUncertainProposals(module, uncertain, { in: process.stdin, out: process.stdout }, { yes: opts.yes });
            phaseB.userConfirmed += result.accepted.length;
            phaseB.userRejected += result.rejected.length;
            written.push(...result.accepted);
          }
          const paths = await writeProposals(opts.cwd, module, written);
          for (const p of paths) {
            if (abortController.signal.aborted) break;
            const r = await runContractPath(p, opts.cwd, abortController.signal);
            // I1: track Phase B failures (deferred contracts count as pass for queueing purposes)
            if (r.passed === false) {
              phaseB.failed++;
              queue.push({ priority: 1, failure: { id: p.split('/').pop()!, reason: r.reason ?? 'unknown' }, contractPath: p });
            }
          }
        },
        abortController.signal,
        { onQuarantine: (raw, m) => { void writeQuarantine(opts.cwd, m, raw); } },
      );
      phaseBDone = true;
    })();

    await Promise.all([phaseBRun, phaseCDone]);
    budget.cancel();

    const report: AutopilotReport = {
      phaseA,
      phaseB,
      phaseC: fixEnabled ? phaseC : undefined,
      budgetTriggered,
      durationMs: Date.now() - startedAt,
    };

    await mkdir(join(opts.cwd, 'qa'), { recursive: true });
    await writeFile(join(opts.cwd, 'qa/AUTOPILOT_REPORT.md'), renderReportMarkdown(report));
    await writeFile(join(opts.cwd, 'qa/AUTOPILOT_REPORT.json'), JSON.stringify(report, null, 2));

    return report;
  } finally {
    budget.cancel();
    await stashGuard.release();
  }
}
