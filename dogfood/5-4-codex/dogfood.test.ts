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
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  loadContractsFromDir,
  compileContract,
  runOracle,
  ContractQAReporter,
} from '@contractqa/runner';
import type { CompiledPage } from '@contractqa/runner';
import { snapshotBrowser } from '@contractqa/probes';
import type { StateSlice } from '@contractqa/oracle';

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

    // Capture rich BEFORE snapshot via the real probe.
    const beforeSnap = await snapshotBrowser(
      page as unknown as Parameters<typeof snapshotBrowser>[0],
      { screenshotPath: beforeShot },
    );

    const stripBase = (u: string): string => {
      if (u.startsWith(WEB_BASE)) return u.slice(WEB_BASE.length) || '/';
      return u;
    };
    const sliceFromSnap = (snap: typeof beforeSnap): StateSlice => ({
      url: stripBase(snap.url),
      localStorageKeys: Object.keys(snap.localStorage),
      cookies: snap.cookies.map((c) => c.name),
    });

    // Drive INV-L1 through real Playwright via the production compileContract.
    const compiled = compileContract(inv!);
    await compiled({
      page: page as unknown as CompiledPage,
      snapshot: async () => ({
        url: stripBase(page.url()),
        localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
        cookies: (await context.cookies()).map((c) => c.name),
      }),
    });

    // Capture AFTER. The url should end up under /login (ProtectedRoute
    // redirects when /auth/me returns 401 after the cookie is cleared).
    const afterSnap = await snapshotBrowser(
      page as unknown as Parameters<typeof snapshotBrowser>[0],
      { screenshotPath: afterShot },
    );
    const beforeState = sliceFromSnap(beforeSnap);
    const afterState = sliceFromSnap(afterSnap);

    await context.tracing.stop({ path: tracePath });
    await context.close();

    // Diagnostic assertions so a failed verdict is easy to read.
    expect(afterState.url).toMatch(/^\/login/);
    expect(afterState.cookies).not.toContain('apk_sid');

    const oracleAttachments: Array<{ name: string; path: string; contentType: string }> = [];
    const verdict = await runOracle({
      contract: inv!,
      before: beforeState,
      after: afterState,
      noise,
      missingCapabilities: [],
      attach: (a) => oracleAttachments.push(a),
      tmpDir: scratchDir,
    });

    // The agent-poker-platform implementation is CORRECT — we expect PASS,
    // proving ContractQA's pipeline runs end-to-end on a Vite/cookie stack.
    expect(verdict.verdict).toBe('PASS');

    // Write the snapshot blobs and drive the real reporter (even on PASS we
    // want a bundle for offline inspection of the dogfood run).
    const beforeSnapPath = path.join(scratchDir, 'snapshot-before.json');
    const afterSnapPath = path.join(scratchDir, 'snapshot-after.json');
    await writeFile(beforeSnapPath, JSON.stringify(beforeSnap, null, 2));
    await writeFile(afterSnapPath, JSON.stringify(afterSnap, null, 2));

    // The reporter early-returns on non-failed status, so for a PASS dogfood
    // we just write the bundle directly via the @contractqa/evidence path.
    const { writeEvidenceBundle } = await import('@contractqa/evidence');
    const runId = `dogfood_5-4-codex_${stamp}_INV-L1`;
    const files: Record<string, Buffer> = {
      'trace.zip': await readFile(tracePath),
      'screenshots/0001.png': await readFile(afterShot),
      'network/network.har': await readFile(harPath),
      'snapshots/before.json': await readFile(beforeSnapPath),
      'snapshots/after.json': await readFile(afterSnapPath),
      'diffs/state-diff.json': await readFile(oracleAttachments[0]!.path),
    };
    await writeEvidenceBundle({
      runId,
      contractId: inv!.id,
      artifactsRoot,
      files,
      redactionApplied: true,
    });

    const runDir = path.join(artifactsRoot, 'runs', runId);
    const harStat = await stat(path.join(runDir, 'network', 'network.har'));
    expect(harStat.size).toBeGreaterThan(0);
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
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

    // Also exercise the reporter's failure path on a synthetic FAIL so the
    // dogfood proves the FAIL → bundle pipe works against this stack — not
    // just the happy PASS path. We craft a deliberate violation by giving the
    // oracle an afterState that still has apk_sid.
    const synthFailAfter: StateSlice = { ...afterState, cookies: ['apk_sid', ...afterState.cookies.filter(c => c !== 'apk_sid')] };
    const synthAttached: Array<{ name: string; path: string; contentType: string }> = [];
    const synthVerdict = await runOracle({
      contract: inv!,
      before: beforeState,
      after: synthFailAfter,
      noise,
      missingCapabilities: [],
      attach: (a) => synthAttached.push(a),
      tmpDir: scratchDir,
    });
    expect(synthVerdict.verdict).toBe('FAIL');
    expect(synthVerdict.violations.some((v) => v.message.includes('cookies'))).toBe(true);

    const reporter = new ContractQAReporter({ artifactsRoot });
    const fakeTest = { title: `${inv!.id}: synthetic FAIL for reporter coverage` } as unknown as Parameters<
      ContractQAReporter['onTestEnd']
    >[0];
    const fakeResult = {
      status: 'failed',
      attachments: [
        ...synthAttached,
        { name: 'evidence:trace', path: tracePath, contentType: 'application/zip' },
        { name: 'evidence:screenshot', path: afterShot, contentType: 'image/png' },
        { name: 'evidence:network', path: harPath, contentType: 'application/json' },
      ],
    } as unknown as Parameters<ContractQAReporter['onTestEnd']>[1];
    await reporter.onTestEnd(fakeTest, fakeResult);

    const runs = await readdir(path.join(artifactsRoot, 'runs'));
    // 1 PASS dogfood bundle + 1 synthetic FAIL bundle from the reporter
    expect(runs.length).toBe(2);
  });
});
