/**
 * SSE endpoint that streams autopilot phase events to the launcher UI.
 *
 * GET /launcher/stream?cwd=<absolute-path>&fix=<true|false>
 *
 * Calls runAutopilot() from the `contractqa` package directly (in-process)
 * with an onProgress callback that forwards every phase / log event into the
 * stream. The autopilot writes qa/AUTOPILOT_REPORT.md to the target cwd on
 * completion and that path is reported in the run-end event.
 */

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { runAutopilot } from 'contractqa';
import type { AutopilotProgressEvent, AutopilotPhaseCounters } from 'contractqa';
import { pickClient, LLMConfigError } from '@contractqa/orchestrator/llm';
import { type LauncherEvent, encodeEvent } from '../events';
import { db } from '../../../lib/db';
import { runs } from '../../../drizzle/schema';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
// SSE needs the Node runtime — the Edge runtime doesn't support long-lived
// streams the same way and lacks node:fs.
export const runtime = 'nodejs';
// Autopilot can run up to 30 min by default; Next.js caps server-action /
// route handlers via maxDuration. 0 disables the cap (Node runtime only).
export const maxDuration = 0;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawCwd = url.searchParams.get('cwd') ?? '';
  const fixEnabled = url.searchParams.get('fix') !== 'false';

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
  const startedAt = Date.now();
  const abortController = new AbortController();

  // Create the DB record up front so the runId in the stream matches the row
  // in /runs. Falls back to a synthetic id if Postgres is unreachable; the run
  // continues either way.
  const branch = await detectBranch(cwd);
  const dbRunId = await createRunRecord(cwd, branch, fixEnabled);
  const runId = dbRunId ?? newSyntheticId();
  const usingDb = dbRunId !== null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      };

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

      emit({ type: 'run-start', runId, cwd, fixEnabled, startedAt });

      try {
        // Pre-flight: pick the LLM client up front so a missing key fails fast
        // with a clear log line, not a vague mid-run error.
        let llmClient;
        try {
          llmClient = await pickClient();
          emit({
            type: 'log',
            level: 'info',
            message: `LLM ready · ${llmClient.providerName} · ${llmClient.modelHint}`,
            elapsedMs: Date.now() - startedAt,
          });
        } catch (err) {
          if (err instanceof LLMConfigError) {
            emit({
              type: 'log',
              level: 'error',
              message: `No LLM configured. Tried: ${err.tried.join(', ')}. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or log in via Claude Code, then restart the dev server.`,
              elapsedMs: Date.now() - startedAt,
            });
            emit({
              type: 'run-end',
              runId,
              outcome: 'error',
              durationMs: Date.now() - startedAt,
              error: 'LLMConfigError',
            });
            close();
            return;
          }
          throw err;
        }

        // Track final phase counters for run totals; updated on every phase event.
        const phaseTotals: Partial<Record<'A' | 'B' | 'C', AutopilotPhaseCounters>> = {};

        const report = await runAutopilot({
          cwd,
          fix: fixEnabled,
          yes: true, // non-interactive: there's no stdin TTY behind a route handler
          llmClient,
          onProgress: (event: AutopilotProgressEvent) => {
            // Autopilot's event shape was deliberately aligned with LauncherEvent
            // — counter field names match AutopilotReport. So this is a
            // structural passthrough; we only widen the type.
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

        // Aggregate totals across all phases for the runs row.
        const totalsForDb = aggregateTotals(phaseTotals);

        if (usingDb) {
          await completeRunRecord(runId, mapOutcomeToStatus(outcome, false), totalsForDb);
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
          elapsedMs: Date.now() - startedAt,
        });
        if (usingDb) {
          await completeRunRecord(runId, mapOutcomeToStatus(isAbort ? 'interrupt' : 'error', true), null);
        }
        emit({
          type: 'run-end',
          runId,
          outcome: isAbort ? 'interrupt' : 'error',
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        close();
      }
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
  // Used when Postgres is unreachable. Format: r_<base36 ms><4 random>.
  const ms = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `r_${ms}${rnd}`.toUpperCase();
}

/**
 * Read the current git branch in the target cwd. Best-effort: returns null if
 * git isn't installed or the dir isn't a repo.
 */
async function detectBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const branch = stdout.trim();
    return branch === 'HEAD' || branch === '' ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Insert a fresh runs row with status=running. Returns the DB-generated UUID,
 * or null when Postgres is unavailable. Never throws.
 */
async function createRunRecord(cwd: string, branch: string | null, _fixEnabled: boolean): Promise<string | null> {
  try {
    const [row] = await db
      .insert(runs)
      .values({
        triggerType: 'launcher',
        branch,
        cwd,
        status: 'running',
        startedAt: new Date(),
      })
      .returning({ id: runs.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Update the runs row with final status / endedAt / totals. Silently swallows
 * errors so a flapping DB connection can't crash the stream after the run
 * has finished.
 */
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
    // already-logged elsewhere
  }
}

function aggregateTotals(
  phaseTotals: Partial<Record<'A' | 'B' | 'C', AutopilotPhaseCounters>>,
): Record<string, number> {
  // Roll the per-phase counter map into a single object that maps cleanly to
  // /runs's "Totals" column display: passed (across all phases), failed,
  // deferred, plus the autopilot-native fields for inspection.
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
