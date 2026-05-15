import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../src/schemas/contract.schema.js';

const base = {
  id: 'INV-1', title: 't', area: 'a', severity: 'P1' as const,
  expected: {}, risk_tags: [], preconditions: {},
  verification: { wait_ms: 0, retries: 0, evidence_required: [] },
};

describe('Action variants reject unknown keys (.strict())', () => {
  it('goto rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'goto', path: '/', foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('click rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'click', target: { role: 'button' }, foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('fill rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'fill', target: { role: 'textbox' }, value: 'x', foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('wait rejects unknown key', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'wait', ms: 100, foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('http rejects unknown key (regression — already strict in Phase 12)', () => {
    const r = ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'http', method: 'GET', path: '/x', foo: 'bar' }],
    });
    expect(r.success).toBe(false);
  });

  it('goto still accepts valid shape', () => {
    expect(ContractSchema.safeParse({
      ...base,
      actions: [{ type: 'goto', path: '/' }],
    }).success).toBe(true);
  });
});
