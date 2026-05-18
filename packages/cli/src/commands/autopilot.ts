// packages/cli/src/commands/autopilot.ts
import { mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { pickClient, type LLMClient } from '@contractqa/orchestrator/llm';
import { runFixLoop, runClaudeFix } from '@contractqa/orchestrator';
import type { ContractDoc } from '@contractqa/core';
import { runHttpContract } from '@contractqa/runner';
import { assembleTargetContext } from '../autopilot/bootstrap.js';
import { createSupabaseTempUser, buildSupabaseAdminClient } from '../autopilot/auth/supabase-temp-user.js';
import { startTimeBudget } from '../autopilot/budget-watchdog.js';
import { createStashGuard } from '../autopilot/stash-guard.js';
import { applicablePatterns } from '../autopilot/smoke-patterns.js';
import { discoverByModule, type ContractProposal } from '../autopilot/llm-discovery.js';
import { discoverByInteraction } from '../autopilot/interaction-discovery.js';
import { confirmUncertainProposals } from '../autopilot/interactive-prompt.js';
import { renderReportMarkdown, type AutopilotReport, type SmokeFailure } from '../autopilot/report.js';

const DEFAULT_TIME_BUDGET_MS = 30 * 60 * 1000;

/**
 * Progress events emitted by `runAutopilot` when an `onProgress` callback is
 * supplied. The shape mirrors AutopilotReport so a consumer can render live
 * counters that converge on the final report.
 *
 * - `phase` · status transitions and incremental counter updates per phase
 *   - A · Smoke (`passed` / `failed` / `deferred`)
 *   - B · Discovery (`generated` / `failed` / `deferred` / `userConfirmed` / `userRejected`)
 *   - C · Auto-fix (`attempted` / `fixed` / `givenUp`; `skipped` when `fix: false`)
 *   B and C run concurrently, so events from both may interleave.
 * - `log` · structured equivalents of the runtime's `console.warn`/`console.error`
 *   notices (sensitive files, temp-user failures, fix give-ups, diff apply failures).
 */
export type AutopilotProgressEvent =
  | {
      type: 'phase';
      phase: 'A' | 'B' | 'C';
      status: 'active' | 'done' | 'skipped';
      elapsedMs: number;
      counters?: AutopilotPhaseCounters;
    }
  | {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
      elapsedMs: number;
    };

export interface AutopilotPhaseCounters {
  passed?: number;
  failed?: number;
  deferred?: number;
  generated?: number;
  userConfirmed?: number;
  userRejected?: number;
  attempted?: number;
  fixed?: number;
  givenUp?: number;
}

export interface AutopilotOptions {
  cwd: string;
  timeBudgetMs?: number;
  fix?: boolean;
  yes?: boolean;
  regenerate?: boolean;
  llmClient?: LLMClient;
  /** Controls which contracts are re-run after a successful fix to detect regressions. */
  regressionScope?: 'one' | 'touched-files' | 'all';
  /**
   * Optional progress callback. Called with phase status transitions, incremental
   * counter updates, and structured log events. Synchronous; errors thrown by
   * the callback are swallowed so progress reporting never breaks a run.
   */
  onProgress?: (event: AutopilotProgressEvent) => void;
  /**
   * Phase C fix strategy. 'inPlace' (default) accumulates patches in cwd.
   * 'shadow' routes each failure through a ShadowFixCoordinator that opens
   * a worktree per fix and creates a GitHub PR. Requires shadowCoordinator.
   */
  fixStrategy?: 'inPlace' | 'shadow';
  shadowCoordinator?: import('../autopilot/shadow-fix-coordinator.js').ShadowFixCoordinator;
  /**
   * Phase B discovery strategy. 'modules' (default) uses the existing
   * hardcoded 3-module × 3-8 cap. 'deep' uses LLM-driven surface enumeration
   * targeting 1 contract per interaction.
   */
  discoveryMode?: 'modules' | 'deep';
  /** Concurrency for Stage 2 LLM calls in deep mode. Default 4. */
  deepConcurrency?: number;
  /** Hard cap on contracts generated in a single deep run. Default 500. */
  deepMaxContracts?: number;
}

interface QueuedFailure {
  priority: 0 | 1; // 0 = smoke (Phase A), 1 = module (Phase B)
  failure: SmokeFailure;
  contractPath: string;
  evidencePath?: string; // absolute path to issue.json, populated by writeIssueEvidence
}

/** I3: Cost-tracking LLM client decorator. */
interface CostTracker {
  inputTokens: number;
  outputTokens: number;
  provider: string;
}

function wrapWithCostTracking(llm: LLMClient, tracker: CostTracker): LLMClient {
  return {
    providerName: llm.providerName,
    modelHint: llm.modelHint,
    async generate(opts) {
      const r = await llm.generate(opts);
      tracker.inputTokens += r.usage.inputTokens;
      tracker.outputTokens += r.usage.outputTokens;
      tracker.provider = llm.providerName;
      return r;
    },
  };
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
    // I1: idempotency — skip writing if path already exists and !regenerate.
    // (regenerate-mode wipes dirs before we get here; non-regenerate skips existing files.)
    try {
      await access(path);
      // File exists and regenerate is not set (caller handles dir wipe) — skip.
      // Since regenerate wipes the dir before we write, reaching here means the
      // file was written earlier in this same run; just record the path.
    } catch {
      // File doesn't exist — write it.
      await writeFile(path, p.yaml);
    }
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
export async function runContractPath(
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

/**
 * Build a minimal fix-prompt for a failing contract.
 * Writes the prompt file and returns its path.
 *
 * This is a simplified prompt (no issue bundle, repro, or trace) suitable for
 * autopilot's in-place fix path (Option A: runFixLoop without shadow pipeline).
 */
async function writeAutopilotFixPrompt(
  contractPath: string,
  failure: SmokeFailure,
  tempDir: string,
): Promise<string> {
  let contractYaml = '';
  try {
    contractYaml = await readFile(contractPath, 'utf8');
  } catch {
    contractYaml = '(could not read contract file)';
  }

  const promptContent = `You are fixing a failing ContractQA contract in-place (no worktree).

Contract file: ${contractPath}
Failure reason: ${failure.reason}

Contract YAML:
${contractYaml}

Rules:
1. Read the contract YAML carefully to understand the expected behaviour.
2. Identify the root cause of the failure in production code.
3. Fix production code, not the contract, unless the contract is demonstrably wrong.
4. Keep the patch minimal.
5. After patching, verify the fix logically.
6. Emit a unified diff of your changes as patch_diff.
7. Return JSON with: root_cause, files_changed, tests_run, validation_result ("PASS"|"FAIL"|"PARSE_ERROR"), patch_diff (unified diff string, required).

Return ONLY the JSON object — no markdown fences, no prose.`;

  const promptPath = join(tempDir, `fix-prompt-${failure.id}.md`);
  await writeFile(promptPath, promptContent);
  return promptPath;
}

export async function runAutopilot(opts: AutopilotOptions): Promise<AutopilotReport> {
  // I4: default fix to true when not explicitly set to false
  const fixEnabled = opts.fix !== false;

  const startedAt = Date.now();
  const abortController = new AbortController();
  const budget = startTimeBudget(opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS, abortController);
  let budgetTriggered: AutopilotReport['budgetTriggered'] = null;

  // Progress emission helper. Best-effort: a callback that throws does not
  // poison the run; this is observability, not control flow.
  const emit = (event: AutopilotProgressEvent): void => {
    if (!opts.onProgress) return;
    try {
      opts.onProgress(event);
    } catch {
      // swallow — never let progress reporting break a run.
    }
  };
  const elapsed = (): number => Date.now() - startedAt;

  abortController.signal.addEventListener('abort', () => {
    if (!budgetTriggered) budgetTriggered = 'time-budget';
  });

  // Outer-scope phase state so writeReport (and the catch block) can access it
  // even if the try block throws before these are fully populated.
  let phaseA: { passed: number; failed: number; deferred: number; failures: SmokeFailure[] } = { passed: 0, failed: 0, deferred: 0, failures: [] };
  let phaseB: { generated: number; failed: number; deferred: number; userConfirmed: number; userRejected: number } = { generated: 0, failed: 0, deferred: 0, userConfirmed: 0, userRejected: 0 };
  // Phase C: wired in v1.1.0-beta — calls runFixLoop (Option A) directly with autopilot's
  // llmClient, bypassing the shadow-pipeline GitHub wrapper (no PR/worktree needed).
  let phaseC: { attempted: number; fixed: number; givenUp: number; skipped: number; diffs: string[] } = { attempted: 0, fixed: 0, givenUp: 0, skipped: 0, diffs: [] };
  let costTracker: CostTracker = { inputTokens: 0, outputTokens: 0, provider: '' };
  // Accumulator for shadow-fix outcomes (populated only when fixStrategy === 'shadow').
  const fixOutcomes: import('../autopilot/shadow-fix-coordinator.js').CoordinatorFixOutcome[] = [];
  // Issue evidence paths written this run — surfaced on the report so the
  // dashboard / downstream consumers can register one issues row per file.
  const issuesWritten: string[] = [];

  // Idempotent report writer — called from both the happy path and the catch block.
  let reportWritten = false;
  let cachedReport: AutopilotReport | undefined;
  const writeReport = async (): Promise<AutopilotReport> => {
    if (reportWritten && cachedReport) return cachedReport;
    reportWritten = true;
    const llmCost = costTracker.inputTokens > 0 || costTracker.outputTokens > 0
      ? {
          provider: costTracker.provider,
          inputTokens: costTracker.inputTokens,
          outputTokens: costTracker.outputTokens,
          estimatedUsd: undefined,
        }
      : undefined;
    const report: AutopilotReport = {
      phaseA,
      phaseB,
      phaseC: fixEnabled ? phaseC : undefined,
      budgetTriggered,
      durationMs: Date.now() - startedAt,
      llmCost,
      issuesWritten,
      fixOutcomes: opts.fixStrategy === 'shadow' ? fixOutcomes : undefined,
    };
    cachedReport = report;
    await mkdir(join(opts.cwd, 'qa'), { recursive: true });
    await writeFile(join(opts.cwd, 'qa/AUTOPILOT_REPORT.md'), renderReportMarkdown(report));
    await writeFile(join(opts.cwd, 'qa/AUTOPILOT_REPORT.json'), JSON.stringify(report, null, 2));
    return report;
  };

  // I2: SIGINT handler — sets user-interrupt and triggers abort.
  // Uses process.once so the handler fires at most once per registration.
  // Note: when runAutopilot is called concurrently in the same process (rare —
  // the CLI invokes only once per command), each call registers its own listener
  // with its own AbortController. A single Ctrl-C will then abort all running
  // instances, which is the desired behaviour. The matching removeListener in
  // the finally block uses reference equality so each instance cleans up only
  // its own listener.
  const onSigint = () => {
    budgetTriggered = 'user-interrupt';
    abortController.abort();
  };
  process.once('SIGINT', onSigint);

  const stashGuard = createStashGuard(opts.cwd);
  let tempUserHandle: { dispose: () => Promise<void> } | undefined;
  // Accumulated diffs from Phase C — applied to working directory at end of run.
  const accumulatedDiffs: string[] = [];

  try {
    // Scan qa/issues/ BEFORE stashGuard runs — otherwise any uncommitted issue
    // evidence (e.g., from a prior `contractqa run` whose results weren't
    // committed yet) would be hidden in the stash for the rest of the run.
    // The dashboard de-dupes by issue_json_path so re-scanning is safe.
    await scanOrphanIssues(opts.cwd, issuesWritten);

    await stashGuard.protect({
      confirmSensitive: async (items) => {
        if (opts.yes) return true; // CI / non-interactive — accept (the stash itself is reversible)
        // eslint-disable-next-line no-console
        console.error('autopilot: sensitive files detected:', items.map((i) => i.path).join(', '));
        return false;
      },
    });

    const rawLLMClient = opts.llmClient ?? await pickClient();

    // I3: wrap with cost tracker.
    costTracker = { inputTokens: 0, outputTokens: 0, provider: rawLLMClient.providerName };
    const llmClient = wrapWithCostTracking(rawLLMClient, costTracker);

    let ctx = await assembleTargetContext(opts.cwd);

    // Spec §8.2 MVP: when the project uses Supabase auth and no env credentials
    // are present, create a temporary Supabase user for the session.
    if (ctx.testCredentials.source === 'none' && ctx.authProvider === 'supabase') {
      const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
      if (supabaseUrl && serviceKey) {
        try {
          const admin = await buildSupabaseAdminClient(supabaseUrl, serviceKey);
          const handle = await createSupabaseTempUser({ adminClient: admin });
          tempUserHandle = handle;
          // Mutate the context to reflect we now have credentials.
          ctx = {
            ...ctx,
            testCredentials: { source: 'supabase-temp-user', email: handle.email, password: handle.password },
          };
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`autopilot: supabase temp-user creation failed: ${(err as Error).message}; continuing with anonymous flows only`);
        }
      }
    }

    // I1: --regenerate wipes existing qa/contracts before Phase A/B write fresh files.
    if (opts.regenerate) {
      await rm(join(opts.cwd, 'qa/contracts/_smoke'), { recursive: true, force: true });
      // Walk module dirs and remove them so LLM discovery starts fresh.
      const moduleDirs = ['auth', 'core', 'admin'];
      for (const m of moduleDirs) {
        await rm(join(opts.cwd, 'qa/contracts', m), { recursive: true, force: true });
      }
    }

    // Phase A: write smoke patterns; run HTTP ones inline, defer Playwright ones.
    emit({ type: 'phase', phase: 'A', status: 'active', elapsedMs: elapsed() });
    const patterns = applicablePatterns(ctx);
    emit({
      type: 'log',
      level: 'info',
      message: `Writing ${patterns.length} smoke patterns to qa/contracts/_smoke/`,
      elapsedMs: elapsed(),
    });
    const smokePaths = await writeSmokeContracts(opts.cwd, patterns, ctx);
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
        const issuePath = await writeIssueEvidence(opts.cwd, {
          contractPath: p,
          phase: 'A',
          contractId: f.id,
          reason: f.reason,
        });
        if (issuePath) issuesWritten.push(issuePath);
        queue.push({ priority: 0, failure: f, contractPath: p, evidencePath: issuePath ?? undefined });
      }
      emit({
        type: 'phase',
        phase: 'A',
        status: 'active',
        elapsedMs: elapsed(),
        counters: { passed: phaseA.passed, failed: phaseA.failed, deferred: phaseA.deferred },
      });
    }
    emit({
      type: 'phase',
      phase: 'A',
      status: 'done',
      elapsedMs: elapsed(),
      counters: { passed: phaseA.passed, failed: phaseA.failed, deferred: phaseA.deferred },
    });

    // Phase B (sequential per module) — concurrent with Phase C consumer.
    let phaseBDone = false;

    // I5: skip Phase C worker entirely when --no-fix is set.
    if (!fixEnabled) {
      emit({ type: 'phase', phase: 'C', status: 'skipped', elapsedMs: elapsed() });
    }
    const phaseCDone = fixEnabled ? (async () => {
      // Validate config once, up front.
      if (opts.fixStrategy === 'shadow' && !opts.shadowCoordinator) {
        throw new Error('fixStrategy=shadow requires shadowCoordinator');
      }

      emit({ type: 'phase', phase: 'C', status: 'active', elapsedMs: elapsed() });
      // Temp dir for fix prompt files written during Phase C (in-place mode only).
      const tmpDir = join(opts.cwd, 'qa/.autopilot-fix-tmp');
      if (opts.fixStrategy !== 'shadow') {
        await mkdir(tmpDir, { recursive: true });
      }

      while (true) {
        if (abortController.signal.aborted) break;

        // Sort queue by priority before dequeuing so Phase A failures (priority 0)
        // are processed before Phase B failures (priority 1).
        queue.sort((a, b) => a.priority - b.priority);
        const next = queue.shift();
        if (!next) {
          await new Promise((r) => setTimeout(r, 50));
          if (queue.length === 0 && phaseBDone) break;
          continue;
        }

        phaseC.attempted++;
        emit({
          type: 'phase',
          phase: 'C',
          status: 'active',
          elapsedMs: elapsed(),
          counters: { attempted: phaseC.attempted, fixed: phaseC.fixed, givenUp: phaseC.givenUp },
        });

        if (opts.fixStrategy === 'shadow') {
          // Phase C: shadow strategy — delegate each failure to shadowCoordinator.
          // Creates a worktree per fix and opens a GitHub PR. No in-place edits.
          // Defensive: writeIssueEvidence may return null on write failure. Skip rather than
          // forward an empty path to the coordinator (which would then try to readFile('')).
          if (!next.evidencePath) {
            phaseC.givenUp++;
            emit({
              type: 'log',
              level: 'warn',
              message: `autopilot: shadow-fix skipped ${next.failure.id} — no evidence path (writeIssueEvidence returned null)`,
              elapsedMs: elapsed(),
            });
            continue;
          }
          try {
            const outcome = await opts.shadowCoordinator!.fix({
              issueId: next.failure.id,
              issueJsonPath: next.evidencePath,
              failingContractPath: next.contractPath,
              bundlePath: join(next.evidencePath, '..'),
            });
            fixOutcomes.push(outcome);
            if (outcome.outcome === 'SUCCESS' || outcome.outcome === 'SKIPPED_PR_EXISTS') {
              phaseC.fixed++;
            } else {
              phaseC.givenUp++;
              const giveUpMsg = `autopilot: shadow-fix gave up on ${next.failure.id} (outcome: ${outcome.outcome})`;
              emit({ type: 'log', level: 'warn', message: giveUpMsg, elapsedMs: elapsed() });
              // eslint-disable-next-line no-console
              console.warn(giveUpMsg);
            }
          } catch (err) {
            phaseC.givenUp++;
            const errMsg = `autopilot: shadow-fix error for ${next.failure.id}: ${(err as Error).message}`;
            emit({ type: 'log', level: 'error', message: errMsg, elapsedMs: elapsed() });
            // eslint-disable-next-line no-console
            console.warn(errMsg);
          }
        } else {
          // Phase C: Option A — call runFixLoop directly with a custom fix callback.
          // runClaudeFix uses the autopilot's llmClient; no PR, no worktree, in-place fix.
          try {
            const promptPath = await writeAutopilotFixPrompt(next.contractPath, next.failure, tmpDir);
            const loop = await runFixLoop({
              maxAttempts: 3,
              fix: async (_attempt) =>
                runClaudeFix({
                  promptPath,
                  cwd: opts.cwd,
                  allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
                  llmClient,
                  signal: abortController.signal,
                }),
            });

            if (loop.outcome === 'SUCCESS') {
              const lastResult = loop.history.at(-1);
              const patchDiff = lastResult?.patch_diff;
              if (patchDiff) {
                // Accumulate the diff — unified application happens after Phase B+C complete.
                accumulatedDiffs.push(patchDiff);
              }
              phaseC.fixed++;
            } else {
              // EXHAUSTED, CONTRACT_REVISION_NEEDED, PARSE_ERROR — give up on this item.
              phaseC.givenUp++;
              const giveUpMsg = `autopilot: fix gave up on ${next.failure.id} (outcome: ${loop.outcome})`;
              emit({ type: 'log', level: 'warn', message: giveUpMsg, elapsedMs: elapsed() });
              // eslint-disable-next-line no-console
              console.warn(giveUpMsg);
            }
          } catch (err) {
            phaseC.givenUp++;
            const errMsg = `autopilot: fix error for ${next.failure.id}: ${(err as Error).message}`;
            emit({ type: 'log', level: 'error', message: errMsg, elapsedMs: elapsed() });
            // eslint-disable-next-line no-console
            console.warn(errMsg);
          }
        }

        emit({
          type: 'phase',
          phase: 'C',
          status: 'active',
          elapsedMs: elapsed(),
          counters: { attempted: phaseC.attempted, fixed: phaseC.fixed, givenUp: phaseC.givenUp },
        });
      }

      // Clean up temp dir (in-place mode only).
      if (opts.fixStrategy !== 'shadow') {
        await rm(tmpDir, { recursive: true, force: true });
      }
      emit({
        type: 'phase',
        phase: 'C',
        status: 'done',
        elapsedMs: elapsed(),
        counters: { attempted: phaseC.attempted, fixed: phaseC.fixed, givenUp: phaseC.givenUp },
      });
    })() : Promise.resolve();

    const phaseBRun = (async () => {
      emit({ type: 'phase', phase: 'B', status: 'active', elapsedMs: elapsed() });
      emit({
        type: 'log',
        level: 'info',
        message: 'Reading source, asking LLM for per-module contracts',
        elapsedMs: elapsed(),
      });
      if (
        opts.discoveryMode !== undefined &&
        opts.discoveryMode !== 'modules' &&
        opts.discoveryMode !== 'deep'
      ) {
        throw new Error(
          `Invalid discoveryMode: ${JSON.stringify(opts.discoveryMode)}. Must be 'modules' or 'deep'.`,
        );
      }
      if (opts.discoveryMode === 'deep') {
        emit({ type: 'log', level: 'info', message: '[autopilot] Phase B using deep (interaction-driven) discovery', elapsedMs: elapsed() });
        const result = await discoverByInteraction({
          cwd: opts.cwd,
          llmClient,
          signal: abortController.signal,
          concurrency: opts.deepConcurrency,
          maxContracts: opts.deepMaxContracts,
          onEvent: (e) => {
            if (e.type === 'log') {
              emit({ type: 'log', level: e.level, message: e.message, elapsedMs: elapsed() });
            } else if (e.type === 'progress') {
              emit({
                type: 'phase',
                phase: 'B',
                status: 'active',
                elapsedMs: elapsed(),
                counters: { generated: e.done },
              });
            } else if (e.type === 'stage') {
              const msg = `[autopilot] deep discovery ${e.stage}: ${e.status}`;
              emit({ type: 'log', level: 'info', message: msg, elapsedMs: elapsed() });
            }
          },
        });
        // The deep path writes contracts directly to disk. Skip the per-module
        // callback that the modules path uses. Phase B counters reflect generated
        // contracts:
        phaseB.generated += result.contractsWritten;
        if (result.fallbackUsed) {
          emit({ type: 'log', level: 'warn', message: `[autopilot] deep fell back: ${result.fallbackReason}`, elapsedMs: elapsed() });
        }
      } else {
        // existing modules path — unchanged below
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
              if (r.passed === 'deferred') {
                phaseB.deferred++;
                // Playwright-based contracts are written but not executed; do not enqueue for fix.
              } else if (r.passed === false) {
                phaseB.failed++;
                const failureId = p.split('/').pop()!;
                const failureReason = r.reason ?? 'unknown';
                const issuePath = await writeIssueEvidence(opts.cwd, {
                  contractPath: p,
                  phase: 'B',
                  contractId: failureId,
                  reason: failureReason,
                });
                if (issuePath) issuesWritten.push(issuePath);
                queue.push({ priority: 1, failure: { id: failureId, reason: failureReason }, contractPath: p, evidencePath: issuePath ?? undefined });
              }
            }
            emit({
              type: 'phase',
              phase: 'B',
              status: 'active',
              elapsedMs: elapsed(),
              counters: {
                generated: phaseB.generated,
                failed: phaseB.failed,
                deferred: phaseB.deferred,
                userConfirmed: phaseB.userConfirmed,
                userRejected: phaseB.userRejected,
              },
            });
          },
          abortController.signal,
          { onQuarantine: (raw, m) => { void writeQuarantine(opts.cwd, m, raw); } },
        );
      }
      phaseBDone = true;
      emit({
        type: 'phase',
        phase: 'B',
        status: 'done',
        elapsedMs: elapsed(),
        counters: {
          generated: phaseB.generated,
          failed: phaseB.failed,
          deferred: phaseB.deferred,
          userConfirmed: phaseB.userConfirmed,
          userRejected: phaseB.userRejected,
        },
      });
    })();

    await Promise.all([phaseBRun, phaseCDone]);
    budget.cancel();

    // Spec §7: unified diff application — apply all accumulated fix diffs after Phase B+C complete.
    for (const diff of accumulatedDiffs) {
      try {
        await new Promise<void>((resolve, reject) => {
          const child = execFile('git', ['apply', '--index', '-'], { cwd: opts.cwd }, (err) => err ? reject(err) : resolve());
          // Fix 2: use end(chunk) instead of write+end to handle backpressure for large diffs
          // (stream.end(chunk) buffers internally and handles pipe-buffer overflow >64KB correctly).
          child.stdin?.end(diff);
        });
        phaseC.diffs.push('<applied>');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`autopilot: failed to apply diff: ${(err as Error).message}`);
      }
    }

    // I3: cost tracker is now populated on the outer-scope costTracker; writeReport reads it.
    return await writeReport();
  } catch (err) {
    // Guarantee a partial report file exists even on unexpected throws.
    await writeReport().catch(() => { /* don't mask original error */ });
    throw err;
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (tempUserHandle) {
      await tempUserHandle.dispose().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`autopilot: temp-user dispose failed: ${(err as Error).message}`);
      });
    }
    budget.cancel();
    await stashGuard.release();
  }
}

