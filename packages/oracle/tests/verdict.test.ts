import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../src/verdict.js';

const fullEvidence = {
  state_diff: true,
  trace: true,
  screenshot: true,
  console: true,
  network: true,
};

describe('computeVerdict (§9.2)', () => {
  it('PASS when no fail contributions', () => {
    const r = computeVerdict({
      runs: [{ failContributions: [], evidence: fullEvidence }],
      requiredEvidence: ['state_diff', 'trace'],
      missingCapabilities: [],
    });
    expect(r.verdict).toBe('PASS');
  });

  it('FAIL when stable across runs', () => {
    const r = computeVerdict({
      runs: [
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence: fullEvidence },
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence: fullEvidence },
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence: fullEvidence },
      ],
      requiredEvidence: ['state_diff'],
      missingCapabilities: [],
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.reproductionRate).toBe(1);
  });

  it('FLAKY when failures intermittent', () => {
    const r = computeVerdict({
      runs: [
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence: fullEvidence },
        { failContributions: [], evidence: fullEvidence },
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence: fullEvidence },
      ],
      requiredEvidence: ['state_diff'],
      missingCapabilities: [],
    });
    expect(r.verdict).toBe('FLAKY');
  });

  it('INCONCLUSIVE when missing required capability', () => {
    const r = computeVerdict({
      runs: [{ failContributions: [], evidence: { state_diff: true } }],
      requiredEvidence: ['state_diff'],
      missingCapabilities: ['backend_probe'],
    });
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.missingCapabilities).toContain('backend_probe');
  });

  it('confidence ≥ 0.85 on stable FAIL with full evidence', () => {
    const r = computeVerdict({
      runs: Array(3).fill({
        failContributions: [{ field: 'url', detail: 'x', actual: '' }],
        evidence: fullEvidence,
      }),
      requiredEvidence: ['state_diff', 'trace', 'screenshot', 'console', 'network'],
      missingCapabilities: [],
      severity: 'P0',
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
