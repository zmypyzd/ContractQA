// Dogfood test #4 — 5-4-claude (Vite + React + @supabase/supabase-js).
// Without real Supabase credentials we can't drive the actual signIn flow;
// the contract is render-only. Proves Phase 1's SupabaseAuthAdapter would
// be invocable on a non-Next.js host (supabase-js is framework-agnostic).
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
const TARGET_ROOT = '/Users/zmy/intership/5/5-4-claude';
const PORT = Number(process.env.DOGFOOD_5_4_CLAUDE_PORT ?? '5391');
const BASE = `http://127.0.0.1:${PORT}`;

let web: ChildProcess | undefined;
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
  web = spawn(
    'pnpm',
    ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      cwd: TARGET_ROOT,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: 'http://localhost:1',
        VITE_SUPABASE_ANON_KEY: 'stub-anon-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  web.stderr?.on('data', (d) => process.stderr.write(`[5-4-claude] ${d}`));

  await pollUntil(`${BASE}/login`, 120_000, '5-4-claude /login');

  browser = await chromium.launch();
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-claude-'));
  artifactsRoot = path.join(scratchDir, 'artifacts');
}, 180_000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
  if (web && !web.killed) {
    web.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 300));
    if (!web.killed) web.kill('SIGKILL');
  }
  await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('ContractQA dogfood — 5-4-claude (Vite + React + Supabase, stub env)', () => {
  it('INV-S1: login page renders without Supabase auth-token-error leak', async () => {
    const contracts = await loadContractsFromDir(path.join(__dir, 'contracts'));
    const inv = contracts.find((c) => c.id === 'INV-S1');
    expect(inv, 'INV-S1 must load').toBeTruthy();

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
  });
});
