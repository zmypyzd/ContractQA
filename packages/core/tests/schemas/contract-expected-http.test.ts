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

describe('ContractSchema — expected.dom rich assertions (Stream 5)', () => {
  const base = {
    id: 'dom-rich',
    title: 'dom rich assertion',
    area: 'core',
    severity: 'P2' as const,
    actions: [{ type: 'goto', path: '/x' }],
    verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
  };

  it('accepts attribute_equals with string and boolean equals', () => {
    const c = {
      ...base,
      expected: {
        dom: {
          attribute_equals: [
            { target: { role: 'button', name_regex: 'All-?in' }, attribute: 'disabled', equals: true },
            { target: { test_id: 'tab-featured' }, attribute: 'aria-selected', equals: 'true' },
          ],
        },
      },
    };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('rejects attribute_equals item with missing equals', () => {
    const c = {
      ...base,
      expected: {
        dom: { attribute_equals: [{ target: { role: 'button' }, attribute: 'disabled' }] },
      },
    };
    expect(() => ContractSchema.parse(c)).toThrow();
  });

  it('accepts input_value with equals OR matches (regex)', () => {
    const c = {
      ...base,
      expected: {
        dom: {
          input_value: [
            { target: { role: 'textbox', name_regex: 'seed' }, equals: 'abc' },
            { target: { test_id: 'agent-name' }, matches: '^Player-\\d+$' },
          ],
        },
      },
    };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('rejects input_value with neither equals nor matches', () => {
    const c = {
      ...base,
      expected: { dom: { input_value: [{ target: { role: 'textbox' } }] } },
    };
    expect(() => ContractSchema.parse(c)).toThrow();
  });

  it('rejects input_value.matches with unsafe regex', () => {
    const c = {
      ...base,
      expected: { dom: { input_value: [{ target: { role: 'textbox' }, matches: '(a+)+$' }] } },
    };
    expect(() => ContractSchema.parse(c)).toThrow(/unsafe regex/i);
  });

  it('accepts class_contains', () => {
    const c = {
      ...base,
      expected: {
        dom: { class_contains: [{ target: { test_id: 'app-shell' }, class: 'is-loaded' }] },
      },
    };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('accepts element_text_equals (scoped numeric)', () => {
    const c = {
      ...base,
      expected: {
        dom: {
          element_text_equals: [
            { target: { test_id: 'audience-count' }, equals: '0' },
          ],
        },
      },
    };
    expect(() => ContractSchema.parse(c)).not.toThrow();
  });

  it('rejects unknown keys inside attribute_equals items (strict)', () => {
    const c = {
      ...base,
      expected: {
        dom: {
          attribute_equals: [
            { target: { role: 'button' }, attribute: 'disabled', equals: true, weird: 1 },
          ],
        },
      },
    };
    expect(() => ContractSchema.parse(c)).toThrow();
  });
});

describe('ContractSchema — preconditions.feature_flags (Stream 2 残量)', () => {
  const base = {
    id: 'flag-gated',
    title: 'flag-gated route',
    area: 'core',
    severity: 'P2' as const,
    actions: [{ type: 'goto', path: '/agents/123/edit' }],
    expected: { url: { matches: '^/$' } },
    verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
  };

  it('accepts preconditions.feature_flags as Record<string, boolean>', () => {
    const c = {
      ...base,
      preconditions: { feature_flags: { legacy_modules: false } },
    };
    const parsed = ContractSchema.parse(c);
    expect(parsed.preconditions?.feature_flags).toEqual({ legacy_modules: false });
  });

  it('preserves feature_flags alongside auth_state + role', () => {
    const c = {
      ...base,
      preconditions: {
        auth_state: 'logged_in',
        role: 'normal_user',
        feature_flags: { legacy_modules: false, beta_ui: true },
      },
    };
    const parsed = ContractSchema.parse(c);
    expect(parsed.preconditions?.feature_flags).toEqual({ legacy_modules: false, beta_ui: true });
    expect(parsed.preconditions?.auth_state).toBe('logged_in');
  });
});
