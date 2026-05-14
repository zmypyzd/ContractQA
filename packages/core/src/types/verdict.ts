export type Verdict = 'PASS' | 'FAIL' | 'FLAKY' | 'INCONCLUSIVE';

export interface InvariantViolation {
  invariantId: string;
  message: string;
  expected: unknown;
  actual: unknown;
}

export interface VerdictResult {
  verdict: Verdict;
  violations: InvariantViolation[];
  confidence: number;
  reproductionRate: number;
  flakeScore: number;
  evidenceCompleteness: number;
  missingCapabilities: string[];
}
