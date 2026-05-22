import { describe, expect, it } from 'vitest';
import { formatProgressEvent } from '../src/autopilot/format-progress.js';

describe('formatProgressEvent', () => {
  it('formats a phase active event with no counters', () => {
    const line = formatProgressEvent({
      type: 'phase',
      phase: 'A',
      status: 'active',
      elapsedMs: 120,
    });
    expect(line).toBe('[0.12s] phase=A status=active');
  });

  it('formats a phase done event with counters (skips undefined fields)', () => {
    const line = formatProgressEvent({
      type: 'phase',
      phase: 'A',
      status: 'done',
      elapsedMs: 340,
      counters: { passed: 2, failed: 1, deferred: 3 },
    });
    expect(line).toBe('[0.34s] phase=A status=done passed=2 failed=1 deferred=3');
  });

  it('formats a phase skipped event', () => {
    const line = formatProgressEvent({
      type: 'phase',
      phase: 'C',
      status: 'skipped',
      elapsedMs: 500,
    });
    expect(line).toBe('[0.50s] phase=C status=skipped');
  });

  it('formats a log info event', () => {
    const line = formatProgressEvent({
      type: 'log',
      level: 'info',
      message: '[deep] enumerated 142 candidate interactions',
      elapsedMs: 5210,
    });
    expect(line).toBe('[5.21s] info: [deep] enumerated 142 candidate interactions');
  });

  it('formats a log warn event', () => {
    const line = formatProgressEvent({
      type: 'log',
      level: 'warn',
      message: 'autopilot: cwd is not a git repo — Phase C will be unable to apply fix diffs.',
      elapsedMs: 450,
    });
    expect(line).toBe(
      '[0.45s] warn: autopilot: cwd is not a git repo — Phase C will be unable to apply fix diffs.',
    );
  });

  it('formats a log error event', () => {
    const line = formatProgressEvent({
      type: 'log',
      level: 'error',
      message: 'autopilot: fatal-stage-2',
      elapsedMs: 60_000,
    });
    expect(line).toBe('[60.00s] error: autopilot: fatal-stage-2');
  });

  it('omits zero / undefined counters cleanly', () => {
    const line = formatProgressEvent({
      type: 'phase',
      phase: 'B',
      status: 'done',
      elapsedMs: 1000,
      counters: { generated: 0, failed: 0, deferred: 0, fallbackUsed: false },
    });
    // Numeric zeros are real signal ("we ran but nothing matched"), so we DO
    // emit them. Booleans only show when true. undefined fields are dropped.
    expect(line).toBe('[1.00s] phase=B status=done generated=0 failed=0 deferred=0');
  });

  it('shows fallbackUsed and fallbackReason when set (deep-discovery diagnostics)', () => {
    const line = formatProgressEvent({
      type: 'phase',
      phase: 'B',
      status: 'done',
      elapsedMs: 12_500,
      counters: {
        generated: 14,
        interactionsFound: 142,
        fallbackUsed: true,
        fallbackReason: 'Stage 1 returned empty interactions array',
      },
    });
    expect(line).toContain('phase=B status=done');
    expect(line).toContain('generated=14');
    expect(line).toContain('interactionsFound=142');
    expect(line).toContain('fallbackUsed=true');
    expect(line).toContain("fallbackReason='Stage 1 returned empty interactions array'");
  });
});
