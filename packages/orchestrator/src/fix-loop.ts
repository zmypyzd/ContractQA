import type { ClaudeFixResult } from './claude-code.js';

export interface FixLoopInput {
  maxAttempts: number;
  fix: (attempt: number) => Promise<ClaudeFixResult>;
}

export type FixOutcome = 'SUCCESS' | 'EXHAUSTED' | 'CONTRACT_REVISION_NEEDED' | 'PARSE_ERROR';

export interface FixLoopResult {
  outcome: FixOutcome;
  attempts: number;
  history: ClaudeFixResult[];
}

export async function runFixLoop(i: FixLoopInput): Promise<FixLoopResult> {
  const history: ClaudeFixResult[] = [];
  for (let a = 1; a <= i.maxAttempts; a++) {
    const r = await i.fix(a);
    history.push(r);
    if (r.proposed_contract_revision) {
      return { outcome: 'CONTRACT_REVISION_NEEDED', attempts: a, history };
    }
    if (r.validation_result === 'PARSE_ERROR') {
      return { outcome: 'PARSE_ERROR', attempts: a, history };
    }
    if (r.validation_result === 'PASS') {
      return { outcome: 'SUCCESS', attempts: a, history };
    }
  }
  return { outcome: 'EXHAUSTED', attempts: i.maxAttempts, history };
}
