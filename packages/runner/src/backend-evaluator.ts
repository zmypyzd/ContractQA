import type { BackendAdapter } from '@contractqa/core';

export interface BackendStateSpec {
  named_query: string;
  params: Record<string, unknown>;
  assert: { rowCount?: number } | { rows?: unknown[] };
}

export interface BackendEvalResult {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  reason?: string;
  missingCapability?: string;
}

/**
 * Pure evaluator for `expected.backend_state` blocks.
 *
 * - No `backend` provided → INCONCLUSIVE with missingCapability='backend_probe'
 * - backend.query throws → FAIL
 * - rowCount mismatch → FAIL
 * - rows mismatch → FAIL
 * - match → PASS
 * - assert has neither rowCount nor rows → INCONCLUSIVE
 */
export async function evaluateBackendState(
  bs: BackendStateSpec,
  backend?: BackendAdapter,
): Promise<BackendEvalResult> {
  if (!backend) {
    return { verdict: 'INCONCLUSIVE', missingCapability: 'backend_probe' };
  }

  let rows: unknown[];
  try {
    rows = (await backend.query(bs.named_query, bs.params)) as unknown[];
  } catch (e) {
    return {
      verdict: 'FAIL',
      reason: `backend query "${bs.named_query}" threw: ${(e as Error).message}`,
    };
  }

  const a = bs.assert as Record<string, unknown>;

  if (a['rowCount'] !== undefined) {
    const expected = a['rowCount'] as number;
    return rows.length === expected
      ? { verdict: 'PASS' }
      : {
          verdict: 'FAIL',
          reason: `expected rowCount ${expected}, got ${rows.length}`,
        };
  }

  if (a['rows'] !== undefined) {
    const expectedRows = a['rows'] as unknown[];
    const ok = JSON.stringify(rows) === JSON.stringify(expectedRows);
    return ok
      ? { verdict: 'PASS' }
      : { verdict: 'FAIL', reason: 'rows do not match expected' };
  }

  return { verdict: 'INCONCLUSIVE', missingCapability: 'unsupported_assert' };
}
