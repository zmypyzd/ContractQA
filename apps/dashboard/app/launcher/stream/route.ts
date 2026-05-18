/**
 * SSE endpoint that streams autopilot phase events to the launcher UI.
 *
 * GET /launcher/stream?cwd=<absolute-path>&fix=<true|false>&watch=<true|false>
 *
 * - Default: run autopilot once, emit events, then close.
 * - watch=true: run once, then keep the stream open and re-run on every
 *   debounced filesystem change in cwd (ignoring node_modules, .git, qa, etc.
 *   so autopilot's own output doesn't cause an infinite loop). Each iteration
 *   gets its own DB row and its own run-start/run-end pair.
 *
 * Both modes call runAutopilot in-process with an onProgress callback that
 * forwards every phase/log event into the SSE stream. The autopilot writes
 * qa/AUTOPILOT_REPORT.md to the target cwd; the path lands in the run-end
 * event.
 */

import { resolve } from 'node:path';
import { stat, readFile, watch as watchAsync } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { runAutopilot, createNightShiftCoordinator, AutoPrPreflightError } from 'contractqa';
import type {
  AutopilotProgressEvent,
  AutopilotPhaseCounters,
  ShadowFixCoordinator,
} from 'contractqa';
import { pickClient, LLMConfigError, type LLMClient } from '@contractqa/orchestrator/llm';
import { type LauncherEvent, encodeEvent } from '../events';
import { db } from '../../../lib/db';
import { runs, issues } from '../../../drizzle/schema';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
// SSE needs the Node runtime — the Edge runtime doesn't support long-lived
// streams the same way and lacks node:fs.
export const runtime = 'nodejs';
// Autopilot can run up to 30 min by default; Next.js caps server-action /
// route handlers via maxDuration. 0 disables the cap (Node runtime only).
export const maxDuration = 0;

