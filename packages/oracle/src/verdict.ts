import type { Verdict, VerdictResult } from '@contractqa/core';
import { computeConfidence } from './confidence.js';

export interface RunResult {
  failContributions: Array<{ field: string; detail: string; actual: unknown }>;
  evidence: Partial<Record<'state_diff' | 'trace' | 'screenshot' | 'console' | 'network', boolean>>;
}

export interface VerdictInput {
  runs: RunResult[];
  requiredEvidence: Array<'state_diff' | 'trace' | 'screenshot' | 'console' | 'network'>;
  missingCapabilities: string[];
  severity?: 'P0' | 'P1' | 'P2' | 'P3';
  oracleStrictness?: number;
}

export function computeVerdict(input: VerdictInput): VerdictResult {
  const totalRuns = input.runs.length;
  const failingRuns = input.runs.filter((r) => r.failContributions.length > 0).length;
  const reproductionRate = totalRuns === 0 ? 0 : failingRuns / totalRuns;

  const evidenceCompleteness =
    totalRuns === 0
      ? 0
      : input.runs.reduce((acc, r) => {
          const present = input.requiredEvidence.filter((k) => r.evidence[k]).length;
          return acc + present / Math.max(input.requiredEvidence.length, 1);
        }, 0) / totalRuns;

  if (input.missingCapabilities.length > 0) {
    return finalize('INCONCLUSIVE', {
      input,
      reproductionRate,
      evidenceCompleteness,
      flakeScore: 0,
      violations: input.runs.flatMap((r) => r.failContributions),
    });
  }

  let verdict: Verdict;
  if (failingRuns === 0) verdict = 'PASS';
  else if (failingRuns === totalRuns) verdict = 'FAIL';
  else verdict = 'FLAKY';

  const flakeScore = verdict === 'FLAKY' ? 1 - Math.abs(reproductionRate - 0.5) * 2 : 0;
  return finalize(verdict, {
    input,
    reproductionRate,
    evidenceCompleteness,
    flakeScore,
    violations: input.runs.flatMap((r) => r.failContributions),
  });
}

function finalize(
  verdict: Verdict,
  ctx: {
    input: VerdictInput;
    reproductionRate: number;
    evidenceCompleteness: number;
    flakeScore: number;
    violations: Array<{ field: string; detail: string; actual: unknown }>;
  },
): VerdictResult {
  const sevMap = { P0: 1, P1: 0.75, P2: 0.5, P3: 0.25 };
  const violationSeverity = sevMap[ctx.input.severity ?? 'P1'];
  const confidence = computeConfidence({
    reproductionRate: ctx.reproductionRate,
    evidenceCompleteness: ctx.evidenceCompleteness,
    flakeScore: ctx.flakeScore,
    oracleStrictness: ctx.input.oracleStrictness ?? 0.8,
    violationSeverity,
  });
  return {
    verdict,
    violations: ctx.violations.map((v) => ({
      invariantId: '',
      message: `${v.field}: ${v.detail}`,
      expected: v.detail,
      actual: v.actual,
    })),
    confidence,
    reproductionRate: ctx.reproductionRate,
    flakeScore: ctx.flakeScore,
    evidenceCompleteness: ctx.evidenceCompleteness,
    missingCapabilities: ctx.input.missingCapabilities,
  };
}
