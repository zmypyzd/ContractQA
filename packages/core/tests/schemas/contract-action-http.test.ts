import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../../src/schemas/contract.schema.js';

const baseContract = {
  id: 'INV-HTTP',
  title: 'HTTP action shape',
  area: 'backend',
  severity: 'P1' as const,
};

describe('contract schema — http action', () => {
  it('accepts POST with body and headers', () => {
    const r = ContractSchema.safeParse({
      ...baseContract,
      actions: [{
        type: 'http',
        method: 'POST',
        path: '/api/v1/rooms',
        body: { name: 'x' },
        headers: { Authorization: 'Bearer t' },
      }],
      expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 1 } } },
    });
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('accepts GET without body', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'GET', path: '/api/v1/rooms' }],
      expected: { url: { matches: '^/api' } },
    }).success).toBe(true);
  });

  it('rejects unsupported HTTP method', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'TRACE', path: '/x' }],
      expected: {},
    }).success).toBe(false);
  });

  it('rejects empty path', () => {
    expect(ContractSchema.safeParse({
      ...baseContract,
      actions: [{ type: 'http', method: 'GET', path: '' }],
      expected: {},
    }).success).toBe(false);
  });
});
