// Dogfood test #2 — website_vercel-supabase-main (Next.js 16 + NextAuth v5 +
// Supabase). This is Phase 1's intended happy-path stack, but the target
// requires a real Supabase project + Google OAuth credentials to boot.
// Strategy: stub the env so module-level Supabase init succeeds, then test
// a pure-navigation invariant that doesn't depend on a working DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadContractsFromDir, compileContract, runOracle } from '@contractqa/runner';
import type { CompiledPage } from '@contractqa/runner';
import { snapshotBrowser } from '@contractqa/probes';
import type { StateSlice } from '@contractqa/oracle';
import { writeEvidenceBundle } from '@contractqa/evidence';

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
    // (about:blank has no origin → SecurityError on `window.localStorage`.)
    // This is a workaround — the framework should handle origin-less pages.
    await page.goto('/');
    const beforeSnap = await snapshotBrowser(
      page as unknown as Parameters<typeof snapshotBrowser>[0],
      { screenshotPath: beforeShot },
    );

    const stripBase = (u: string): string => {
      if (u.startsWith(BASE)) return u.slice(BASE.length) || '/';
      if (u === 'about:blank') return '/';
      return u;
    };
    const sliceFromSnap = (snap: typeof beforeSnap): StateSlice => ({
      url: stripBase(snap.url),
      localStorageKeys: Object.keys(snap.localStorage),
      cookies: snap.cookies.map((c) => c.name),
    });

    // Drive INV-N1 — goto /, click 登录, then verify.
    const compiled = compileContract(inv!);
    await compiled({
      page: page as unknown as CompiledPage,
      snapshot: async () => ({
        url: stripBase(page.url()),
        localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
        cookies: (await context.cookies()).map((c) => c.name),
      }),
    });

    const afterSnap = await snapshotBrowser(
      page as unknown as Parameters<typeof snapshotBrowser>[0],
      { screenshotPath: afterShot },
    );
    const beforeState = sliceFromSnap(beforeSnap);
    const afterState = sliceFromSnap(afterSnap);

    await context.tracing.stop({ path: tracePath });
    await context.close();

    // Diagnostic: easy-to-read failure if Phase 1's compileContract didn't
    // route through Next.js 16 + next-auth's surface.
    expect(afterState.url).toMatch(/^\/login/);

    const attached: Array<{ name: string; path: string; contentType: string }> = [];
    const verdict = await runOracle({
      contract: inv!,
      before: beforeState,
      after: afterState,
      noise,
      missingCapabilities: [],
      attach: (a) => attached.push(a),
      tmpDir: scratchDir,
    });
    expect(verdict.verdict).toBe('PASS');

    // Persist a bundle for offline inspection (proof of real-Next-16 run).
    const beforeSnapPath = path.join(scratchDir, 'snapshot-before.json');
    const afterSnapPath = path.join(scratchDir, 'snapshot-after.json');
    await writeFile(beforeSnapPath, JSON.stringify(beforeSnap, null, 2));
    await writeFile(afterSnapPath, JSON.stringify(afterSnap, null, 2));

    const runId = `dogfood_website-vercel-supabase_${Date.now()}_INV-N1`;
    const files: Record<string, Buffer> = {
      'trace.zip': await readFile(tracePath),
      'screenshots/0001.png': await readFile(afterShot),
      'network/network.har': await readFile(harPath),
      'snapshots/before.json': await readFile(beforeSnapPath),
      'snapshots/after.json': await readFile(afterSnapPath),
      'diffs/state-diff.json': await readFile(attached[0]!.path),
    };
    await writeEvidenceBundle({
      runId,
      contractId: inv!.id,
      artifactsRoot,
      files,
      redactionApplied: true,
    });

    const runDir = path.join(artifactsRoot, 'runs', runId);
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    expect(manifest.contract_id).toBe('INV-N1');
    expect(manifest.files.length).toBe(6);
  });
});
