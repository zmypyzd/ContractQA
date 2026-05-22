import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../src/schemas/contract.schema.js';

const valid = {
  id: 'INV-A2',
  title: 'Logged-out users cannot access protected routes',
  area: 'auth',
  severity: 'P0',
  preconditions: { auth_state: 'logged_in', role: 'normal_user' },
  actions: [
    { type: 'goto', path: '/lobby' },
    { type: 'click', target: { role: 'button', name_regex: 'logout' } },
    { type: 'goto', path: '/agents' },
  ],
  expected: {
    url: { matches: '^/login' },
    auth_state: { fully_logged_out: true },
  },
  verification: { wait_ms: 3000, retries: 2, evidence_required: ['state_diff', 'trace'] },
};

describe('ContractSchema', () => {
  it('parses a well-formed §7.2 contract', () => {
    const parsed = ContractSchema.parse(valid);
    expect(parsed.id).toBe('INV-A2');
    expect(parsed.severity).toBe('P0');
  });

  it('rejects missing id', () => {
    const { id, ...rest } = valid;
    expect(() => ContractSchema.parse(rest)).toThrow();
  });

  it('rejects invalid severity', () => {
    expect(() => ContractSchema.parse({ ...valid, severity: 'P5' })).toThrow();
  });

  it('rejects ReDoS-dangerous regex in name_regex', () => {
    const bad = {
      ...valid,
      actions: [{ type: 'click', target: { role: 'button', name_regex: '(a+)+$' } }],
    };
    expect(() => ContractSchema.parse(bad)).toThrow(/unsafe regex/i);
  });

  describe('id format (relaxed: any safe identifier)', () => {
    // The original schema required `^INV-[A-Z0-9-]+$`. That assumed contracts
    // were hand-written ticket-style. Autopilot's deep-discovery emits
    // descriptive kebab-case ids (e.g. agent-picker-cancel-closes-popover)
    // at hundreds per run. The relaxed regex accepts both styles plus any
    // sane identifier; naming convention is now a docs/lint concern, not a
    // schema concern. Backward compatible: every prior INV-XX id still passes.
    it.each([
      'INV-A2',
      'INV-W1-no-auth-tokens',
      'agent-picker-cancel-closes-popover',
      'api-auth-logout-clears-session-cookie',
      'simpleId',
      'a',
      'mixedCASE-with-Dashes-123',
    ])('accepts %s', (id) => {
      expect(() => ContractSchema.parse({ ...valid, id })).not.toThrow();
    });

    it.each([
      ['empty string', ''],
      ['starts with digit', '1starts-with-digit'],
      ['has space', 'has space'],
      ['has slash', 'has/slash'],
      ['has dot', 'has.dot'],
      ['has underscore at start', '_leading-underscore'],
      ['over 100 chars', 'x'.repeat(101)],
    ])('rejects (%s)', (_label, id) => {
      expect(() => ContractSchema.parse({ ...valid, id })).toThrow();
    });
  });
});
