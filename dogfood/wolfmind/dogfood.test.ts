// Dogfood test #3 — WolfMind (Vue 3 + Vite + FastAPI). The backend is
// intentionally NOT booted: WolfMind needs LLM API keys (openai, dashscope)
// to actually run a game session, and we only want to dogfood the rendering
// surface. Phase 1's compileContract should drive a Vue 3 SPA the same way
// it drives React.
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
    // (Finding #2 from dogfood/website-vercel-supabase/FINDINGS.md.)
    await page.goto('/');

    const beforeSnap = await snapshotBrowser(
      page as unknown as Parameters<typeof snapshotBrowser>[0],
      { screenshotPath: beforeShot },
    );

    const stripBase = (u: string): string => {
      if (u.startsWith(BASE)) return u.slice(BASE.length) || '/';
      return u;
    };
    const sliceFromSnap = (snap: typeof beforeSnap): StateSlice => ({
      url: stripBase(snap.url),
      localStorageKeys: Object.keys(snap.localStorage),
      cookies: snap.cookies.map((c) => c.name),
    });

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

    expect(afterState.url).toBe('/');

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

    // Bundle for evidence.
    const beforeSnapPath = path.join(scratchDir, 'snapshot-before.json');
    const afterSnapPath = path.join(scratchDir, 'snapshot-after.json');
    await writeFile(beforeSnapPath, JSON.stringify(beforeSnap, null, 2));
    await writeFile(afterSnapPath, JSON.stringify(afterSnap, null, 2));

    const runId = `dogfood_wolfmind_${Date.now()}_INV-W1`;
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

    const manifest = JSON.parse(
      await readFile(path.join(artifactsRoot, 'runs', runId, 'manifest.json'), 'utf8'),
    );
    expect(manifest.contract_id).toBe('INV-W1');
    expect(manifest.files.length).toBe(6);
  });
});
