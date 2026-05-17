// packages/cli/src/autopilot/bootstrap.ts
import { readFile, access, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectFramework, type Framework } from '../init/detect-framework.js';
import { inspectAuthWiring } from '../init/inspect-auth.js';

const exec = promisify(execFile);

export type AuthProvider = 'supabase' | 'clerk' | 'nextauth' | 'auth0' | 'custom-cookie' | 'unknown';

export interface TestCredentials {
  source: 'env' | 'supabase-temp-user' | 'none';
  envKeyName?: string;
  email?: string;
  password?: string;
}

export interface TargetContext {
  cwd: string;
  framework: Framework;
  authProvider: AuthProvider;
  routes: readonly string[];
  testCredentials: TestCredentials;
  envFiles: readonly string[];
}

const ENV_CRED_PAIRS: Array<{ email: string; password: string }> = [
  { email: 'SUPABASE_TEST_EMAIL', password: 'SUPABASE_TEST_PASSWORD' },
  { email: 'TEST_USER_EMAIL', password: 'TEST_USER_PASSWORD' },
  { email: 'E2E_USER_EMAIL', password: 'E2E_USER_PASSWORD' },
  { email: 'PLAYWRIGHT_AUTH_EMAIL', password: 'PLAYWRIGHT_AUTH_PASSWORD' },
  { email: 'CYPRESS_TEST_USER_EMAIL', password: 'CYPRESS_TEST_USER_PASSWORD' },
  { email: 'NEXT_PUBLIC_TEST_EMAIL', password: 'NEXT_PUBLIC_TEST_PASSWORD' },
  { email: 'CI_TEST_EMAIL', password: 'CI_TEST_PASSWORD' },
  { email: 'DEV_USER_EMAIL', password: 'DEV_USER_PASSWORD' },
];

const ENV_FILE_CANDIDATES = ['.env', '.env.example', '.env.development.local', '.env.test', '.env.local'];

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function sniffCredentials(cwd: string): { creds: TestCredentials; envFiles: string[] } {
  const merged: Record<string, string> = {};
  const found: string[] = [];
  for (const f of ENV_FILE_CANDIDATES) {
    const p = join(cwd, f);
    if (existsSync(p)) {
      found.push(f);
      Object.assign(merged, parseEnvFile(readFileSync(p, 'utf8')));
    }
  }
  // Try TEST_USER_JSON first (blob form).
  if (merged.TEST_USER_JSON) {
    try {
      const blob = JSON.parse(merged.TEST_USER_JSON) as { email?: string; password?: string };
      if (blob.email && blob.password) {
        return { creds: { source: 'env', envKeyName: 'TEST_USER_JSON', email: blob.email, password: blob.password }, envFiles: found };
      }
    } catch {
      // ignore malformed JSON
    }
  }
  for (const pair of ENV_CRED_PAIRS) {
    if (merged[pair.email] && merged[pair.password]) {
      return {
        creds: { source: 'env', envKeyName: pair.email, email: merged[pair.email], password: merged[pair.password] },
        envFiles: found,
      };
    }
  }
  return { creds: { source: 'none' }, envFiles: found };
}

async function listFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(cwd);
    for (const entry of entries) {
      files.push(entry);
      // Also list one level deep (app/, pages/, src/ etc.) for framework detection
      try {
        const sub = await readdir(join(cwd, entry));
        for (const s of sub) {
          files.push(`${entry}/${s}`);
        }
      } catch {
        // Not a directory or unreadable
      }
    }
  } catch {
    // ignore
  }
  return files;
}

export async function assembleTargetContext(cwd: string): Promise<TargetContext> {
  // Git check.
  try {
    await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
  } catch {
    throw new Error(`autopilot bootstrap: ${cwd} is not a git repository. Run 'git init' to initialize.`);
  }

  // package.json check.
  try {
    await access(join(cwd, 'package.json'));
  } catch {
    throw new Error(`autopilot bootstrap: no package.json found at ${cwd}.`);
  }

  const pjContent = await readFile(join(cwd, 'package.json'), 'utf8');
  const packageJson = JSON.parse(pjContent) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const files = await listFiles(cwd);

  const detectResult = await detectFramework({ packageJson, files });
  const authSignals = detectResult.authSignals;

  // Map auth signals to AuthProvider (take first detected or 'unknown').
  const authSignalToProvider: Record<string, AuthProvider> = {
    'supabase': 'supabase',
    'clerk': 'clerk',
    'next-auth': 'nextauth',
    'auth0': 'auth0',
    'custom-cookie': 'custom-cookie',
  };
  const authProvider: AuthProvider = authSignals.length > 0
    ? (authSignalToProvider[authSignals[0]!] ?? 'unknown')
    : 'unknown';

  // Inspect auth wiring for the detected signals.
  const authDiagnostics = inspectAuthWiring({ files, signals: authSignals });
  void authDiagnostics; // Available for future use

  // Route enumeration is best-effort. For Next.js app dir, find top-level route folders.
  const routes: string[] = [];
  if (files.some((f) => f.startsWith('app/'))) {
    routes.push('/');
  }

  const { creds, envFiles } = sniffCredentials(cwd);

  return {
    cwd,
    framework: detectResult.framework,
    authProvider,
    routes,
    testCredentials: creds,
    envFiles,
  };
}
