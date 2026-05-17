'use server';

import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type DetectionResult =
  | {
      ok: true;
      resolvedPath: string;
      detected: {
        packageManager: 'pnpm' | 'yarn' | 'npm' | 'bun' | 'unknown';
        isWorkspace: boolean;
        packageCount: number;
        hasNext: boolean;
        nextLocation: string | null;
        hasContracts: boolean;
        contractsCount: number;
      };
    }
  | { ok: false; error: string };

export async function validateProjectPath(rawPath: string): Promise<DetectionResult> {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { ok: false, error: 'Path is empty.' };
  }

  // Resolve ~ and relative paths against process.cwd(). The user's expectation
  // is that the path field is an absolute or tilde-prefixed path; we won't
  // expand env vars to avoid surprise.
  const expanded = trimmed.startsWith('~')
    ? join(process.env.HOME ?? '', trimmed.slice(1))
    : trimmed;
  const abs = resolve(expanded);

  try {
    const s = await stat(abs);
    if (!s.isDirectory()) {
      return { ok: false, error: 'Path is not a directory.' };
    }
  } catch {
    return { ok: false, error: 'Path does not exist or is not readable.' };
  }

  const packageManager = await detectPackageManager(abs);
  const { isWorkspace, packageCount } = await detectWorkspace(abs, packageManager);
  const { hasNext, nextLocation } = await detectNext(abs);
  const { hasContracts, contractsCount } = await detectContracts(abs);

  return {
    ok: true,
    resolvedPath: abs,
    detected: {
      packageManager,
      isWorkspace,
      packageCount,
      hasNext,
      nextLocation,
      hasContracts,
      contractsCount,
    },
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun' | 'unknown';

async function detectPackageManager(root: string): Promise<PackageManager> {
  if (await fileExists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fileExists(join(root, 'bun.lockb'))) return 'bun';
  if (await fileExists(join(root, 'yarn.lock'))) return 'yarn';
  if (await fileExists(join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

async function detectWorkspace(
  root: string,
  pm: PackageManager,
): Promise<{ isWorkspace: boolean; packageCount: number }> {
  // pnpm: pnpm-workspace.yaml lists package globs
  if (pm === 'pnpm' && (await fileExists(join(root, 'pnpm-workspace.yaml')))) {
    const count = await countWorkspaceDirs(root, ['packages', 'apps']);
    return { isWorkspace: true, packageCount: count };
  }

  // npm/yarn/bun: workspaces field in package.json
  try {
    const pkgRaw = await readFile(join(root, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    if (pkg.workspaces) {
      const count = await countWorkspaceDirs(root, ['packages', 'apps']);
      return { isWorkspace: true, packageCount: count };
    }
  } catch {
    // no package.json or invalid — fall through
  }

  return { isWorkspace: false, packageCount: 0 };
}

async function countWorkspaceDirs(root: string, candidates: string[]): Promise<number> {
  let total = 0;
  for (const dir of candidates) {
    try {
      const entries = await readdir(join(root, dir), { withFileTypes: true });
      total += entries.filter((e) => e.isDirectory()).length;
    } catch {
      // dir doesn't exist
    }
  }
  return total;
}

async function detectNext(root: string): Promise<{ hasNext: boolean; nextLocation: string | null }> {
  const candidates = [
    '',
    'apps/web',
    'apps/dashboard',
    'apps/app',
    'web',
    'dashboard',
    'site',
  ];

  for (const rel of candidates) {
    const dir = join(root, rel);
    if (await fileExists(join(dir, 'next.config.js'))) return { hasNext: true, nextLocation: rel || '.' };
    if (await fileExists(join(dir, 'next.config.ts'))) return { hasNext: true, nextLocation: rel || '.' };
    if (await fileExists(join(dir, 'next.config.mjs'))) return { hasNext: true, nextLocation: rel || '.' };
  }

  // Fall back to package.json scan at root
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (pkg.dependencies?.next || pkg.devDependencies?.next) {
      return { hasNext: true, nextLocation: '.' };
    }
  } catch {
    // ignore
  }

  return { hasNext: false, nextLocation: null };
}

async function detectContracts(root: string): Promise<{ hasContracts: boolean; contractsCount: number }> {
  const dir = join(root, 'qa', 'contracts');
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    const count = entries.filter(
      (e) => e.isFile() && (e.name.endsWith('.contract.ts') || e.name.endsWith('.contract.js')),
    ).length;
    return { hasContracts: count > 0, contractsCount: count };
  } catch {
    return { hasContracts: false, contractsCount: 0 };
  }
}
