/**
 * Phase event protocol for /launcher/stream SSE.
 *
 * Counter field names mirror AutopilotReport (packages/cli/src/autopilot/report.ts)
 * so events flow from runAutopilot's onProgress callback into the stream as a
 * near-direct passthrough.
 *
 * Phases (matching AutopilotReport):
 *   - A · Smoke      — `passed` / `failed` / `deferred`
 *   - B · Discovery  — `generated` / `failed` / `deferred` / `userConfirmed` / `userRejected`
 *   - C · Auto-fix   — `attempted` / `fixed` / `givenUp` (skipped when `fix: false`)
 */

export type PhaseId = 'A' | 'B' | 'C';

export type PhaseStatus = 'idle' | 'active' | 'done' | 'skipped';

export interface PhaseCounters {
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

export interface PhaseEvent {
  type: 'phase';
  phase: PhaseId;
  status: PhaseStatus;
  /** Milliseconds since run start when this event was emitted. */
  elapsedMs: number;
  counters?: PhaseCounters;
}

export interface RunStartEvent {
  type: 'run-start';
  runId: string;
  cwd: string;
  fixEnabled: boolean;
  startedAt: number;
}

export interface RunEndEvent {
  type: 'run-end';
  runId: string;
  outcome: 'success' | 'budget' | 'interrupt' | 'error';
  durationMs: number;
  /** Path to AUTOPILOT_REPORT.md inside the target cwd, if one was written. */
  reportPath?: string;
  error?: string;
}

export interface LogEvent {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
  elapsedMs: number;
}

export type LauncherEvent = PhaseEvent | RunStartEvent | RunEndEvent | LogEvent;

/** Encode an event as a single SSE frame. */
export function encodeEvent(event: LauncherEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
