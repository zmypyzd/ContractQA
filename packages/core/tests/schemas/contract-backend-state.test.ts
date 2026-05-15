import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../../src/schemas/contract.schema.js';

const baseContract = {
  id: 'INV-B1',
  title: 'Backend state assertion',
  area: 'backend',
  severity: 'P1' as const,
  actions: [{ type: 'goto' as const, path: '/lobby' }],
};

describe('contract schema — backend_state block', () => {
  it('accepts a contract with backend_state.named_query + rowCount assertion', () => {
    const contract = {
      ...baseContract,
      expected: {
        backend_state: {
          named_query: 'pendingHands',
          params: { user_id: '$session.userId' },
          assert: { rowCount: 0 },
        },
      },
    };
    const r = ContractSchema.safeParse(contract);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('accepts a contract with backend_state + rows assertion', () => {
    const contract = {
      ...baseContract,
      id: 'INV-B-ROWS',
      expected: {
        backend_state: {
          named_query: 'tablesByOwner',
          params: { user_id: 'u1' },
          assert: { rows: [{ id: 1 }, { id: 2 }] },
        },
      },
    };
    expect(ContractSchema.safeParse(contract).success).toBe(true);
  });

  it('rejects backend_state with raw sql key (named-query only)', () => {
    const contract = {
      ...baseContract,
      id: 'INV-B-SQL',
      expected: {
        backend_state: { sql: 'SELECT * FROM hands' },
      },
    };
    expect(ContractSchema.safeParse(contract).success).toBe(false);
  });

  it('accepts a contract WITHOUT backend_state (backward compat)', () => {
    const contract = {
      ...baseContract,
      id: 'INV-B-NONE',
      expected: { url: { matches: '^/lobby' } },
    };
    expect(ContractSchema.safeParse(contract).success).toBe(true);
  });
});