const WATCH_DEBOUNCE_MS = 2000;
const WATCH_IGNORED_TOP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  '.vercel',
  '.parcel-cache',
  'coverage',
  '.nyc_output',
  'qa', // autopilot's own output — watching it would loop forever
]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawCwd = url.searchParams.get('cwd') ?? '';
  const fixEnabled = url.searchParams.get('fix') !== 'false';
  const watchEnabled = url.searchParams.get('watch') === 'true';
  const autoPrEnabled = url.searchParams.get('autoPr') === 'true';
  const discoveryMode = url.searchParams.get('discoveryMode') === 'deep' ? 'deep' : 'modules';

  if (!rawCwd.trim()) {
    return errorResponse('Missing cwd query parameter.');
  }

  const cwd = resolve(rawCwd);
  try {
    const s = await stat(cwd);
    if (!s.isDirectory()) return errorResponse(`Not a directory: ${cwd}`);
  } catch {
    return errorResponse(`Path not accessible: ${cwd}`);
  }

  const encoder = new TextEncoder();
  const branch = await detectBranch(cwd);
  // One watch session per SSE connection in watch mode; null otherwise. All
  // run rows produced by this connection share the id so /runs can group them.
  const watchSessionId = watchEnabled ? randomUUID() : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let watcher: FSWatcher | null = null;
      let debounceTimer: NodeJS.Timeout | null = null;
      let inFlight: Promise<void> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher?.close();
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      };

      const abortController = new AbortController();
      // Client closed the tab / navigated → abort the autopilot run so we don't
      // burn LLM credits on a result nobody will see.
      req.signal.addEventListener('abort', () => {
        abortController.abort();
        close();
      });

      const emit = (event: LauncherEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          close();
        }
      };

      // Pre-flight: pick the LLM client once, shared across iterations in
      // watch mode. A missing key fails fast with a clean log + run-end.
      let llmClient: LLMClient;
      try {
        llmClient = await pickClient();
      } catch (err) {
        const isLlmErr = err instanceof LLMConfigError;
        const runId = newSyntheticId();
        emit({ type: 'run-start', runId, cwd, fixEnabled, startedAt: Date.now() });
        emit({
          type: 'log',
          level: 'error',
          message: isLlmErr
            ? `No LLM configured. Tried: ${(err as LLMConfigError).tried.join(', ')}. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or log in via Claude Code, then restart the dev server.`
            : err instanceof Error ? err.message : String(err),
          elapsedMs: 0,
        });
        emit({
          type: 'run-end',
          runId,
          outcome: 'error',
          durationMs: 0,
          error: isLlmErr ? 'LLMConfigError' : (err instanceof Error ? err.message : String(err)),
        });
        close();
        return;
      }

      emit({
        type: 'log',
        level: 'info',
        message: `LLM ready · ${llmClient.providerName} · ${llmClient.modelHint}`,
        elapsedMs: 0,
      });

      // Night-shift coordinator (auto-pr mode). Preflight runs gh/git/branch/remote
      // checks; failure emits a clean error log + run-end and closes the stream.
      let shadowCoordinator: ShadowFixCoordinator | null = null;
      if (autoPrEnabled) {
        try {
          shadowCoordinator = await createNightShiftCoordinator({
            cwd,
            regressionScope: 'touched-files',
            dashboardUrl: process.env.NEXT_PUBLIC_DASHBOARD_URL,
            onPreflightOk: (preflight) => {
              emit({
                type: 'log',
                level: 'info',
                message: `night-shift ON · base branch: ${preflight.baseBranch} · regression scope: touched-files`,
                elapsedMs: 0,
              });
              emit({
                type: 'log',
                level: 'info',
                message: `note: new fixes only appear when source files change`,
                elapsedMs: 0,
              });
            },
            onPreflightFail: (reason) => {
              emit({ type: 'log', level: 'error', message: `night-shift preflight: ${reason}`, elapsedMs: 0 });
            },
          });
        } catch (err) {
          const isPreflight = err instanceof AutoPrPreflightError;
          const runId = newSyntheticId();
          emit({ type: 'run-start', runId, cwd, fixEnabled, startedAt: Date.now() });
          if (!isPreflight) {
            emit({
              type: 'log',
              level: 'error',
              message: err instanceof Error ? err.message : String(err),
              elapsedMs: 0,
            });
          }
          emit({
            type: 'run-end',
            runId,
            outcome: 'error',
            durationMs: 0,
            error: isPreflight ? 'AutoPrPreflightError' : (err instanceof Error ? err.message : String(err)),
          });
          close();
          return;
        }
      }

      // Single-iteration runner. Returns when the run finishes (success or
      // error); never throws. In watch mode, called repeatedly.
      const runOnce = async (trigger: string): Promise<void> => {
        if (closed) return;
        const iterStartedAt = Date.now();
        const dbRunId = await createRunRecord(cwd, branch, fixEnabled, watchSessionId);
        const runId = dbRunId ?? newSyntheticId();
        const usingDb = dbRunId !== null;

        emit({ type: 'run-start', runId, cwd, fixEnabled, startedAt: iterStartedAt });
        if (trigger !== 'initial') {
          emit({
            type: 'log',
            level: 'info',
            message: `watch · re-run triggered by ${trigger}`,
            elapsedMs: 0,
          });
        }

        const phaseTotals: Partial<Record<'A' | 'B' | 'C', AutopilotPhaseCounters>> = {};

        try {
          const report = await runAutopilot({
            cwd,
            fix: fixEnabled,
            yes: true,
            llmClient,
            fixStrategy: shadowCoordinator ? 'shadow' : 'inPlace',
            shadowCoordinator: shadowCoordinator ?? undefined,
            discoveryMode,                  // ← new
            onProgress: (event: AutopilotProgressEvent) => {
              if (event.type === 'phase' && event.counters) {
                phaseTotals[event.phase] = event.counters;
              }
              emit(event as LauncherEvent);
            },
          });

          const outcome: 'success' | 'budget' | 'interrupt' =
            report.budgetTriggered === 'user-interrupt'
              ? 'interrupt'
              : report.budgetTriggered === 'time-budget'
                ? 'budget'
                : 'success';

          if (usingDb) {
            await completeRunRecord(runId, mapOutcomeToStatus(outcome, false), aggregateTotals(phaseTotals));
            // Register any issue evidence the autopilot wrote this iteration.
            // Safe to call even when nothing was written (returns 0).
            const registered = await registerIssuesFromReport(runId, report.issuesWritten ?? [], report.fixOutcomes);
            if (registered > 0) {
              emit({
                type: 'log',
                level: 'info',
                message: `registered ${registered} issue${registered === 1 ? '' : 's'} from evidence`,
                elapsedMs: report.durationMs,
              });
            }
          }

          emit({
            type: 'run-end',
            runId,
            outcome,
            durationMs: report.durationMs,
            reportPath: `${cwd}/qa/AUTOPILOT_REPORT.md`,
          });
        } catch (err) {
          const isAbort = err instanceof Error && (err.name === 'AbortError' || abortController.signal.aborted);
          emit({
            type: 'log',
            level: 'error',
            message: err instanceof Error ? err.message : String(err),
            elapsedMs: Date.now() - iterStartedAt,
          });
          if (usingDb) {
            await completeRunRecord(runId, mapOutcomeToStatus(isAbort ? 'interrupt' : 'error', true), null);
          }
          emit({
            type: 'run-end',
            runId,
            outcome: isAbort ? 'interrupt' : 'error',
            durationMs: Date.now() - iterStartedAt,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      // Run once.
      await runOnce('initial');

      if (!watchEnabled || closed) {
        close();
        return;
      }

      // Watch mode: stay open, debounce-rerun on file changes. Chain instead
      // of overlapping so two autopilot calls can't race on the same cwd.
      emit({
        type: 'log',
        level: 'info',
        message: `watch · watching ${cwd} (ignoring node_modules, .git, qa, ...)`,
        elapsedMs: 0,
      });

      const scheduleRun = (trigger: string): void => {
        if (closed) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          const start = async () => {
            await runOnce(trigger);
            inFlight = null;
          };
          if (inFlight) {
            inFlight = inFlight.then(() => start());
          } else {
            inFlight = start();
          }
        }, WATCH_DEBOUNCE_MS);
      };

      try {
        watcher = watch(cwd, { recursive: true, persistent: true }, (_event, filename) => {
          if (!filename) return;
          const top = filename.split(sep)[0] ?? '';
          if (WATCH_IGNORED_TOP_DIRS.has(top)) return;
          if (top.startsWith('.') && top !== '.env' && top !== '.env.local') return;
          scheduleRun(filename);
        });
      } catch (err) {
        emit({
          type: 'log',
          level: 'error',
          message: `watch · could not start recursive watch: ${err instanceof Error ? err.message : String(err)}`,
          elapsedMs: 0,
        });
        close();
        return;
      }

      // Hold the stream open until the client closes it. Active autopilot
      // runs continue in the inFlight chain.
      await new Promise<void>((resolveHold) => {
        req.signal.addEventListener('abort', () => resolveHold());
        const interval = setInterval(() => {
          if (closed) {
            clearInterval(interval);
            resolveHold();
          }
        }, 500);
      });

      // Best-effort: wait for any in-flight run to settle so the DB row gets
      // closed out properly before we close the stream.
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // already-logged
        }
      }
      close();

      // Keep watchAsync import alive in case future iterations want async API.
      void watchAsync;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function errorResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function newSyntheticId(): string {
  const ms = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `r_${ms}${rnd}`.toUpperCase();
}

