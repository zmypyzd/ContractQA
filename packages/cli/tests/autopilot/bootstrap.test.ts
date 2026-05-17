// packages/cli/tests/autopilot/bootstrap.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { assembleTargetContext } from '../../src/autopilot/bootstrap.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cqa-bootstrap-'));
  execSync('git init -q', { cwd: tmp });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('assembleTargetContext', () => {
  it('throws when not in a git repo', async () => {
    const noGit = mkdtempSync(join(tmpdir(), 'cqa-nogit-'));
    try {
      await expect(assembleTargetContext(noGit)).rejects.toThrow(/not a git repository/i);
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });

  it('throws when no package.json', async () => {
    await expect(assembleTargetContext(tmp)).rejects.toThrow(/package\.json/i);
  });

  it('detects Next.js + Supabase from package.json + .env', async () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'demo',
      dependencies: { next: '^15.0.0', '@supabase/supabase-js': '^2.0.0' },
    }));
    mkdirSync(join(tmp, 'app'));
    // Add a file inside app/ so detectFramework sees app/ directory
    writeFileSync(join(tmp, 'app', 'page.tsx'), 'export default function Home() { return null; }');
    writeFileSync(join(tmp, '.env.local'), 'SUPABASE_TEST_EMAIL=test@x\nSUPABASE_TEST_PASSWORD=pw\n');
    const ctx = await assembleTargetContext(tmp);
    // The actual Framework type uses 'next-app' for Next.js app-dir projects
    expect(ctx.framework).toBe('next-app');
    expect(ctx.authProvider).toBe('supabase');
    expect(ctx.testCredentials).toMatchObject({ source: 'env', email: 'test@x' });
  });
});
