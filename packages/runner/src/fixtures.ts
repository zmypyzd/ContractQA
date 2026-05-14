import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContractDoc, NoiseProfile, VerdictResult } from '@contractqa/core';
import { computeStateDiff, classifyDiff, computeVerdict, type StateSlice } from '@contractqa/oracle';

export interface RunOracleInput {
  contract: ContractDoc;
  before: StateSlice;
  after: StateSlice;
  noise: NoiseProfile;
  missingCapabilities: string[];
  attach: (info: { name: string; path: string; contentType: string }) => void;
  tmpDir: string;
}

export async function runOracle(input: RunOracleInput): Promise<VerdictResult> {
  const diff = computeStateDiff(input.before, input.after);
  const classified = classifyDiff(
    diff,
    input.contract.expected as Parameters<typeof classifyDiff>[1],
    input.noise,
    input.after,
  );
  const verdict = computeVerdict({
    runs: [{ failContributions: classified.failContributions, evidence: { state_diff: true } }],
    requiredEvidence: input.contract.verification.evidence_required,
    missingCapabilities: input.missingCapabilities,
    severity: input.contract.severity,
  });

  const diffPath = path.join(input.tmpDir, 'state-diff.json');
  writeFileSync(diffPath, JSON.stringify({ diff, classified, verdict }, null, 2));
  input.attach({ name: 'evidence:state-diff', path: diffPath, contentType: 'application/json' });
  return verdict;
}
