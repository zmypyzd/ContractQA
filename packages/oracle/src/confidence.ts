export interface ConfidenceInputs {
  reproductionRate: number;
  evidenceCompleteness: number;
  flakeScore: number;
  oracleStrictness: number;
  violationSeverity: number;
}

export function computeConfidence(i: ConfidenceInputs): number {
  const stability = 1 - i.flakeScore;
  const raw =
    0.35 * i.reproductionRate +
    0.2 * i.evidenceCompleteness +
    0.15 * stability +
    0.15 * i.oracleStrictness +
    0.15 * i.violationSeverity;
  return Math.max(0, Math.min(1, raw));
}
