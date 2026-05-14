import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

describe('doctor --fix native-deps', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-fix-')); });

  it('is a no-op when no native deps detected', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }));
    const report = await doctor({ targetRoot: tmp, skipBootProbe: true, fix: ['native-deps'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/no native deps/i);
  });

  it('attempts npm rebuild when better-sqlite3 is present', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { 'better-sqlite3': '^11' },
    }));
    const report = await doctor({ targetRoot: tmp, skipBootProbe: true, fix: ['native-deps'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    expect(fix!.detail).toContain('npm rebuild');
    // ok could be true or false depending on whether npm rebuild succeeds in a tmpdir without node_modules — we just verify the command was attempted.
  }, 60_000);

  it('handles missing package.json gracefully', async () => {
    const report = await doctor({ targetRoot: tmp, skipBootProbe: true, fix: ['native-deps'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/no native deps/i);
  });
});
