// packages/cli/tests/autopilot/report.test.ts
import { describe, it, expect } from 'vitest';
import { renderReportMarkdown, type AutopilotReport } from '../../src/autopilot/report.js';

describe('renderReportMarkdown', () => {
  it('renders summary header + per-phase sections', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 5, failed: 1, deferred: 0, failures: [] },
      phaseB: { generated: 12, failed: 2, deferred: 0, userConfirmed: 8, userRejected: 1 },
      phaseC: { attempted: 2, fixed: 2, givenUp: 0, skipped: 0, diffs: ['app/auth.ts'] },
      budgetTriggered: null,
      durationMs: 123456,
    };
    const md = renderReportMarkdown(report);
    expect(md).toContain('# Autopilot Report');
    expect(md).toContain('Phase A: Smoke');
    expect(md).toContain('6 patterns generated');
    expect(md).toContain('5 passed');
    expect(md).toContain('Phase B: Discovery');
    expect(md).toContain('12 contracts generated');
    expect(md).toContain('Phase C: Auto-fix');
    expect(md).toContain('2 fixes applied');
  });

  it('shows deferred count when Playwright contracts are written', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 0, failed: 0, deferred: 6, failures: [] },
      phaseB: { generated: 0, failed: 0, deferred: 0, userConfirmed: 0, userRejected: 0 },
      budgetTriggered: null,
      durationMs: 5000,
    };
    const md = renderReportMarkdown(report);
    expect(md).toContain('6 patterns generated');
    expect(md).toContain('6 deferred to `contractqa run`');
    expect(md).toContain('Playwright-based patterns');
  });

  it('shows skipped count in Phase C when fixes were skipped (e.g., aborted before attempt)', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 0, failed: 1, deferred: 0, failures: [{ id: 'SMOKE-root-not-500', reason: 'timeout' }] },
      phaseB: { generated: 0, failed: 0, deferred: 0, userConfirmed: 0, userRejected: 0 },
      phaseC: { attempted: 0, fixed: 0, givenUp: 0, skipped: 1, diffs: [] },
      budgetTriggered: null,
      durationMs: 2000,
    };
    const md = renderReportMarkdown(report);
    expect(md).toContain('Phase C: Auto-fix');
    expect(md).toContain('1 fix(es) skipped');
    // In v1.1.0-beta the orchestrator is wired; skipped means aborted before attempt
    expect(md).toContain('aborted before attempt');
  });

  it('shows Phase B failed count', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 1, failed: 0, deferred: 0, failures: [] },
      phaseB: { generated: 5, failed: 2, deferred: 0, userConfirmed: 3, userRejected: 0 },
      budgetTriggered: null,
      durationMs: 3000,
    };
    const md = renderReportMarkdown(report);
    expect(md).toContain('5 contracts generated, 2 failed');
  });

  it('marks budget-triggered runs prominently', () => {
    const report: AutopilotReport = {
      phaseA: { passed: 5, failed: 0, deferred: 0, failures: [] },
      phaseB: { generated: 0, failed: 0, deferred: 0, userConfirmed: 0, userRejected: 0 },
      budgetTriggered: 'time-budget',
      durationMs: 1800000,
    };
    const md = renderReportMarkdown(report);
    expect(md).toMatch(/budget.*time/i);
  });
});
