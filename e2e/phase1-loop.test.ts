import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { loadContractsFromDir, compileContract, runOracle } from '@contractqa/runner';
import { generateRepro } from '@contractqa/repro';
import { runShadowFix } from '@contractqa/orchestrator';
import { writeEvidenceBundle } from '@contractqa/evidence';
import { parse } from 'yaml';

let dir: string;
let artifactsDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-e2e-'));
  artifactsDir = path.join(dir, 'artifacts');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Phase 1 end-to-end loop (no Playwright/browser, no Supabase)', () => {
  it('YAML contract → oracle FAIL → evidence bundle → repro → shadow fix → fix-PR', async () => {
    // 1. Load the §24 Logout contract from qa/contracts
    const repoQa = path.join(REPO_ROOT, 'qa', 'contracts');
    const contracts = await loadContractsFromDir(repoQa);
    const inv = contracts.find((c) => c.id === 'INV-A2');
    expect(inv).toBeTruthy();

    // 2. Compile contract; simulate the §24 bug: after logout, url didn't change
    //    AND sb-* token survived in localStorage.
    const noise = parse(
      await readFile(path.join(REPO_ROOT, 'qa', 'noise-profile.yml'), 'utf8'),
    );
    const before = {
      url: '/lobby',
      localStorageKeys: ['sb-fixture-auth-token', 'theme'],
      cookies: [],
    };
    const after = {
      url: '/agents',
      localStorageKeys: ['sb-fixture-auth-token', 'theme'],
      cookies: [],
    };

    // 3. Oracle classifies as FAIL with state-diff attachment.
    const attached: Array<{ name: string; path: string; contentType: string }> = [];
    const verdict = await runOracle({
      contract: inv!,
      before,
      after,
      noise,
      missingCapabilities: [],
      attach: (a) => attached.push(a),
      tmpDir: dir,
    });
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.violations.some((v) => v.message.includes('url'))).toBe(true);
    expect(verdict.violations.some((v) => v.message.includes('localStorage'))).toBe(true);
    expect(attached.find((a) => a.name === 'evidence:state-diff')).toBeTruthy();

    // 4. Evidence bundle gets written to artifactsDir.
    const bundle = await writeEvidenceBundle({
      runId: 'phase1_loop_test',
      contractId: 'INV-A2',
      artifactsRoot: artifactsDir,
      files: {
        'diffs/state-diff.json': await readFile(attached[0]!.path),
      },
    });
    expect(bundle.run_id).toBe('phase1_loop_test');
    await stat(path.join(artifactsDir, 'runs', 'phase1_loop_test', 'manifest.json'));
    await stat(path.join(artifactsDir, 'runs', 'phase1_loop_test', 'diffs', 'state-diff.json'));

    // 5. Repro generator emits a Playwright spec asserting the invariant
    //    (not the buggy actual).
    const reproSrc = generateRepro({ contract: inv!, authProvider: 'supabase' });
    expect(reproSrc).toContain("test('INV-A2:");
    expect(reproSrc).toContain('await expect(page).toHaveURL(/^\\/login/);');
    expect(reproSrc).toContain('SupabaseAuthAdapter');

    // 6. Shadow fix pipeline (mocked claude) completes the loop end-to-end.
    const shadowResult = await runShadowFix({
      issueId: 'AUTH-LOGOUT-001',
      bundlePath: path.join(artifactsDir, 'runs', 'phase1_loop_test'),
      baseBranch: 'main',
      repoRoot: REPO_ROOT,
      worktreeRoot: path.join(dir, 'wt'),
      maxAttempts: 1,
      createWorktree: async () => ({
        path: dir,
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
        const { writeFile } = await import('node:fs/promises');
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
