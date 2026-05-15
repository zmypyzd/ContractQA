import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
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

export interface PlaywrightResolver {
  resolve(id: string): string;
}

const defaultPlaywrightResolver: PlaywrightResolver = createRequire(import.meta.url);

/**
 * Verify `@playwright/test` is resolvable from this module.
 *
 * Returns `{ ok: true }` when the package is installed and importable, or
 * `{ ok: false, error }` with a one-line install hint otherwise. Callers
 * should treat a `false` result as a fatal precondition and surface the
 * error to the user before attempting any operation that loads Playwright.
 *
 * Pure — accepts an optional resolver for test injection.
 */
export function checkPlaywright(
  resolver: PlaywrightResolver = defaultPlaywrightResolver,
): { ok: true } | { ok: false; error: string } {
  try {
    resolver.resolve('@playwright/test');
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        '@playwright/test is not installed.\n' +
        'Install it with:  npm install @playwright/test && npx playwright install chromium',
    };
  }
}

export async function runContracts(opts: {
  contractsDir: string;
  artifactsRoot: string;
  changedFiles?: string[];
  baseUrl?: string;
}): Promise<{ exitCode: number }> {
  const check = checkPlaywright();
  if (!check.ok) {
    console.error(check.error);
    return { exitCode: 1 };
  }

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
