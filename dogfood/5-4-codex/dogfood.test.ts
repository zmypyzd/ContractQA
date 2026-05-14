// Dogfood test for ContractQA Phase 1 against the real agent-poker-platform
// repo (Vite + React + react-router-dom + custom cookie-session auth).
//
// This test is deliberately a SIDECAR: it lives inside qa-agent but boots
// agent-poker-platform from its checkout on disk. The point is to exercise
// the framework-agnostic part of ContractQA (contracts → compile → snapshot →
// oracle → bundle) against a stack that breaks every Next.js-specific
// assumption Phase 1 baked in. See FINDINGS.md for the running list.
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
const TARGET_REPO = '/Users/zmy/intership/5/5-4-codex';
const API_PORT = Number(process.env.DOGFOOD_API_PORT ?? '3287');
const WEB_PORT = Number(process.env.DOGFOOD_WEB_PORT ?? '5287');
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const API_BASE = `http://127.0.0.1:${API_PORT}`;

let api: ChildProcess | undefined;
let web: ChildProcess | undefined;
let browser: Browser;
let scratchDir: string;
let artifactsRoot: string;

async function pollUntil(url: string, predicate: (r: Response) => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (predicate(r)) return;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} never ready at ${url}: ${String(lastErr)}`);
}

beforeAll(async () => {
  // Boot API on an isolated port so we don't collide with the host's own e2e.
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
  api.stderr?.on('data', (d) => process.stderr.write(`[poker-api] ${d}`));

  // Boot Vite dev server on an isolated port, pointed at our API.
  // NOTE: `pnpm run dev -- --port N` mangles args through the host's pnpm
  // (`vite "--" "--port" ...`), so we invoke vite directly via `exec`.
  // Also: vite 5 binds to `localhost` only by default, which on this Node
  // build doesn't answer on 127.0.0.1 — force the IPv4 bind.
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
      env: {
        ...process.env,
        API_TARGET: API_BASE,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  web.stderr?.on('data', (d) => process.stderr.write(`[poker-web] ${d}`));

  await Promise.all([
    pollUntil(`${API_BASE}/health`, (r) => r.ok, 120_000, 'api /health'),
    pollUntil(`${WEB_BASE}/`, (r) => r.ok, 120_000, 'web /'),
  ]);

  browser = await chromium.launch();
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-'));
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

describe('ContractQA dogfood — agent-poker-platform (Vite + cookie auth)', () => {
  it('INV-L1: logout reaches /login and clears apk_sid', async () => {
    const contractsDir = path.join(__dir, 'contracts');
    const contracts = await loadContractsFromDir(contractsDir);
    const inv = contracts.find((c) => c.id === 'INV-L1');
    expect(inv, 'INV-L1 must load').toBeTruthy();

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

    // Precondition: a real fresh user. The target has no test-bypass — we
    // have to register through the UI to get a session cookie.
    const stamp = Date.now();
    const email = `dogfood-${stamp}@contractqa.test`;
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Display name').fill(`dogfood-${stamp}`);
    await page.getByLabel(/Password/).fill('hunter22pw');
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/lobby$/);

    // Sanity: apk_sid is now in the context.
    const preCookies = await context.cookies();
    expect(preCookies.some((c) => c.name === 'apk_sid')).toBe(true);

    // Drive INV-L1 through the standalone runner. Trace/HAR get flushed via
    // the hook so the bundle inside runContract can read the on-disk artifacts.
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

    // The agent-poker-platform implementation is CORRECT — we expect PASS,
    // proving ContractQA's pipeline runs end-to-end on a Vite/cookie stack.
    expect(result.verdict.verdict).toBe('PASS');
    expect(result.after.url).toMatch(/^\/login/);
    expect(result.after.cookies).not.toContain('apk_sid');
    expect(result.bundleDir).toBeTruthy();

    // The bundle contains every expected file.
    const manifest = JSON.parse(
      await readFile(path.join(result.bundleDir!, 'manifest.json'), 'utf8'),
    );
    expect(manifest.contract_id).toBe('INV-L1');
    expect(manifest.files.map((f: { path: string }) => f.path).sort()).toEqual(
      [
        'diffs/state-diff.json',
        'network/network.har',
        'screenshots/0001.png',
        'snapshots/after.json',
        'snapshots/before.json',
        'trace.zip',
      ].sort(),
    );
  });
});
