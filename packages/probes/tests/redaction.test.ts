import { describe, it, expect } from 'vitest';
import {
  redactValue,
  redactHeaders,
  redactBody,
  defaultRedactionRules,
} from '../src/redaction.js';

describe('redaction (§8.4)', () => {
  it('redacts string value', () => {
    expect(redactValue('secret-token')).toEqual({ __redacted: true });
  });
  it('redacts sensitive headers case-insensitively', () => {
    const r = redactHeaders(
      { Authorization: 'Bearer x', 'X-API-Key': 'y', 'User-Agent': 'pw' },
      defaultRedactionRules,
    );
    expect(r['Authorization']).toEqual({ __redacted: true });
    expect(r['X-API-Key']).toEqual({ __redacted: true });
    expect(r['User-Agent']).toBe('pw');
  });
  it('redacts sensitive body fields recursively', () => {
    const r = redactBody(
      { user: { password: 'abc', name: 'leo', token: 'xyz' }, list: [{ secret: 'x' }] },
      defaultRedactionRules,
    );
    expect(r).toMatchObject({
      user: { password: { __redacted: true }, name: 'leo', token: { __redacted: true } },
      list: [{ secret: { __redacted: true } }],
    });
  });
});
