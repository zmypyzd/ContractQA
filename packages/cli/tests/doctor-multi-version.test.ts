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
  }, 60_000);
});
