import { describe, expect, it } from 'vitest';
import { redactSecrets, buildPrTitle, buildPrBody } from '../src/autopilot/pr-body.js';

describe('redactSecrets', () => {
  it('redacts sk-... API keys', () => {
    const input = 'oops the key is sk-ant-abcd1234efgh5678ijkl9012mnop3456 should be hidden';
    expect(redactSecrets(input)).toBe('oops the key is [REDACTED:api-key] should be hidden');
  });

  it('redacts Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGc.payload.sig')).toBe(
      'Authorization: [REDACTED:bearer]',
    );
  });

  it('redacts lowercase bearer tokens (HTTP/curl output)', () => {
    expect(redactSecrets('authorization: bearer eyJhbGc.payload.sig')).toBe(
      'authorization: [REDACTED:bearer]',
    );
  });

  it('redacts uppercase SK- API key prefix', () => {
    expect(redactSecrets('leaked: SK-ant-AAAAAAAAAAAAAAAAAAAA')).toBe(
      'leaked: [REDACTED:api-key]',
    );
  });

  it('redacts password=... assignments', () => {
    expect(redactSecrets('login with password=hunter2!')).toBe('login with [REDACTED:password]');
  });

  it('leaves benign strings alone', () => {
    expect(redactSecrets('the test ran fine and passed')).toBe('the test ran fine and passed');
  });

  it('redacts multiple secrets in same string', () => {
    const r = redactSecrets('sk-xxxxxxxxxxxxxxxxxxxx and Bearer abc.def.ghi');
    expect(r).toContain('[REDACTED:api-key]');
    expect(r).toContain('[REDACTED:bearer]');
  });
});

describe('buildPrTitle', () => {
  it('uses first sentence of root_cause', () => {
    expect(
      buildPrTitle({
        issueId: 'smoke:auth-redirect',
        rootCause: 'Session token persisted after logout. Affects all users.',
      }),
    ).toBe('fix(contractqa): smoke:auth-redirect — Session token persisted after logout');
  });

  it('falls back to "auto-fix" when root_cause is empty', () => {
    expect(buildPrTitle({ issueId: 'x', rootCause: '' })).toBe('fix(contractqa): x — auto-fix');
  });

  it('truncates root cause to 80 chars', () => {
    const long = 'a'.repeat(120);
    const title = buildPrTitle({ issueId: 'y', rootCause: long });
    expect(title.length).toBeLessThanOrEqual(100);
  });

  it('redacts secrets in root_cause before including', () => {
    const title = buildPrTitle({ issueId: 'x', rootCause: 'leak: sk-abcdefghijklmnopqrstuvwx' });
    expect(title).toContain('[REDACTED:api-key]');
  });

  it('truncates safely with emoji (no broken surrogate pairs)', () => {
    // 79 'a' chars followed by an emoji — slice at 79 should NOT split the emoji
    const longEmoji = 'a'.repeat(79) + '🦆';
    const title = buildPrTitle({ issueId: 'x', rootCause: longEmoji });
    // The title must be valid UTF-16 (no lone surrogates). Verify by re-encoding.
    expect(() => new TextEncoder().encode(title)).not.toThrow();
    // The summary part is exactly the first 79 'a's; emoji is dropped (it's at index 79)
    expect(title.includes('🦆')).toBe(false);
    expect(title.endsWith('a')).toBe(true);
  });
});

describe('buildPrBody', () => {
  it('renders all sections in order with redacted root cause', () => {
    const body = buildPrBody({
      issueId: 'smoke:auth-redirect',
      rootCause: 'Token persisted. Bearer ABC.DEF.GHI was logged.',
      filesChanged: ['src/auth/logout.ts', 'src/auth/store.ts'],
      testsRun: ['auth-logout.spec.ts'],
      regressionSummary: { httpPassed: 4, skippedBrowserContracts: 2 },
      dashboardUrl: 'http://localhost:3010',
      runId: 'abc-123',
    });
    expect(body).toContain('## Root cause');
    expect(body).toContain('Token persisted'); // sentence kept
    expect(body).toContain('[REDACTED:bearer]'); // bearer redacted
    expect(body).toContain('## Files changed');
    expect(body).toContain('- `src/auth/logout.ts`');
    expect(body).toContain('## Regression check');
    expect(body).toContain('4 HTTP contracts passed');
    expect(body).toContain('2 browser contracts skipped');
    expect(body).toContain('http://localhost:3010/runs/abc-123');
  });

  it('omits Dashboard section when dashboardUrl is missing', () => {
    const body = buildPrBody({
      issueId: 'x',
      filesChanged: ['a.ts'],
      regressionSummary: { httpPassed: 0, skippedBrowserContracts: 0 },
    });
    expect(body).not.toContain('## Dashboard');
  });
});
