import type { DomShape } from '@contractqa/core';

export interface StateSlice {
  url: string;
  localStorageKeys: string[];
  cookies: string[];
  dom?: DomShape;
}

export interface StateDiff {
  url: { before: string; after: string; changed: boolean };
  localStorage: { added: string[]; removed: string[] };
  cookies: { added: string[]; removed: string[] };
}

function diffArrays(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    added: b.filter((x) => !sa.has(x)),
    removed: a.filter((x) => !sb.has(x)),
  };
}

export function computeStateDiff(before: StateSlice, after: StateSlice): StateDiff {
  return {
    url: { before: before.url, after: after.url, changed: before.url !== after.url },
    localStorage: diffArrays(before.localStorageKeys, after.localStorageKeys),
    cookies: diffArrays(before.cookies, after.cookies),
  };
}
