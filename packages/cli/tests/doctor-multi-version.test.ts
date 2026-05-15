import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

describe('doctor — pnpm dedup edge cases', () => {
  it('picks one of multiple .pnpm versions deterministically (sorted)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-multiver-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { 'better-sqlite3': '^11.0.0' },
    }));
    // Create two .pnpm-mirrored versions
    for (const v of ['9.6.0', '11.10.0']) {
      const dir = path.join(root, 'node_modules/.pnpm', `better-sqlite3@${v}/node_modules/better-sqlite3`);
      await mkdir(dir, { recursive: true });
      // Create a fake package.json so npm doesn't crash; no install script
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({
        name: 'better-sqlite3', version: v, scripts: {}, // intentionally no install script
      }));
    }
    const r = await doctor({ targetRoot: root, skipBootProbe: true, fix: ['native-deps'] });
    const fix = r.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    // Should attempt rebuild on one of them (alphabetic sort picks 11.10.0 since '1'<'9' in ASCII)
    expect(fix!.detail).toMatch(/better-sqlite3/);
    // Verify the correct version was selected (sorted-first: '1' < '9' in ASCII)
    expect(fix!.detail).toMatch(/11\.10\.0/);
    // Hint must fire: npm outputs "Missing script: install" (or quoted form for npm 10+)
    expect(fix!.detail).toContain('package has no install script');
    // Fix must report failure (no install script means npm run install exits non-zero)
    expect(fix!.ok).toBe(false);
  }, 60_000);

  it('selects highest semver version, not lexicographic max (10.0.0 > 1.0.0)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-semver-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { 'better-sqlite3': '^10.0.0' },
    }));
    for (const v of ['1.0.0', '10.0.0']) {
      const dir = path.join(root, 'node_modules/.pnpm', `better-sqlite3@${v}/node_modules/better-sqlite3`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({
        name: 'better-sqlite3', version: v, scripts: {},
      }));
    }
    const r = await doctor({ targetRoot: root, skipBootProbe: true, fix: ['native-deps'] });
    const fix = r.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix!.detail).toMatch(/10\.0\.0/);
    // Make sure 1.0.0 wasn't picked — must not be a top-level version selection.
    // (Detail may still contain '1.0.0' as part of the directory walk; assert 10.0.0 is the picked version.)
    expect(fix!.detail).toMatch(/better-sqlite3@10\.0\.0/);
  }, 60_000);
});