async function detectBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const branch = stdout.trim();
    return branch === 'HEAD' || branch === '' ? null : branch;
  } catch {
    return null;
  }
}

async function createRunRecord(
  cwd: string,
  branch: string | null,
  _fixEnabled: boolean,
  watchSessionId: string | null,
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(runs)
      .values({
        triggerType: watchSessionId ? 'launcher-watch' : 'launcher',
        branch,
        cwd,
        status: 'running',
        startedAt: new Date(),
        watchSessionId,
      })
      .returning({ id: runs.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function completeRunRecord(
  id: string,
  status: 'passed' | 'failed' | 'interrupted' | 'error',
  totals: Record<string, number> | null,
): Promise<void> {
  try {
    await db
      .update(runs)
      .set({
        status,
        endedAt: new Date(),
        totals: totals ?? null,
      })
      .where(eq(runs.id, id));
  } catch {
    // ignore
  }
}

/**
 * Reads every issue.json path produced this run and INSERTs an issues row
 * linked to the runId. Best-effort: malformed JSON, unreadable files, or DB
 * outages are silently skipped (the autopilot run still completed, the report
 * on disk is still the source of truth). Returns the number of rows actually
 * inserted so the SSE log can mention it.
 */
async function registerIssuesFromReport(
  runId: string,
  issuePaths: string[],
  fixOutcomes?: Array<{ issueJsonPath: string; outcome: string; prUrl?: string; branch?: string }>,
): Promise<number> {
  if (issuePaths.length === 0) return 0;
  const fixMap = new Map<string, { outcome: string; prUrl?: string; branch?: string }>();
  for (const fo of fixOutcomes ?? []) {
    fixMap.set(fo.issueJsonPath, { outcome: fo.outcome, prUrl: fo.prUrl, branch: fo.branch });
  }
  let inserted = 0;
  for (const issueJsonPath of issuePaths) {
    try {
      const fix = fixMap.get(issueJsonPath);
      // De-dupe by path: autopilot's orphan-scan re-emits the same paths on
      // every run, so without this check the issues table would grow unboundedly
      // for each watch iteration. In night-shift mode, we also UPDATE existing
      // rows with fresh fix metadata (an issue's outcome can flip across iterations).
      const existing = await db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.issueJsonPath, issueJsonPath))
        .limit(1);
      if (existing.length > 0) {
        if (fix) {
          await db
            .update(issues)
            .set({
              fixOutcome: fix.outcome ?? null,
              fixPrUrl: fix.prUrl ?? null,
              fixBranch: fix.branch ?? null,
            })
            .where(eq(issues.id, existing[0]!.id));
        }
        continue;
      }

      const raw = await readFile(issueJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        title?: string;
        severity?: string;
        confidence?: number;
        status?: string;
      };
      await db.insert(issues).values({
        runId,
        title: parsed.title ?? null,
        severity: parsed.severity ?? null,
        confidence: parsed.confidence != null ? String(parsed.confidence) : null,
        status: parsed.status ?? 'open',
        issueJsonPath,
        fixOutcome: fix?.outcome ?? null,
        fixPrUrl: fix?.prUrl ?? null,
        fixBranch: fix?.branch ?? null,
      });
      inserted++;
    } catch {
      // skip malformed / unreadable; do not block the rest
    }
  }
  return inserted;
}

function aggregateTotals(
  phaseTotals: Partial<Record<'A' | 'B' | 'C', AutopilotPhaseCounters>>,
): Record<string, number> {
  const a = phaseTotals.A ?? {};
  const b = phaseTotals.B ?? {};
  const c = phaseTotals.C ?? {};
  const passed = (a.passed ?? 0) + (b.generated ?? 0);
  const failed = (a.failed ?? 0) + (b.failed ?? 0) + (c.givenUp ?? 0);
  const deferred = (a.deferred ?? 0) + (b.deferred ?? 0);
  return {
    passed,
    failed,
    deferred,
    a_passed: a.passed ?? 0,
    a_failed: a.failed ?? 0,
    b_generated: b.generated ?? 0,
    b_failed: b.failed ?? 0,
    b_confirmed: b.userConfirmed ?? 0,
    b_rejected: b.userRejected ?? 0,
    c_attempted: c.attempted ?? 0,
    c_fixed: c.fixed ?? 0,
    c_givenUp: c.givenUp ?? 0,
  };
}

function mapOutcomeToStatus(
  outcome: 'success' | 'budget' | 'interrupt' | 'error',
  hadException: boolean,
): 'passed' | 'failed' | 'interrupted' | 'error' {
  if (outcome === 'interrupt') return 'interrupted';
  if (outcome === 'error' || hadException) return 'error';
  if (outcome === 'budget') return 'failed';
  return 'passed';
}
