import { describe, it, expect } from 'vitest';
import { classifyDiff } from '../src/declared-fields.js';

const diff = {
  url: { before: '/x', after: '/agents', changed: true },
  localStorage: { added: ['posthog-id'], removed: [] },
  cookies: { added: [], removed: [] },
};

const noise = {
  project: 'x',
  generated_at: '2026-05-14T00:00:00Z',
  ignore: {
    localStorage_keys: ['^posthog-'],
    sessionStorage_keys: [],
    cookies: [],
    network_url_patterns: [],
    console_patterns: [],
  },
};

describe('classifyDiff', () => {
  it('declared positive that matches expected → PASS contribution', () => {
    const r = classifyDiff(diff, { url: { matches: '^/agents$' } }, noise);
    expect(r.passContributions).toContainEqual({ field: 'url', detail: 'matches ^/agents$' });
    expect(r.failContributions).toEqual([]);
  });

  it('declared negative violated → FAIL contribution', () => {
    const r = classifyDiff(
      { ...diff, localStorage: { added: ['sb-token'], removed: [] } },
      { localStorage: { no_key_matches: '^sb-' } },
      noise,
    );
    expect(r.failContributions[0]!.field).toBe('localStorage');
  });

  it('undeclared field with noise match → ignored', () => {
    const r = classifyDiff(diff, { url: { matches: '^/agents$' } }, noise);
    expect(r.noiseIgnored).toContain('localStorage:posthog-id');
  });

  it('undeclared field NOT in noise → still ignored (§8.5.1 row 4)', () => {
    const noiseEmpty = {
      ...noise,
      ignore: { ...noise.ignore, localStorage_keys: [] },
    };
    const r = classifyDiff(diff, { url: { matches: '^/agents$' } }, noiseEmpty);
    expect(r.failContributions.every((f) => f.field !== 'localStorage')).toBe(true);
  });

  it('watch_keys overrides noise', () => {
    const r = classifyDiff(
      diff,
      { url: { matches: '^/agents$' }, watch_keys: { localStorage: ['^posthog-'] } },
      noise,
    );
    expect(r.watchedKeysMatched).toContain('posthog-id');
  });

  // Symmetric coverage to the localStorage post-state check: a cookie that
  // was already present BEFORE the action and remains present AFTER must
  // still violate cookies.no_name_matches. Without this, a real logout bug
  // on a cookie-auth app (e.g. apk_sid not cleared) would silently PASS.
  it('cookies.no_name_matches checks afterState (logout-style leak)', () => {
    const noLeakDiff = {
      url: { before: '/lobby', after: '/login', changed: true },
      localStorage: { added: [], removed: [] },
      // The cookie was present BEFORE the action, the diff has no "added"
      // entry — yet the cookie is still in afterState, which violates the
      // contract.
      cookies: { added: [], removed: [] },
    };
    const after = { url: '/login', localStorageKeys: [], cookies: ['apk_sid'] };
    const r = classifyDiff(
      noLeakDiff,
      { cookies: { no_name_matches: '^apk_sid$' } },
      noise,
      after,
    );
    expect(r.failContributions.some((f) => f.field === 'cookies' && f.actual === 'apk_sid')).toBe(true);
  });

  it('cookies.no_name_matches falls back to diff.added when afterState absent', () => {
    const addedDiff = {
      url: { before: '/', after: '/lobby', changed: true },
      localStorage: { added: [], removed: [] },
      cookies: { added: ['apk_sid'], removed: [] },
    };
    const r = classifyDiff(addedDiff, { cookies: { no_name_matches: '^apk_sid$' } }, noise);
    expect(r.failContributions.some((f) => f.field === 'cookies')).toBe(true);
  });
});
