import type { NoiseProfile } from '@contractqa/core';
import type { StateDiff, StateSlice } from './state-diff.js';
import { classifyDom, type DomExpected } from './dom-classifier.js';

export interface Expected {
  url?: { matches?: string };
  localStorage?: { no_key_matches?: string; has_key_matches?: string };
  cookies?: { no_name_matches?: string };
  dom?: DomExpected;
  watch_keys?: { localStorage?: string[]; cookies?: string[] };
  http?: HttpExpected;
}

export interface HttpExpected {
  status?: number | number[];
  body?: {
    contains?: string[];
    not_contains?: string[];
    contains_keys?: string[];
    not_contains_keys?: string[];
  };
  headers?: Record<string, string>;
}

export interface CapturedHttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
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

// Classify expected.http against a captured response. Used standalone by
// runHttpContract (no Playwright) and from inside classifyDiff for mixed
// http+browser contracts.
export function classifyHttp(
  expected: HttpExpected,
  response: CapturedHttpResponse | undefined,
): Pick<DiffClassification, 'passContributions' | 'failContributions'> {
  const pass: DiffClassification['passContributions'] = [];
  const fail: DiffClassification['failContributions'] = [];

  if (!response) {
    fail.push({
      field: 'http',
      detail: 'contract declares expected.http but no http response was captured',
      actual: null,
    });
    return { passContributions: pass, failContributions: fail };
  }

  if (expected.status !== undefined) {
    const want = Array.isArray(expected.status) ? expected.status : [expected.status];
    if (want.includes(response.status)) {
      pass.push({ field: 'http.status', detail: `${response.status} in ${JSON.stringify(want)}` });
    } else {
      fail.push({
        field: 'http.status',
        detail: `expected one of ${JSON.stringify(want)}`,
        actual: response.status,
      });
    }
  }

  if (expected.body) {
    const bodyStr = response.body;
    let parsedKeys: string[] | null = null;
    const ensureParsedKeys = (): string[] => {
      if (parsedKeys !== null) return parsedKeys;
      try {
        const obj = JSON.parse(bodyStr) as unknown;
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          parsedKeys = Object.keys(obj as Record<string, unknown>);
        } else {
          parsedKeys = [];
        }
      } catch {
        parsedKeys = [];
      }
      return parsedKeys;
    };

    for (const needle of expected.body.contains ?? []) {
      if (bodyStr.includes(needle)) {
        pass.push({ field: 'http.body.contains', detail: needle });
      } else {
        fail.push({
          field: 'http.body.contains',
          detail: `expected body to contain '${needle}'`,
          actual: bodyStr.slice(0, 240),
        });
      }
    }
    for (const needle of expected.body.not_contains ?? []) {
      if (!bodyStr.includes(needle)) {
        pass.push({ field: 'http.body.not_contains', detail: needle });
      } else {
        fail.push({
          field: 'http.body.not_contains',
          detail: `expected body to NOT contain '${needle}'`,
          actual: bodyStr.slice(0, 240),
        });
      }
    }
    for (const key of expected.body.contains_keys ?? []) {
      const keys = ensureParsedKeys();
      if (keys.includes(key)) {
        pass.push({ field: 'http.body.contains_keys', detail: key });
      } else {
        fail.push({
          field: 'http.body.contains_keys',
          detail: `expected body JSON to contain key '${key}'`,
          actual: keys,
        });
      }
    }
    for (const key of expected.body.not_contains_keys ?? []) {
      const keys = ensureParsedKeys();
      if (!keys.includes(key)) {
        pass.push({ field: 'http.body.not_contains_keys', detail: key });
      } else {
        fail.push({
          field: 'http.body.not_contains_keys',
          detail: `expected body JSON to NOT contain key '${key}'`,
          actual: keys,
        });
      }
    }
  }

  if (expected.headers) {
    for (const [name, want] of Object.entries(expected.headers)) {
      const got = response.headers[name.toLowerCase()];
      if (got === want) {
        pass.push({ field: `http.headers.${name}`, detail: want });
      } else {
        fail.push({
          field: `http.headers.${name}`,
          detail: `expected header ${name}=${want}`,
          actual: got ?? null,
        });
      }
    }
  }

  return { passContributions: pass, failContributions: fail };
}

export function classifyDiff(
  diff: StateDiff,
  expected: Expected,
  noise: NoiseProfile,
  afterState?: StateSlice,
  httpResponse?: CapturedHttpResponse,
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
    // Symmetric to the localStorage post-state check above: a cookie that was
    // present before AND still present after (e.g. a logout that failed to
    // clear `apk_sid`) would never appear in `diff.cookies.added`. Inspect
    // the after-state when available; fall back to delta-only otherwise.
    const seenCookieViolations = new Set<string>();
    const cookiesToCheck = afterState ? afterState.cookies : diff.cookies.added;
    for (const c of cookiesToCheck) {
      if (re.test(c) && !seenCookieViolations.has(c)) {
        seenCookieViolations.add(c);
        out.failContributions.push({
          field: 'cookies',
          detail: `violates no_name_matches ${expected.cookies.no_name_matches}`,
          actual: c,
        });
      }
    }
  }

  if (expected.dom && afterState?.dom) {
    const domRes = classifyDom(afterState.dom, expected.dom);
    out.passContributions.push(...domRes.passContributions);
    out.failContributions.push(...domRes.failContributions);
  } else if (expected.dom && !afterState?.dom) {
    out.failContributions.push({
      field: 'dom',
      detail:
        'contract declares dom expectations but afterState has no DomShape — call snapshotBrowser with captureDom: true',
      actual: null,
    });
  }

  if (expected.http) {
    const httpRes = classifyHttp(expected.http, httpResponse);
    out.passContributions.push(...httpRes.passContributions);
    out.failContributions.push(...httpRes.failContributions);
  }

  return out;
}
