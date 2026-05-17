// packages/cli/src/commands/autopilot-watch.ts
//
// File-watching wrapper around runAutopilot. Re-runs the pipeline whenever a
// source file under cwd changes, with a debounce window. Node's built-in
// fs.watch is used so we don't pick up a chokidar dependency.
//
// Ignored paths: node_modules, .git, dist, build, .next, .turbo, the qa/
// directory itself (autopilot writes there — would otherwise loop forever),
// and dotfiles at the root.

import { watch, type FSWatcher } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { runAutopilot, type AutopilotOptions } from './autopilot.js';

const execFileAsync = promisify(execFile);

export interface WatchOptions {
  debounceMs: number;
  onLog?: (line: string) => void;
  /**
   * Optional dashboard URL (e.g. http://127.0.0.1:3010). When set, every
   * iteration POSTs to ${dashboardUrl}/api/runs at start and PATCHes at end.
   * All iterations share one watchSessionId so /runs can collapse them as a
   * single group. Failures are silent — the watch loop continues regardless.
   */
  dashboardUrl?: string;
}

const IGNORED_TOP_DIRS = new Set([
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
  'qa', // autopilot's own output; watching it would cause an infinite re-run loop
]);

export async function watchAndRerun(
  baseOpts: AutopilotOptions,
  watchOpts: WatchOptions,
): Promise<void> {
  const log = watchOpts.onLog ?? ((line: string) => console.log(line));
  const dashboardUrl = (watchOpts.dashboardUrl ?? process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
  // One session UUID per watch loop. Shared with the dashboard so /runs can
  // collapse all iterations into a single group.
  const watchSessionId = dashboardUrl ? randomUUID() : null;
  const branch = await detectBranch(baseOpts.cwd);
  let iteration = 0;
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  if (dashboardUrl) {
    log(`[watch] reporting to dashboard at ${dashboardUrl} (session=${watchSessionId})`);
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher?.close();
    log('[watch] stopped.');
    // Allow any in-flight run to finish naturally — caller's process exits
    // when the awaited Promise from watchAndRerun resolves.
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const runOnce = async (trigger: string): Promise<void> => {
    iteration++;
    log(`\n[watch] iteration ${iteration} · trigger=${trigger}\n`);
    // Optionally register the run with the dashboard up front so /runs picks
    // it up at status='running'.
    const dashboardRunId = dashboardUrl
      ? await dashboardCreateRun(dashboardUrl, baseOpts.cwd, branch, watchSessionId)
      : null;
    try {
      const report = await runAutopilot(baseOpts);
      const failTotal = report.phaseA.failed + (report.phaseB?.failed ?? 0) + (report.phaseC?.givenUp ?? 0);
      log(`[watch] iteration ${iteration} done · ${failTotal === 0 ? 'all green' : `${failTotal} failures`}`);
      if (dashboardRunId) {
        const totals = aggregateTotals(report);
        const status: 'passed' | 'failed' =
          report.phaseA.failed + (report.phaseB?.failed ?? 0) > 0 ? 'failed' : 'passed';
        const registered = await dashboardCompleteRun(dashboardUrl, dashboardRunId, status, totals, report.issuesWritten ?? []);
        if (registered != null && registered > 0) {
          log(`[watch] registered ${registered} issue${registered === 1 ? '' : 's'} on dashboard run ${dashboardRunId.slice(0, 8)}`);
        }
      }
    } catch (err) {
      log(`[watch] iteration ${iteration} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (dashboardRunId) {
        await dashboardCompleteRun(dashboardUrl, dashboardRunId, 'error', null, []);
      }
    }
  };

  // Schedule a debounced run; if a run is already in flight, queue the next
  // one to start after it completes. This prevents concurrent autopilot calls
  // from racing on the same cwd (stashGuard, qa/ writes).
  const scheduleRun = (trigger: string): void => {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const start = async () => {
        await runOnce(trigger);
        inFlight = null;
      };
      if (inFlight) {
        // Chain: wait for current run, then start new one. Drop any further
        // change events that happened during the wait (they're handled by the
        // currently-queued run).
        inFlight = inFlight.then(() => start());
      } else {
        inFlight = start();
      }
    }, watchOpts.debounceMs);
  };

  // Initial run before we start watching, so the user gets immediate feedback.
  await runOnce('initial');
  inFlight = null;

  if (stopped) return; // SIGINT during initial run

  // Recursive watch. macOS + Windows support recursive natively; Linux requires
  // walking the tree. fs.watch returns a single watcher for the recursive case.
  log(`[watch] watching ${baseOpts.cwd} (ignoring node_modules, .git, dist, qa, ...)`);
  try {
    watcher = watch(baseOpts.cwd, { recursive: true, persistent: true }, (_event, filename) => {
      if (!filename) return;
      const top = filename.split(sep)[0] ?? '';
      if (IGNORED_TOP_DIRS.has(top)) return;
      if (top.startsWith('.') && top !== '.env' && top !== '.env.local') return;
      scheduleRun(filename);
    });
  } catch (err) {
    // fs.watch with recursive may throw on some platforms / mounts.
    log(`[watch] could not start recursive watch: ${err instanceof Error ? err.message : String(err)}`);
    log('[watch] falling back: re-run on SIGUSR1 only.');
    process.on('SIGUSR1', () => scheduleRun('SIGUSR1'));
  }

  // Hold the event loop open until stop() is called.
  await new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      if (stopped) {
        clearInterval(tick);
        resolve();
      }
    }, 250);
  });

  // Wait for any in-flight run to settle before returning.
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // logged above
    }
  }

  // Best-effort: relative() to keep absolute paths out of logs. Imported so
  // the tsc unused-import check stays happy.
  void relative;
  void join;
}

/** Read the project's current git branch. Best-effort. */
async function detectBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const branch = stdout.trim();
    return branch === 'HEAD' || branch === '' ? null : branch;
  } catch {
    return null;
  }
}

async function dashboardCreateRun(
  url: string,
  cwd: string,
  branch: string | null,
  watchSessionId: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd,
        branch,
        triggerType: 'cli-watch',
        watchSessionId,
      }),
      // Don't hang the watch loop on a stalled dashboard.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function dashboardCompleteRun(
  url: string,
  runId: string,
  status: 'passed' | 'failed' | 'error',
  totals: Record<string, number> | null,
  issuesWritten: string[],
): Promise<number | null> {
  try {
    const res = await fetch(`${url}/api/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        endedAt: new Date().toISOString(),
        totals,
        issuesWritten,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { registeredIssues?: number };
    return data.registeredIssues ?? 0;
  } catch {
    return null;
  }
}

function aggregateTotals(report: {
  phaseA: { passed: number; failed: number; deferred: number };
  phaseB: { generated: number; failed: number; deferred: number; userConfirmed: number; userRejected: number };
  phaseC?: { attempted: number; fixed: number; givenUp: number };
}): Record<string, number> {
  const a = report.phaseA;
  const b = report.phaseB;
  const c = report.phaseC;
  return {
    passed: a.passed + b.generated,
    failed: a.failed + b.failed + (c?.givenUp ?? 0),
    deferred: a.deferred + b.deferred,
    a_passed: a.passed,
    a_failed: a.failed,
    b_generated: b.generated,
    b_failed: b.failed,
    b_confirmed: b.userConfirmed,
    b_rejected: b.userRejected,
    c_attempted: c?.attempted ?? 0,
    c_fixed: c?.fixed ?? 0,
    c_givenUp: c?.givenUp ?? 0,
  };
}
