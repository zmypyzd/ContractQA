import { describe, it, expect } from 'vitest';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';
import { evaluateBackendState } from '../src/backend-evaluator.js';
import type { BackendStateSpec } from '../src/backend-evaluator.js';

// ---------------------------------------------------------------------------
// Fake backend adapter for testing
// ---------------------------------------------------------------------------

class FakeBackend implements BackendAdapter {
  readonly kind = 'postgres' as const;

  constructor(private readonly _rows: unknown[]) {}

  describe(): SchemaDescriptor {
    return {
      tenantField: 'user_id',
      namedQueries: [
        { name: 'pending', description: 'pending orders', params: { user_id: '$1' } },
      ],
    };
  }

  async query(_name: string, _params: unknown): Promise<unknown> {
    return this._rows;
  }
}

class ThrowingBackend implements BackendAdapter {
  readonly kind = 'postgres' as const;
  describe(): SchemaDescriptor {
    return { tenantField: null, namedQueries: [] };
  }
  async query(name: string): Promise<unknown> {
    throw new Error(`query "${name}" is not available`);
  }
}

// ---------------------------------------------------------------------------
// Spec helpers
// ---------------------------------------------------------------------------

function rowCountSpec(named_query: string, rowCount: number): BackendStateSpec {
  return { named_query, params: {}, assert: { rowCount } };
}

function rowsSpec(named_query: string, rows: unknown[]): BackendStateSpec {
  return { named_query, params: {}, assert: { rows } };
}

// ---------------------------------------------------------------------------
// Tests: evaluateBackendState (pure unit, no Playwright needed)
// ---------------------------------------------------------------------------

describe('evaluateBackendState — rowCount assertion', () => {
  it('PASS when rowCount matches', async () => {
    const backend = new FakeBackend([{ id: 1 }, { id: 2 }]);
    const result = await evaluateBackendState(rowCountSpec('pending', 2), backend);
    expect(result.verdict).toBe('PASS');
    expect(result.reason).toBeUndefined();
  });

  it('FAIL when rowCount diverges (got fewer)', async () => {
    const backend = new FakeBackend([{ id: 1 }]);
    const result = await evaluateBackendState(rowCountSpec('pending', 3), backend);
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toMatch(/expected rowCount 3, got 1/);
  });

  it('FAIL when rowCount diverges (got more)', async () => {
    const backend = new FakeBackend([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const result = await evaluateBackendState(rowCountSpec('pending', 0), backend);
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toMatch(/expected rowCount 0, got 3/);
  });

  it('PASS when rowCount is 0 and backend returns empty array', async () => {
    const backend = new FakeBackend([]);
    const result = await evaluateBackendState(rowCountSpec('pending', 0), backend);
    expect(result.verdict).toBe('PASS');
  });
});

describe('evaluateBackendState — rows assertion', () => {
  it('PASS when rows match exactly', async () => {
    const expectedRows = [{ id: 1, status: 'pending' }];
    const backend = new FakeBackend([{ id: 1, status: 'pending' }]);
    const result = await evaluateBackendState(rowsSpec('pending', expectedRows), backend);
    expect(result.verdict).toBe('PASS');
  });

  it('FAIL when rows do not match', async () => {
    const expectedRows = [{ id: 1, status: 'pending' }];
    const backend = new FakeBackend([{ id: 1, status: 'shipped' }]);
    const result = await evaluateBackendState(rowsSpec('pending', expectedRows), backend);
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toMatch(/rows do not match expected/);
  });

  it('FAIL when row count differs under rows assertion', async () => {
    const expectedRows = [{ id: 1 }];
    const backend = new FakeBackend([{ id: 1 }, { id: 2 }]);
    const result = await evaluateBackendState(rowsSpec('pending', expectedRows), backend);
    expect(result.verdict).toBe('FAIL');
  });
});

describe('evaluateBackendState — INCONCLUSIVE when no backend provided', () => {
  it('returns INCONCLUSIVE with missingCapability=backend_probe when backend is undefined', async () => {
    const result = await evaluateBackendState(rowCountSpec('pending', 1), undefined);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.missingCapability).toBe('backend_probe');
    expect(result.reason).toBeUndefined();
  });

  it('INCONCLUSIVE is returned regardless of assert type', async () => {
    const result = await evaluateBackendState(rowsSpec('orders', []), undefined);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.missingCapability).toBe('backend_probe');
  });
});

describe('evaluateBackendState — backend query throws', () => {
  it('returns FAIL with an informative reason', async () => {
    const backend = new ThrowingBackend();
    const result = await evaluateBackendState(rowCountSpec('pending', 0), backend);
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toMatch(/backend query "pending" threw/);
    expect(result.reason).toMatch(/not available/);
  });
});
