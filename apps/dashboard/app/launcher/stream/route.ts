/**
 * SSE endpoint that streams autopilot phase events to the launcher UI.
 *
 * GET /launcher/stream?cwd=<absolute-path>&fix=<true|false>
 *
 * Today: emits a scripted stub run with realistic timing for A/B/C phases so
 * the wire and UI are testable end-to-end.
 *
 * TODO(real-autopilot): replace `stubRun` with `spawnAutopilot` once the CLI
 * grows structured progress output. Sketch:
 *   const child = spawn('pnpm', ['exec', 'contractqa', 'autopilot', '--json-progress'],
 *                       { cwd, env: { ...process.env, CONTRACTQA_PROGRESS: '1' } });
 *   readline(child.stdout).on('line', (line) => {
 *     const event = parseProgressLine(line);
 *     if (event) controller.enqueue(textEncoder.encode(encodeEvent(event)));
 *   });
 *   child.on('exit', (code) => emit({ type:'run-end', outcome: code===0?'success':'error', ... }));
 */

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { type LauncherEvent, encodeEvent } from '../events';

export const dynamic = 'force-dynamic';
// SSE needs the Node runtime — the Edge runtime doesn't support long-lived
// streams the same way and lacks node:fs.
export const runtime = 'nodejs';

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

      // Client may abort (tab closed, navigation). Listen for it.
      req.signal.addEventListener('abort', close);

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
        await stubRun(emit, startedAt, fixEnabled, req.signal);
        emit({
          type: 'run-end',
          runId,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          reportPath: `${cwd}/qa/AUTOPILOT_REPORT.md`,
        });
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Scripted stub of a successful autopilot run. Replace with real subprocess
 * integration once the CLI emits progress events.
 */
async function stubRun(
  emit: (event: LauncherEvent) => void,
  startedAt: number,
  fixEnabled: boolean,
  signal: AbortSignal,
): Promise<void> {
  const elapsed = () => Date.now() - startedAt;

  // ============ Phase A: Smoke ============
  emit({ type: 'phase', phase: 'A', status: 'active', elapsedMs: elapsed() });
  emit({
    type: 'log',
    level: 'info',
    message: 'Writing 6 universal smoke patterns to qa/contracts/_smoke/',
    elapsedMs: elapsed(),
  });
  for (let i = 0; i < 6; i++) {
    await sleep(220, signal);
    emit({
      type: 'phase',
      phase: 'A',
      status: 'active',
      elapsedMs: elapsed(),
      counters: { passed: i + 1, failed: 0, deferred: 0 },
    });
  }
  emit({
    type: 'phase',
    phase: 'A',
    status: 'done',
    elapsedMs: elapsed(),
    counters: { passed: 4, failed: 0, deferred: 2 },
  });

  // ============ Phase B: Discovery ============
  emit({ type: 'phase', phase: 'B', status: 'active', elapsedMs: elapsed() });
  emit({
    type: 'log',
    level: 'info',
    message: 'Reading source code, asking LLM for per-module contracts…',
    elapsedMs: elapsed(),
  });
  const moduleCount = 4;
  for (let i = 0; i < moduleCount; i++) {
    await sleep(900, signal);
    emit({
      type: 'phase',
      phase: 'B',
      status: 'active',
      elapsedMs: elapsed(),
      counters: { passed: (i + 1) * 9, failed: 0, deferred: i + 1, confirmed: i + 1, rejected: 0 },
    });
  }
  emit({
    type: 'phase',
    phase: 'B',
    status: 'done',
    elapsedMs: elapsed(),
    counters: { passed: 36, failed: 2, deferred: 4, confirmed: 4, rejected: 0 },
  });

  // ============ Phase C: Auto-fix ============
  if (!fixEnabled) {
    emit({ type: 'phase', phase: 'C', status: 'skipped', elapsedMs: elapsed() });
    return;
  }
  emit({ type: 'phase', phase: 'C', status: 'active', elapsedMs: elapsed() });
  emit({
    type: 'log',
    level: 'info',
    message: 'runFixLoop attempting fixes on 2 failing contracts',
    elapsedMs: elapsed(),
  });
  for (let i = 0; i < 2; i++) {
    await sleep(1400, signal);
    emit({
      type: 'phase',
      phase: 'C',
      status: 'active',
      elapsedMs: elapsed(),
      counters: { passed: i + 1, failed: 0, confirmed: 0 },
    });
  }
  emit({
    type: 'phase',
    phase: 'C',
    status: 'done',
    elapsedMs: elapsed(),
    counters: { passed: 2, failed: 0, confirmed: 0 },
  });
}
