// packages/cli/src/commands/dashboard.ts
//
// `contractqa dashboard` — one-shot launcher for the local dashboard.
//
// Brings up Postgres + MinIO via docker compose, waits for Postgres TCP ready,
// applies idempotent migrations, then spawns `next dev` and prints the URL.
// Only works from within the contractqa monorepo (the dashboard source is not
// shipped in the published CLI tarball).

import { access, readdir } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';

export interface DashboardOptions {
  cwd: string;
  port: number;
  startDocker: boolean;
  applyMigrations: boolean;
  dbUrl: string;
  waitForPostgresMs: number;
}

const DEFAULT_DB_URL = 'postgres://contractqa:contractqa@localhost:5432/contractqa';

/**
 * Locate the contractqa monorepo root by walking up from `start`.
 *
 * A directory qualifies when it contains BOTH `apps/dashboard/package.json`
 * and `docker/docker-compose.yml` — together these are the artefacts the
 * launcher needs. We do not rely on `pnpm-workspace.yaml` alone because a
 * future user might rename the workspace file.
 */
export async function findMonorepoRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  while (true) {
    try {
      await access(join(dir, 'apps/dashboard/package.json'));
      await access(join(dir, 'docker/docker-compose.yml'));
      return dir;
    } catch {
      // not here — walk up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function waitForPostgres(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((res) => {
      const sock = connect({ host, port }, () => {
        sock.end();
        res(true);
      });
      sock.on('error', () => res(false));
      sock.setTimeout(1000, () => {
        sock.destroy();
        res(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function parseHostPort(dbUrl: string): { host: string; port: number } {
  try {
    const u = new URL(dbUrl);
    return { host: u.hostname || 'localhost', port: Number(u.port || '5432') };
  } catch {
    return { host: 'localhost', port: 5432 };
  }
}

async function applyMigrations(rootDir: string, dbUrl: string): Promise<void> {
  const migDir = join(rootDir, 'apps/dashboard/drizzle/migrations');
  let files: string[];
  try {
    files = (await readdir(migDir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return;
  }
  if (files.length === 0) return;
  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if (psql.status !== 0) {
    console.log('[dashboard] psql not on PATH — skipping migrations. Apply manually:');
    for (const f of files) console.log(`  psql "${dbUrl}" -f apps/dashboard/drizzle/migrations/${f}`);
    return;
  }
  for (const f of files) {
    const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', join(migDir, f)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.log(`[dashboard] migration ${f} failed (continuing — may already be applied)`);
      if (r.stderr) console.log(r.stderr.trim().split('\n').map((l) => `  ${l}`).join('\n'));
    }
  }
}

export async function runDashboard(opts: DashboardOptions): Promise<number> {
  const root = await findMonorepoRoot(opts.cwd);
  if (!root) {
    console.error('[dashboard] could not locate contractqa monorepo from', opts.cwd);
    console.error('[dashboard] the dashboard is only runnable from within the source repo.');
    return 1;
  }

  const composeFile = join(root, 'docker/docker-compose.yml');
  const { host, port: pgPort } = parseHostPort(opts.dbUrl);

  if (opts.startDocker) {
    console.log('[dashboard] docker compose up -d ...');
    const dc = spawnSync('docker', ['compose', '-f', composeFile, 'up', '-d'], {
      stdio: 'inherit',
    });
    if (dc.status !== 0) {
      console.error('[dashboard] docker compose failed. Pass --no-docker if you already have Postgres running.');
      return dc.status ?? 1;
    }
  }

  console.log(`[dashboard] waiting for Postgres at ${host}:${pgPort} ...`);
  const ready = await waitForPostgres(host, pgPort, opts.waitForPostgresMs);
  if (!ready) {
    console.error(`[dashboard] Postgres not ready after ${opts.waitForPostgresMs}ms.`);
    return 1;
  }
  console.log('[dashboard] Postgres ready.');

  if (opts.applyMigrations) {
    await applyMigrations(root, opts.dbUrl);
  }

  const url = `http://localhost:${opts.port}`;
  console.log(`[dashboard] starting next dev on ${url}`);
  const child: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@contractqa/dashboard', 'exec', 'next', 'dev', '--port', String(opts.port)],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: opts.dbUrl },
    },
  );

  return await new Promise<number>((res) => {
    const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
    process.on('SIGINT', forward('SIGINT'));
    process.on('SIGTERM', forward('SIGTERM'));
    child.on('exit', (code) => res(code ?? 0));
  });
}

export const DASHBOARD_DEFAULTS = {
  port: 3000,
  startDocker: true,
  applyMigrations: true,
  dbUrl: DEFAULT_DB_URL,
  waitForPostgresMs: 30_000,
};
