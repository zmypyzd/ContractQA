/**
 * Phase event protocol for /launcher/stream SSE.
 *
 * The shape matches the three phases of `contractqa autopilot` as recorded in
 * AutopilotReport (packages/cli/src/autopilot/report.ts):
 *   - A · Smoke      — write + run smoke patterns
 *   - B · Discovery  — read source, generate per-module contracts, Y/N gate
 *   - C · Auto-fix   — runFixLoop on failing contracts (only if fix mode on)
 *
 * Counters update incrementally as the run progresses so the UI can show live
 * pass/fail counts inside each phase card, not just status transitions.
 */

export type PhaseId = 'A' | 'B' | 'C';

export type PhaseStatus = 'idle' | 'active' | 'done' | 'skipped';

export interface PhaseEvent {
  type: 'phase';
  phase: PhaseId;
  status: PhaseStatus;
  /** Milliseconds since run start when this event was emitted. */
  elapsedMs: number;
  /** Phase-local counters (cumulative within the phase, optional per phase). */
  counters?: {
    /** A: smoke passed · B: contracts generated · C: contracts fixed */
    passed?: number;
    /** A: smoke failed · B: discovery failed · C: gave up */
    failed?: number;
    /** A/B: contracts deferred to `contractqa run` (Playwright) */
    deferred?: number;
    /** B: user confirmed · C: skipped */
    confirmed?: number;
    /** B: user rejected */
    rejected?: number;
  };
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
