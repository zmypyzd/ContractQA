import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadContractsFromDir, compileContract, runOracle, ContractQAReporter } from '@contractqa/runner';
import type { CompiledPage } from '@contractqa/runner';
import { snapshotBrowser } from '@contractqa/probes';
import { generateRepro } from '@contractqa/repro';
import { runShadowFix } from '@contractqa/orchestrator';
import type { StateSlice } from '@contractqa/oracle';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PORT = Number(process.env.CONTRACTQA_FIXTURE_PORT ?? '4127');
const FIXTURE_BASE = `http://localhost:${FIXTURE_PORT}`;

let server: ChildProcess | undefined;
let browser: Browser;
let scratchDir: string;
let artifactsRoot: string;

async function waitForHealth(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`fixture-app /api/health never came up: ${String(lastErr)}`);
}

beforeAll(async () => {
  server = spawn(
    'pnpm',
    ['--filter', '@contractqa/fixture-app', 'exec', 'next', 'dev', '-p', String(FIXTURE_PORT)],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stderr?.on('data', (d) => process.stderr.write(`[fixture-app] ${d}`));

  await waitForHealth(FIXTURE_BASE, 90_000);
  // warm /login so the first real-test goto doesn't pay the dev-compile cost inside the test timeout
  await fetch(`${FIXTURE_BASE}/login`).catch(() => undefined);
  await fetch(`${FIXTURE_BASE}/lobby`).catch(() => undefined);
  await fetch(`${FIXTURE_BASE}/agents`).catch(() => undefined);

  browser = await chromium.launch();
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'cqa-e2e-'));
  artifactsRoot = path.join(scratchDir, 'artifacts');
}, 120_000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
  if (server && !server.killed) {
    server.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 250));
    if (!server.killed) server.kill('SIGKILL');
  }
  await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('Phase 1 end-to-end loop (real Playwright vs fixture-app)', () => {
  it('YAML → real browser → oracle FAIL → reporter writes bundle → shadow fix', async () => {
    const repoQa = path.join(REPO_ROOT, 'qa', 'contracts');
    const contracts = await loadContractsFromDir(repoQa);
    const inv = contracts.find((c) => c.id === 'INV-A2');
    expect(inv, 'INV-A2 contract must exist').toBeTruthy();

    const noise = parse(await readFile(path.join(REPO_ROOT, 'qa', 'noise-profile.yml'), 'utf8'));

    const tracePath = path.join(scratchDir, 'trace.zip');
    const harPath = path.join(scratchDir, 'network.har');
    const beforeShotPath = path.join(scratchDir, 'before.png');
    const afterShotPath = path.join(scratchDir, 'after.png');

    const context: BrowserContext = await browser.newContext({
      baseURL: FIXTURE_BASE,
      viewport: { width: 1280, height: 720 },
      recordHar: { path: harPath, mode: 'minimal' },
    });
    await context.tracing.start({ snapshots: true, screenshots: true, sources: false });
    const page: Page = await context.newPage();

    // Log in via the real form so sb-* lands in localStorage (precondition: auth_state=logged_in).
    await page.goto('/login');
    await page.getByLabel('email').fill('alice@example.com');
    await page.getByLabel('password').fill('hunter2');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/lobby$/);

    // Capture rich BEFORE snapshot via the real probe.
    const beforeSnap = await snapshotBrowser(page as unknown as Parameters<typeof snapshotBrowser>[0], {
      screenshotPath: beforeShotPath,
    });

    const stripBase = (u: string): string => {
      if (u.startsWith(FIXTURE_BASE)) return u.slice(FIXTURE_BASE.length) || '/';
      return u;
    };
    const sliceFromSnap = (snap: typeof beforeSnap): StateSlice => ({
      url: stripBase(snap.url),
      localStorageKeys: Object.keys(snap.localStorage),
      cookies: snap.cookies.map((c) => c.name),
    });

    // Drive the contract through real Playwright.
    const compiled = compileContract(inv!);
    await compiled({
      page: page as unknown as CompiledPage,
      snapshot: async () => ({
        url: stripBase(page.url()),
        localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
        cookies: (await context.cookies()).map((c) => c.name),
      }),
    });

    // Capture rich AFTER snapshot via the real probe.
    const afterSnap = await snapshotBrowser(page as unknown as Parameters<typeof snapshotBrowser>[0], {
      screenshotPath: afterShotPath,
    });
    const beforeState = sliceFromSnap(beforeSnap);
    const afterState = sliceFromSnap(afterSnap);

    // Stop trace + close context so HAR is flushed to disk before the reporter reads it.
    await context.tracing.stop({ path: tracePath });
    await context.close();

    // §24 bug must reproduce: logout left sb-* behind, and url didn't reach ^/login.
    expect(afterState.url).toBe('/agents');
    expect(afterState.localStorageKeys).toContain('sb-fixture-auth-token');

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
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.violations.some((v) => v.message.includes('url'))).toBe(true);
    expect(verdict.violations.some((v) => v.message.includes('localStorage'))).toBe(true);

    // Write the BrowserSnapshot blobs the reporter will attach.
    const beforeSnapPath = path.join(scratchDir, 'snapshot-before.json');
    const afterSnapPath = path.join(scratchDir, 'snapshot-after.json');
    await writeFile(beforeSnapPath, JSON.stringify(beforeSnap, null, 2));
    await writeFile(afterSnapPath, JSON.stringify(afterSnap, null, 2));

    // Drive the real ContractQAReporter with a minimal Playwright-shaped TestCase+TestResult
    // built from artifacts produced by the real browser session above.
    const reporterAttachments = [
      ...oracleAttachments,
      { name: 'evidence:trace', path: tracePath, contentType: 'application/zip' },
      { name: 'evidence:screenshot', path: afterShotPath, contentType: 'image/png' },
      { name: 'evidence:network', path: harPath, contentType: 'application/json' },
      { name: 'evidence:snapshot-before', path: beforeSnapPath, contentType: 'application/json' },
      { name: 'evidence:snapshot-after', path: afterSnapPath, contentType: 'application/json' },
    ];

    const reporter = new ContractQAReporter({ artifactsRoot });
    // Minimal TestCase + TestResult shapes — the reporter only reads .title, .status, .attachments.
    const fakeTest = { title: `${inv!.id}: ${inv!.title}` } as unknown as Parameters<
      ContractQAReporter['onTestEnd']
    >[0];
    const fakeResult = {
      status: 'failed',
      attachments: reporterAttachments,
    } as unknown as Parameters<ContractQAReporter['onTestEnd']>[1];
    await reporter.onTestEnd(fakeTest, fakeResult);

    // Locate the run directory (reporter names it `<timestamp>_<contractId>`).
    const runsRoot = path.join(artifactsRoot, 'runs');
    const runDirs = await readdir(runsRoot);
    expect(runDirs.length).toBe(1);
    const runDir = path.join(runsRoot, runDirs[0]!);

    // Every artifact the handoff demands exists, is non-empty, and is bundled.
    const traceStat = await stat(path.join(runDir, 'trace.zip'));
    expect(traceStat.size).toBeGreaterThan(0);
    const shotStat = await stat(path.join(runDir, 'screenshots', '0001.png'));
    expect(shotStat.size).toBeGreaterThan(0);
    const harStat = await stat(path.join(runDir, 'network', 'network.har'));
    expect(harStat.size).toBeGreaterThan(0);
    await stat(path.join(runDir, 'diffs', 'state-diff.json'));
    await stat(path.join(runDir, 'snapshots', 'before.json'));
    await stat(path.join(runDir, 'snapshots', 'after.json'));
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    expect(manifest.contract_id).toBe('INV-A2');
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

    // Repro generator still produces a Playwright spec against the contract.
    const reproSrc = generateRepro({ contract: inv!, authProvider: 'supabase' });
    expect(reproSrc).toContain("test('INV-A2:");
    expect(reproSrc).toContain('await expect(page).toHaveURL(/^\\/login/);');

    // Shadow-fix pipeline (mocked claude) closes the loop against the REAL bundle dir.
    const shadowResult = await runShadowFix({
      issueId: 'AUTH-LOGOUT-001',
      bundlePath: runDir,
      baseBranch: 'main',
      repoRoot: REPO_ROOT,
      worktreeRoot: path.join(scratchDir, 'wt'),
      maxAttempts: 1,
      createWorktree: async () => ({
        path: scratchDir,
        branch: 'cqa-fix/AUTH-LOGOUT-001',
        remove: async () => undefined,
      }),
      runClaude: async () => ({
        validation_result: 'PASS',
        files_changed: ['apps/fixture-app/app/lobby/page.tsx'],
        raw_stdout: '{"root_cause":"logout missed sb-* cleanup and redirect"}',
      }),
      openFixPR: async () => ({ url: 'https://example.com/pr/42' }),
      writePromptFile: async (_b, dest) => {
        await writeFile(dest, '# fix prompt');
        return dest;
      },
    });
    expect(shadowResult.outcome).toBe('SUCCESS');
    expect(shadowResult.prUrl).toBe('https://example.com/pr/42');
  });

  it('INVARIANTS.md generator round-trips contract IDs', async () => {
    const { renderInvariantsMd } = await import('contractqa');
    const contracts = await loadContractsFromDir(path.join(REPO_ROOT, 'qa', 'contracts'));
    const md = renderInvariantsMd(contracts);
    expect(md).toContain('INV-A2');
    expect(md).toContain('Logged-out users cannot access protected routes');
  });
});
