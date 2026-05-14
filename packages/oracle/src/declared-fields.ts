import type { NoiseProfile } from '@contractqa/core';
import type { StateDiff, StateSlice } from './state-diff.js';

export interface Expected {
  url?: { matches?: string };
  localStorage?: { no_key_matches?: string; has_key_matches?: string };
  cookies?: { no_name_matches?: string };
  watch_keys?: { localStorage?: string[]; cookies?: string[] };
}

export interface DiffClassification {
  passContributions: Array<{ field: string; detail: string }>;
  failContributions: Array<{ field: string; detail: string; actual: unknown }>;
  noiseIgnored: string[];
  watchedKeysMatched: string[];
}

function matchAny(s: string, patterns: string[] | undefined): boolean {
  if (!patterns) return false;
  return patterns.some((p) => new RegExp(p).test(s));
}

export function classifyDiff(
  diff: StateDiff,
  expected: Expected,
  noise: NoiseProfile,
  afterState?: StateSlice,
): DiffClassification {
  const out: DiffClassification = {
    passContributions: [],
    failContributions: [],
    noiseIgnored: [],
    watchedKeysMatched: [],
  };

  if (expected.url?.matches) {
    const re = new RegExp(expected.url.matches);
    if (re.test(diff.url.after)) {
      out.passContributions.push({ field: 'url', detail: `matches ${expected.url.matches}` });
    } else {
      out.failContributions.push({
        field: 'url',
        detail: `expected ${expected.url.matches}`,
        actual: diff.url.after,
      });
    }
  }

  const watchLS = expected.watch_keys?.localStorage ?? [];
  const ignoreLS = noise.ignore.localStorage_keys;

  // Check post-state (afterState.localStorageKeys) for no_key_matches violations.
  // Catches keys present before AND still present after — e.g. logout that didn't
  // clear an sb-* token. Falls back to checking just added keys when afterState
  // is unavailable.
  const seenViolations = new Set<string>();
  if (expected.localStorage?.no_key_matches) {
    const re = new RegExp(expected.localStorage.no_key_matches);
    const keysToCheck = afterState ? afterState.localStorageKeys : diff.localStorage.added;
    for (const key of keysToCheck) {
      if (re.test(key) && !seenViolations.has(key)) {
        seenViolations.add(key);
        out.failContributions.push({
          field: 'localStorage',
          detail: `violates no_key_matches ${expected.localStorage.no_key_matches}`,
          actual: key,
        });
      }
    }
  }

  // Classify added keys as watched/noise/ignored.
  for (const key of diff.localStorage.added) {
    const isWatched = matchAny(key, watchLS);
    const isNoise = !isWatched && matchAny(key, ignoreLS);
    if (isWatched) out.watchedKeysMatched.push(key);
    if (isNoise) {
      out.noiseIgnored.push(`localStorage:${key}`);
    } else if (!expected.localStorage) {
      out.noiseIgnored.push(`localStorage:${key}`);
    }
  }

  if (expected.localStorage?.has_key_matches) {
    const re = new RegExp(expected.localStorage.has_key_matches);
    const present = diff.localStorage.added.some((k) => re.test(k));
    if (present) {
      out.passContributions.push({ field: 'localStorage', detail: 'has_key_matches' });
    } else {
      out.failContributions.push({
        field: 'localStorage',
        detail: `missing has_key_matches ${expected.localStorage.has_key_matches}`,
        actual: diff.localStorage.added,
      });
    }
  }

  if (expected.cookies?.no_name_matches) {
    const re = new RegExp(expected.cookies.no_name_matches);
    for (const c of diff.cookies.added) {
      if (re.test(c)) {
        out.failContributions.push({
          field: 'cookies',
          detail: `violates no_name_matches`,
          actual: c,
        });
      }
    }
  }

  return out;
}
