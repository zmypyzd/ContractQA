// packages/cli/src/autopilot/report.ts
export interface SmokeFailure { id: string; reason: string; }

export interface AutopilotReport {
  phaseA: { passed: number; failed: number; failures: SmokeFailure[] };
  phaseB: { generated: number; userConfirmed: number; userRejected: number };
  phaseC?: { attempted: number; fixed: number; givenUp: number; diffs: string[] };
  budgetTriggered: 'time-budget' | 'user-interrupt' | null;
  durationMs: number;
  llmCost?: { provider: string; inputTokens: number; outputTokens: number; estimatedUsd?: number };
}

function ms(d: number): string {
  const s = Math.floor(d / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function renderReportMarkdown(r: AutopilotReport): string {
  const a = r.phaseA;
  const b = r.phaseB;
  const c = r.phaseC;
  const lines: string[] = [
    '# Autopilot Report',
    '',
    `Duration: ${ms(r.durationMs)}`,
    r.budgetTriggered ? `**Budget triggered: ${r.budgetTriggered}** — partial results below.` : '',
    '',
    '## Phase A: Smoke',
    `- ${a.passed}/${a.passed + a.failed} passed`,
    a.failures.length > 0 ? `- Failures: ${a.failures.map((f) => f.id).join(', ')}` : '',
    '',
    '## Phase B: Discovery',
    `- ${b.generated} contracts generated`,
    `- ${b.userConfirmed} user-confirmed, ${b.userRejected} user-rejected`,
    '',
  ];
  if (c) {
    lines.push('## Phase C: Auto-fix');
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
