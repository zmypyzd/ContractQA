import { describe, it, expect } from 'vitest';
import { computeStateDiff } from '../src/state-diff.js';

describe('computeStateDiff', () => {
  it('reports cookies removed, localStorage unchanged', () => {
    const d = computeStateDiff(
      { url: '/lobby', localStorageKeys: ['sb-xyz-auth-token', 'theme'], cookies: ['app_sid'] },
      { url: '/lobby', localStorageKeys: ['sb-xyz-auth-token', 'theme'], cookies: [] },
    );
    expect(d.url.changed).toBe(false);
    expect(d.cookies.removed).toEqual(['app_sid']);
    expect(d.localStorage.added).toEqual([]);
    expect(d.localStorage.removed).toEqual([]);
  });
  it('reports added and removed keys', () => {
    const d = computeStateDiff(
      { url: '/a', localStorageKeys: ['x'], cookies: [] },
      { url: '/b', localStorageKeys: ['y'], cookies: [] },
    );
    expect(d.url.changed).toBe(true);
    expect(d.localStorage.added).toEqual(['y']);
    expect(d.localStorage.removed).toEqual(['x']);
  });
});
