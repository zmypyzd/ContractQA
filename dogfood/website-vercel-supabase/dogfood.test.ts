// Dogfood test #2 — website_vercel-supabase-main (Next.js 16 + NextAuth v5 +
// Supabase). This is Phase 1's intended happy-path stack, but the target
// requires a real Supabase project + Google OAuth credentials to boot.
// Strategy: stub the env so module-level Supabase init succeeds, then test
// a pure-navigation invariant that doesn't depend on a working DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadContractsFromDir, runContract } from '@contractqa/runner';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TARGET_REPO = '/Users/zmy/intership/4/website_vercel-supabase-main';
const PORT = Number(process.env.DOGFOOD_WEBSITE_PORT ?? '3299');
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | undefined;
let browser: Browser;
let scratchDir: string;
let artifactsRoot: string;

async function pollUntil(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.ok || r.status === 200) return;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} never ready at ${url}: ${String(lastErr)}`);
}

beforeAll(async () => {
  // Stub env: module-level Supabase init won't crash, NextAuth will accept
  // the unconfigured providers, real network calls will fail but our nav
  // contract doesn't trigger any.
  server = spawn(
    'npm',
    ['run', 'dev', '--', '--port', String(PORT), '--hostname', '127.0.0.1'],
    {
      cwd: TARGET_REPO,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:1',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stub-anon-key',
        NEXTAUTH_URL: BASE,
        NEXTAUTH_SECRET: 'dogfood-stub-secret-for-jwt-signing-32+chars',
        AUTH_SECRET: 'dogfood-stub-secret-for-jwt-signing-32+chars',
        AUTH_GOOGLE_ID: 'stub-google-id',
        AUTH_GOOGLE_SECRET: 'stub-google-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stderr?.on('data', (d) => process.stderr.write(`[next-dev] ${d}`));

  await pollUntil(`${BASE}/`, 120_000, 'next dev /');

  browser = await chromium.launch();
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-website-'));
  artifactsRoot = path.join(scratchDir, 'artifacts');
}, 180_000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
  if (server && !server.killed) {
    server.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 300));
    if (!server.killed) server.kill('SIGKILL');
  }
  await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('ContractQA dogfood — website_vercel-supabase (Next.js 16 + NextAuth v5)', () => {
  it('INV-N1: Navbar Login link routes anon user to /login', async () => {
    const contracts = await loadContractsFromDir(path.join(__dir, 'contracts'));
    const inv = contracts.find((c) => c.id === 'INV-N1');
    expect(inv, 'INV-N1 must load').toBeTruthy();

    const noise = parse(await readFile(path.join(__dir, 'noise-profile.yml'), 'utf8'));

    const tracePath = path.join(scratchDir, 'trace.zip');
    const harPath = path.join(scratchDir, 'network.har');
    const beforeShot = path.join(scratchDir, 'before.png');
    const afterShot = path.join(scratchDir, 'after.png');

    const context: BrowserContext = await browser.newContext({
      baseURL: BASE,
      viewport: { width: 1280, height: 720 },
      recordHar: { path: harPath, mode: 'minimal' },
    });
    await context.tracing.start({ snapshots: true, screenshots: true, sources: false });
    const page: Page = await context.newPage();

    // Pre-navigate to a real origin so snapshotBrowser can read localStorage.
    // (T5 made snapshotBrowser tolerate about:blank too, but a real-origin
    // pre-nav keeps the before-snapshot meaningful.)
    await page.goto('/');

    const result = await runContract({
      contract: inv!,
      page: page as any,
      stripBaseUrl: BASE,
      noise,
      artifactsRoot,
      tracePath,
      harPath,
      screenshotPaths: { before: beforeShot, after: afterShot },
      attachments: [
        { name: 'evidence:trace', path: tracePath, contentType: 'application/zip' },
        { name: 'evidence:screenshot', path: afterShot, contentType: 'image/png' },
        { name: 'evidence:network', path: harPath, contentType: 'application/json' },
      ],
      alwaysBundle: true,
      flushObservability: async () => {
        await context.tracing.stop({ path: tracePath });
        await context.close();
      },
    });

    expect(result.verdict.verdict).toBe('PASS');
    expect(result.after.url).toMatch(/^\/login/);
    expect(result.bundleDir).toBeTruthy();

    const manifest = JSON.parse(
      await readFile(path.join(result.bundleDir!, 'manifest.json'), 'utf8'),
    );
    expect(manifest.contract_id).toBe('INV-N1');
    expect(manifest.files.length).toBe(6);
  });
});
