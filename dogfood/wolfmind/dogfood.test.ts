// Dogfood test #3 — WolfMind (Vue 3 + Vite + FastAPI). The backend is
// intentionally NOT booted: WolfMind needs LLM API keys (openai, dashscope)
// to actually run a game session, and we only want to dogfood the rendering
// surface. Phase 1's compileContract should drive a Vue 3 SPA the same way
// it drives React.
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
const TARGET = '/Users/zmy/intership/5/WolfMind-main/frontend';
const PORT = Number(process.env.DOGFOOD_WOLFMIND_PORT ?? '5587');
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
  // Vite 5 won't answer 127.0.0.1 without explicit --host. (Finding #6
  // from dogfood/5-4-codex/FINDINGS.md applies here too — same default,
  // different repo.)
  web = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      cwd: TARGET,
      env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:1', VITE_WS_URL: 'ws://127.0.0.1:1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  web.stderr?.on('data', (d) => process.stderr.write(`[wolfmind] ${d}`));

  await pollUntil(`${BASE}/`, 120_000, 'wolfmind vite /');

  browser = await chromium.launch();
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-dogfood-wolfmind-'));
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

describe('ContractQA dogfood — WolfMind (Vue 3 + Vite, no auth)', () => {
  it('INV-W1: anonymous landing page exposes no auth-shaped tokens', async () => {
    const contracts = await loadContractsFromDir(path.join(__dir, 'contracts'));
    const inv = contracts.find((c) => c.id === 'INV-W1');
    expect(inv, 'INV-W1 must load').toBeTruthy();

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

    // Pre-navigate so snapshotBrowser has a real origin to read storage from.
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
    expect(result.after.url).toBe('/');
    expect(result.bundleDir).toBeTruthy();

    const manifest = JSON.parse(
      await readFile(path.join(result.bundleDir!, 'manifest.json'), 'utf8'),
    );
    expect(manifest.contract_id).toBe('INV-W1');
    expect(manifest.files.length).toBe(6);
  });
});
