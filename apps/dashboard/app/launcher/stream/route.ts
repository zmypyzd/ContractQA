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
import { runAutopilot } from 'contractqa';
import type { AutopilotProgressEvent } from 'contractqa';
import { pickClient, LLMConfigError } from '@contractqa/orchestrator/llm';
import { type LauncherEvent, encodeEvent } from '../events';

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
  const runId = newRunId();
  const startedAt = Date.now();
  const abortController = new AbortController();

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

        const report = await runAutopilot({
          cwd,
          fix: fixEnabled,
          yes: true, // non-interactive: there's no stdin TTY behind a route handler
          llmClient,
          onProgress: (event: AutopilotProgressEvent) => {
            // Autopilot's event shape was deliberately aligned with LauncherEvent
            // — counter field names match AutopilotReport. So this is a
            // structural passthrough; we only widen the type.
            emit(event as LauncherEvent);
          },
        });

        emit({
          type: 'run-end',
          runId,
          outcome: report.budgetTriggered === 'user-interrupt'
            ? 'interrupt'
            : report.budgetTriggered === 'time-budget'
              ? 'budget'
              : 'success',
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

function newRunId(): string {
  // Compact, sortable, no external dep. Format: r_<base36 ms><4 random>
  const ms = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `r_${ms}${rnd}`.toUpperCase();
}
