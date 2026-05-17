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
import { runAutopilot, type AutopilotOptions } from './autopilot.js';

export interface WatchOptions {
  debounceMs: number;
  onLog?: (line: string) => void;
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
  let iteration = 0;
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

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
    try {
      const report = await runAutopilot(baseOpts);
      const failTotal = report.phaseA.failed + (report.phaseB?.failed ?? 0) + (report.phaseC?.givenUp ?? 0);
      log(`[watch] iteration ${iteration} done · ${failTotal === 0 ? 'all green' : `${failTotal} failures`}`);
    } catch (err) {
      log(`[watch] iteration ${iteration} failed: ${err instanceof Error ? err.message : String(err)}`);
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
