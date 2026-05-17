// packages/cli/tests/autopilot/report.test.ts
import { describe, it, expect } from 'vitest';
import { renderReportMarkdown, type AutopilotReport } from '../../src/autopilot/report.js';

describe('renderReportMarkdown', () => {
  it('renders summary header + per-phase sections', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 5, failed: 1, failures: [] },
      phaseB: { generated: 12, userConfirmed: 8, userRejected: 1 },
      phaseC: { attempted: 2, fixed: 2, givenUp: 0, diffs: ['app/auth.ts'] },
      budgetTriggered: null,
      durationMs: 123456,
    };
    const md = renderReportMarkdown(report);
    expect(md).toContain('# Autopilot Report');
    expect(md).toContain('Phase A: Smoke');
    expect(md).toContain('5/6 passed');
    expect(md).toContain('Phase B: Discovery');
    expect(md).toContain('12 contracts generated');
    expect(md).toContain('Phase C: Auto-fix');
    expect(md).toContain('2 fixes applied');
  });

  it('marks budget-triggered runs prominently', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 5, failed: 0, failures: [] },
      phaseB: { generated: 0, userConfirmed: 0, userRejected: 0 },
      budgetTriggered: 'time-budget',
      durationMs: 1800000,
    };
    const md = renderReportMarkdown(report);
    expect(md).toMatch(/budget.*time/i);
  });
});
