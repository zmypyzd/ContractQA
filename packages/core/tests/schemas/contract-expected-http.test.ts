import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../../src/schemas/contract.schema.js';

const base = {
  id: 'http-contract',
  title: 'http contract',
  area: 'api',
  severity: 'P1',
  preconditions: { auth_state: 'anonymous' },
  actions: [{ type: 'http', method: 'GET', path: '/api/x' }],
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
};

describe('ContractSchema — expected.http (Stream 1)', () => {
  it('accepts status as scalar number', () => {
    const c = { ...base, expected: { http: { status: 200 } } };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('accepts status as array of numbers', () => {
    const c = { ...base, expected: { http: { status: [200, 201, 202] } } };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('accepts body.contains / not_contains / contains_keys / not_contains_keys', () => {
    const c = {
      ...base,
      expected: {
        http: {
          body: {
            contains: ['ok'],
            not_contains: ['error'],
            contains_keys: ['id'],
            not_contains_keys: ['secret'],
          },
        },
      },
    };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('accepts headers as Record<string,string>', () => {
    const c = { ...base, expected: { http: { headers: { 'x-foo': 'bar' } } } };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('rejects unknown keys at top of expected (strict ExpectedBlock)', () => {
    const c = { ...base, expected: { http_status: 200 } };
    expect(() => ContractSchema.parse(c)).toThrow();
  });

  it('rejects unknown keys inside expected.http (strict)', () => {
    const c = { ...base, expected: { http: { status: 200, weird: true } } };
    expect(() => ContractSchema.parse(c)).toThrow();
  });

  it('rejects unknown keys inside expected.http.body (strict)', () => {
    const c = {
      ...base,
      expected: { http: { body: { equals: '{"ok":true}' } } },
    };
    expect(() => ContractSchema.parse(c)).toThrow();
  });
});
