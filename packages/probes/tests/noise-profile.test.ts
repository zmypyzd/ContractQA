import { describe, it, expect } from 'vitest';
import { synthesizeNoiseProfile } from '../src/noise-profile.js';

describe('synthesizeNoiseProfile', () => {
  it('groups recurring localStorage prefixes into regex ignores', () => {
    const samples = [
      { localStorageKeys: ['posthog-1234', 'posthog-9999', 'sentry-id-aa'] },
      { localStorageKeys: ['posthog-9999', 'sentry-id-bb'] },
    ];
    const p = synthesizeNoiseProfile({
      project: 'x',
      samples,
      cookies: [],
      network: [],
      console: [],
    });
    expect(p.ignore.localStorage_keys.some((k) => k.startsWith('^posthog'))).toBe(true);
    expect(p.ignore.localStorage_keys.some((k) => k.startsWith('^sentry'))).toBe(true);
  });

  it('keeps singletons out of ignore list', () => {
    const p = synthesizeNoiseProfile({
      project: 'x',
      samples: [{ localStorageKeys: ['only-once'] }],
      cookies: [],
      network: [],
      console: [],
    });
    expect(p.ignore.localStorage_keys).not.toContain('^only-once');
  });
});
