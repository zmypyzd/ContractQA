import type { AppAdapter, AuthAdapter, BackendAdapter } from '@contractqa/core';

export type AdapterLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface AdapterSet {
  app: AppAdapter;
  auth?: AuthAdapter;
  backend?: BackendAdapter;
  customProbes?: string[];
}

export function computeAdapterLevel(set: AdapterSet): AdapterLevel {
  if (set.customProbes && set.customProbes.length > 0 && set.backend && set.auth) return 'L3';
  if (set.backend && set.auth) return 'L2';
  if (set.auth) return 'L1';
  return 'L0';
}

export function meetsMinimum(level: AdapterLevel): boolean {
  return level === 'L1' || level === 'L2' || level === 'L3';
}