/**
 * Walks qa/issues/*\/issue.json under cwd and merges any not already in
 * `issuesWritten` into the array. This lets `contractqa run` (or a hand-
 * crafted evidence drop) be picked up by the autopilot report so downstream
 * consumers don't have to scan separately.
 */
async function scanOrphanIssues(cwd: string, issuesWritten: string[]): Promise<void> {
  try {
    const issuesRoot = join(cwd, 'qa', 'issues');
    const entries = await readdir(issuesRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const path = join(issuesRoot, e.name, 'issue.json');
      try {
        await access(path);
      } catch {
        continue; // no issue.json — skip
      }
      if (!issuesWritten.includes(path)) issuesWritten.push(path);
    }
  } catch {
    // qa/issues/ doesn't exist — nothing to scan, not an error
  }
}

/**
 * Write a minimal issue.json + state-diff.json stub for a contract failure
 * during Phase A or Phase B. Returns the absolute path to the issue.json
 * (or null on write failure). Stub state-diff carries no real before/after
 * data — Phase A/B are HTTP-only and can't capture browser state. Downstream
 * (contractqa run / Playwright) replaces this with rich evidence later.
 */
async function writeIssueEvidence(
  cwd: string,
  input: { contractPath: string; phase: 'A' | 'B'; contractId: string; reason: string },
): Promise<string | null> {
  try {
    const safeId = input.contractId.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
    const issueDir = join(cwd, 'qa', 'issues', `i_phase${input.phase}_${safeId}`);
    await mkdir(join(issueDir, 'diffs'), { recursive: true });

    const issueJson = {
      title: `Phase ${input.phase} contract failed: ${input.contractId}`,
      contract_id: input.contractId,
      contract_path: input.contractPath,
      severity: input.phase === 'A' ? 'medium' : 'low',
      confidence: 0.8,
      phase: input.phase,
      reason: input.reason,
      expected: 'contract assertion to hold',
      actual: input.reason,
      artifacts: {
        state_diff: 'diffs/state-diff.json',
      },
    };
    const issueJsonPath = join(issueDir, 'issue.json');
    await writeFile(issueJsonPath, JSON.stringify(issueJson, null, 2));

    // Stub state diff so the dashboard's StateDiffViewer has something to
    // render. Real diffs come from Playwright runs via contractqa run.
    const stubDiff = {
      diff: {
        url: { before: '', after: '', changed: false },
        localStorage: { added: [], removed: [] },
        cookies: { added: [], removed: [] },
      },
    };
    await writeFile(join(issueDir, 'diffs', 'state-diff.json'), JSON.stringify(stubDiff, null, 2));

    return issueJsonPath;
  } catch {
    // Best-effort: never let evidence writing break a run.
    return null;
  }
}
