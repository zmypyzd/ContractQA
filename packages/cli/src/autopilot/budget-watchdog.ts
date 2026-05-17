// packages/cli/src/autopilot/budget-watchdog.ts
export interface BudgetHandle {
  cancel(): void;
  status(): { elapsedMs: number; remainingMs: number };
}

export function startTimeBudget(ms: number, abortController: AbortController): BudgetHandle {
  const started = Date.now();
  const timer = setTimeout(() => abortController.abort(), ms);
  let cancelled = false;
  return {
    cancel() {
      if (!cancelled) {
        clearTimeout(timer);
        cancelled = true;
      }
    },
    status() {
      const elapsedMs = Date.now() - started;
      return { elapsedMs, remainingMs: Math.max(0, ms - elapsedMs) };
    },
  };
}
