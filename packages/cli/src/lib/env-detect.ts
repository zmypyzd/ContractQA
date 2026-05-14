import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface RequiredVar {
  name: string;
  source: '.env.example' | 'README' | 'package.json' | 'doctor';
  suggestedStub: string;
}

const STUB_RULES: Array<{ test: RegExp; stub: () => string }> = [
  { test: /SECRET$|_KEY$/, stub: () => crypto.randomBytes(32).toString('hex') },
  { test: /URL$/, stub: () => 'http://localhost:1' },
  { test: /^PORT$/, stub: () => '3000' },
  { test: /CLIENT_ID|API_KEY/, stub: () => 'stub-id' },
];

function stubFor(name: string): string {
  for (const rule of STUB_RULES) if (rule.test.test(name)) return rule.stub();
  return 'stub';
}

async function readMaybe(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function detectRequiredEnv(repoRoot: string): Promise<RequiredVar[]> {
  const seen = new Map<string, RequiredVar>();
  const add = (name: string, source: RequiredVar['source']): void => {
    if (!seen.has(name)) seen.set(name, { name, source, suggestedStub: stubFor(name) });
  };

  const envExample =
    (await readMaybe(path.join(repoRoot, '.env.example'))) ??
    (await readMaybe(path.join(repoRoot, '.env.template'))) ??
    (await readMaybe(path.join(repoRoot, 'env.template')));
  if (envExample) {
    for (const line of envExample.split('\n')) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]+)=/);
      if (m && m[1]) add(m[1], '.env.example');
    }
  }

  const pkgRaw = await readMaybe(path.join(repoRoot, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      for (const cmd of Object.values(pkg.scripts ?? {})) {
        for (const m of cmd.matchAll(/\$\{?([A-Z][A-Z0-9_]+)(?::-[^}]+)?\}?/g)) {
          if (m[1]) add(m[1], 'package.json');
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
