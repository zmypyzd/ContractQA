// Dogfood test #5 — agent-poker-platform-gpt (Vite + React + custom-cookie).
// Same problem space as 5-4-codex but built by a different LLM author —
// surfaces whether nominally identical projects produce identical
// framework footprints.
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
const TARGET_REPO = '/Users/zmy/intership/4/agent-poker-platform -gpt';
const API_PORT = Number(process.env.DOGFOOD_APP_API_PORT ?? '3487');
const WEB_PORT = Number(process.env.DOGFOOD_APP_WEB_PORT ?? '5487');
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const API_BASE = `http://127.0.0.1:${API_PORT}`;

let api: ChildProcess | undefined;
let web: ChildProcess | undefined;
let browser: Browser;
let scratchDir: string;
let artifactsRoot: string;

async function pollUntil(
  url: string,
  pred: (r: Response) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (pred(r)) return;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} never ready at ${url}: ${String(lastErr)}`);
}

beforeAll(async () => {
  api = spawn('pnpm', ['--filter', 'api', 'run', 'dev'], {
    cwd: TARGET_REPO,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stderr?.on('data', (d) => process.stderr.write(`[gpt-api] ${d}`));

  web = spawn(
    'pnpm',
    [
      '--filter',
      'web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    {
      cwd: TARGET_REPO,
      env: { ...process.env, API_TARGET: API_BASE },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  web.stderr?.on('data', (d) => process.stderr.write(`[gpt-web] ${d}`));

  await Promise.all([
    pollUntil(`${API_BASE}/health`, (r) => r.ok, 120_000, 'api /health'),
    pollUntil(`${WEB_BASE}/`, (r) => r.ok, 120_000, 'web /'),
  ]);

  browser = await chromium.launch();
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-gpt-'));
  artifactsRoot = path.join(scratchDir, 'artifacts');
}, 180_000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
  for (const proc of [web, api]) {
    if (proc && !proc.killed) {
      proc.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 300));
      if (!proc.killed) proc.kill('SIGKILL');
    }
  }
  await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('ContractQA dogfood — agent-poker-platform-gpt (Vite + cookie auth)', () => {
  it('INV-L2: logout reaches /login and clears apk_sid', async () => {
    const contracts = await loadContractsFromDir(path.join(__dir, 'contracts'));
    const inv = contracts.find((c) => c.id === 'INV-L2');
    expect(inv, 'INV-L2 must load').toBeTruthy();

    const noise = parse(await readFile(path.join(__dir, 'noise-profile.yml'), 'utf8'));

    const tracePath = path.join(scratchDir, 'trace.zip');
    const harPath = path.join(scratchDir, 'network.har');
    const beforeShot = path.join(scratchDir, 'before.png');
    const afterShot = path.join(scratchDir, 'after.png');

    const context: BrowserContext = await browser.newContext({
      baseURL: WEB_BASE,
      viewport: { width: 1280, height: 720 },
      recordHar: { path: harPath, mode: 'minimal' },
    });
    await context.tracing.start({ snapshots: true, screenshots: true, sources: false });
    const page: Page = await context.newPage();

    // Register a fresh user via the real UI.
    const stamp = Date.now();
    await page.goto('/register');
    await page.getByLabel('Email').fill(`dogfood-${stamp}@contractqa.test`);
    await page.getByLabel('Display name').fill(`dogfood-${stamp}`);
    await page.getByLabel(/Password/).fill('hunter22pw');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/lobby$/);
    const preCookies = await context.cookies();
    expect(preCookies.some((c) => c.name === 'apk_sid')).toBe(true);

    const result = await runContract({
      contract: inv!,
      page: page as any,
      stripBaseUrl: WEB_BASE,
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
    expect(result.after.cookies).not.toContain('apk_sid');
    expect(result.bundleDir).toBeTruthy();
  });
});
