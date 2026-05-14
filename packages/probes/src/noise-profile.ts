import type { NoiseProfile } from '@contractqa/core';

export interface NoiseInput {
  project: string;
  samples: Array<{ localStorageKeys: string[] }>;
  cookies: string[];
  network: string[];
  console: string[];
}

function commonPrefixes(values: string[], minOccur = 2, minLen = 3): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    for (let i = minLen; i <= Math.min(v.length, 12); i++) {
      const p = v.slice(0, i);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  const winners = [...counts.entries()]
    .filter(([, c]) => c >= minOccur)
    .sort((a, b) => b[0].length - a[0].length);
  const picked: string[] = [];
  for (const [p] of winners) {
    if (!picked.some((q) => p.startsWith(q))) picked.push(p);
  }
  return picked.map((p) => '^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

export function synthesizeNoiseProfile(input: NoiseInput): NoiseProfile {
  const lsKeys = input.samples.flatMap((s) => s.localStorageKeys);
  return {
    project: input.project,
    generated_at: new Date().toISOString(),
    ignore: {
      localStorage_keys: commonPrefixes(lsKeys),
      sessionStorage_keys: [],
      cookies: commonPrefixes(input.cookies),
      network_url_patterns: input.network,
      console_patterns: input.console,
    },
  };
}
