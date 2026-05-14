import { spawn } from 'node:child_process';
import type { ContractDoc } from '@contractqa/core';

const PATH_AREA_MAP: Array<{ pattern: RegExp; area: string }> = [
  { pattern: /(^|\/)auth/i, area: 'auth' },
  { pattern: /lobby/i, area: 'lobby' },
  { pattern: /billing|stripe|subscription/i, area: 'billing' },
  { pattern: /admin/i, area: 'admin' },
  { pattern: /route|middleware/i, area: 'routes' },
];

export function selectChangedContracts(
  contracts: ContractDoc[],
  changedFiles: string[],
): ContractDoc[] {
  if (changedFiles.length === 0) return contracts;
  const areas = new Set<string>();
  for (const f of changedFiles) {
    for (const m of PATH_AREA_MAP) if (m.pattern.test(f)) areas.add(m.area);
  }
  if (areas.size === 0) return contracts;
  return contracts.filter((c) => areas.has(c.area));
}

export async function runContracts(opts: {
  contractsDir: string;
  artifactsRoot: string;
  changedFiles?: string[];
  baseUrl?: string;
}): Promise<{ exitCode: number }> {
  const env = {
    ...process.env,
    CONTRACTQA_CONTRACTS_DIR: opts.contractsDir,
    CONTRACTQA_ARTIFACTS_ROOT: opts.artifactsRoot,
    CONTRACTQA_CHANGED_FILES: opts.changedFiles?.join(',') ?? '',
    ...(opts.baseUrl ? { CONTRACTQA_BASE_URL: opts.baseUrl } : {}),
  };
  return new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['exec', 'playwright', 'test', '--config=playwright.config.ts'],
      { env, stdio: 'inherit' },
    );
    child.on('exit', (code) => resolve({ exitCode: code ?? 1 }));
  });
}
