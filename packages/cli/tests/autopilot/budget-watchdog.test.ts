// packages/cli/tests/autopilot/budget-watchdog.test.ts
import { describe, it, expect, vi } from 'vitest';
import { startTimeBudget } from '../../src/autopilot/budget-watchdog.js';

describe('startTimeBudget', () => {
  it('aborts the controller after the budget elapses', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const w = startTimeBudget(1000, ac);
    expect(ac.signal.aborted).toBe(false);
    vi.advanceTimersByTime(999);
    expect(ac.signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect(ac.signal.aborted).toBe(true);
    w.cancel();
    vi.useRealTimers();
  });

  it('does not abort when cancel() called before budget elapses', () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const w = startTimeBudget(1000, ac);
    vi.advanceTimersByTime(500);
    w.cancel();
    vi.advanceTimersByTime(10000);
    expect(ac.signal.aborted).toBe(false);
    vi.useRealTimers();
  });

  it('status() reports elapsedMs and remainingMs', () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const w = startTimeBudget(10000, ac);
    vi.advanceTimersByTime(3000);
    const s = w.status();
    expect(s.elapsedMs).toBeGreaterThanOrEqual(3000);
    expect(s.remainingMs).toBeLessThanOrEqual(7000);
    w.cancel();
    vi.useRealTimers();
  });
});
