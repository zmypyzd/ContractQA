// packages/cli/src/autopilot/report.ts
export interface SmokeFailure { id: string; reason: string; }

export interface AutopilotReport {
  phaseA: {
    passed: number;
    failed: number;
    /** Playwright-based contracts written but not executed inline; run via `contractqa run`. */
    deferred: number;
    failures: SmokeFailure[];
  };
  phaseB: {
    generated: number;
    failed: number;
    /** Playwright-based contracts written but not executed inline; run via `contractqa run`. */
    deferred: number;
    userConfirmed: number;
    userRejected: number;
  };
  /** Phase C is included only when fix mode is enabled. */
  phaseC?: {
    attempted: number;
    fixed: number;
    givenUp: number;
    /**
     * Contracts skipped (e.g., aborted before fix could be attempted).
     * In v1.1.0-beta+ the orchestrator is wired; this field remains for reporting completeness.
     */
    skipped: number;
    diffs: string[];
  };
  budgetTriggered: 'time-budget' | 'user-interrupt' | null;
  durationMs: number;
  llmCost?: { provider: string; inputTokens: number; outputTokens: number; estimatedUsd?: number };
  /**
   * Absolute paths to issue.json evidence files written during this run.
   * Dashboard / downstream consumers register one row per path in their issues
   * table at run-end. Empty array when no failures had evidence captured.
   */
  issuesWritten?: string[];
}

function ms(d: number): string {
  const s = Math.floor(d / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function renderReportMarkdown(r: AutopilotReport): string {
  const a = r.phaseA;
  const b = r.phaseB;
  const c = r.phaseC;
  const totalA = a.passed + a.failed + a.deferred;
  const lines: string[] = [
    '# Autopilot Report',
    '',
    `Duration: ${ms(r.durationMs)}`,
    r.budgetTriggered ? `**Budget triggered: ${r.budgetTriggered}** — partial results below.` : '',
    '',
    '## Phase A: Smoke',
    `- ${totalA} patterns generated → ${a.passed} passed, ${a.failed} failed, ${a.deferred} deferred to \`contractqa run\``,
    a.deferred > 0 ? `- Note: Playwright-based patterns are written to qa/contracts/_smoke/ but require \`contractqa run\` to execute.` : '',
    a.failures.length > 0 ? `- Failures: ${a.failures.map((f) => f.id).join(', ')}` : '',
    '',
    '## Phase B: Discovery',
    `- ${b.generated} contracts generated, ${b.failed} failed, ${b.deferred} deferred to \`contractqa run\``,
    b.deferred > 0 ? `- Note: Playwright-based contracts are written to qa/contracts/ but require \`contractqa run\` to execute.` : '',
    `- ${b.userConfirmed} user-confirmed, ${b.userRejected} user-rejected`,
    '',
  ];
  if (c) {
    lines.push('## Phase C: Auto-fix');
    if (c.skipped > 0) {
      lines.push(`- ${c.skipped} fix(es) skipped (aborted before attempt)`);
    }
    lines.push(`- ${c.fixed} fixes applied, ${c.givenUp} given up (of ${c.attempted} attempted)`);
    if (c.diffs.length > 0) {
      lines.push(`- Modified files: ${c.diffs.join(', ')}`);
    }
    lines.push('');
  }
  if (r.llmCost) {
    lines.push('## LLM usage');
    lines.push(`- Provider: ${r.llmCost.provider}`);
    lines.push(`- Tokens: in=${r.llmCost.inputTokens} out=${r.llmCost.outputTokens}`);
    if (r.llmCost.estimatedUsd !== undefined) lines.push(`- Estimated cost: ~$${r.llmCost.estimatedUsd.toFixed(2)}`);
  }
  return lines.filter((l) => l !== '').join('\n') + '\n';
}
