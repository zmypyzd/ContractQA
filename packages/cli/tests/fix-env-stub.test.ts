import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

describe('doctor --fix env-stub', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-env-')); });

  it('writes .env.local from .env.example when missing', async () => {
    await writeFile(path.join(tmp, '.env.example'), 'DATABASE_URL=postgres://example\nNEXTAUTH_SECRET=changeme\n');
    const report = await doctor({ targetRoot: tmp, fix: ['env-stub'], skipBootProbe: true });
    const fix = report.fixesAttempted.find((f) => f.name === 'env-stub');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/written from \.env\.example/);
    const written = await readFile(path.join(tmp, '.env.local'), 'utf8');
    expect(written).toContain('DATABASE_URL=postgres://example');
    expect(written).toContain('NEXTAUTH_SECRET=changeme');
  });

  it('skips when .env.local already exists', async () => {
    await writeFile(path.join(tmp, '.env.example'), 'DATABASE_URL=postgres://example\n');
    await writeFile(path.join(tmp, '.env.local'), 'DATABASE_URL=actual-value\n');
    const report = await doctor({ targetRoot: tmp, fix: ['env-stub'], skipBootProbe: true });
    const fix = report.fixesAttempted.find((f) => f.name === 'env-stub');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/already exists/);
    // Verify the existing file was NOT overwritten
    const preserved = await readFile(path.join(tmp, '.env.local'), 'utf8');
    expect(preserved).toBe('DATABASE_URL=actual-value\n');
  });

  it('skips when no .env.example present', async () => {
    const report = await doctor({ targetRoot: tmp, fix: ['env-stub'], skipBootProbe: true });
    const fix = report.fixesAttempted.find((f) => f.name === 'env-stub');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/no \.env\.example/);
  });
});
