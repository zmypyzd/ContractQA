import { describe, it, expect } from 'vitest';
import { detectRequiredEnv } from '../../src/lib/env-detect.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'envdetect-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

describe('detectRequiredEnv', () => {
  it('parses .env.example into required vars', async () => {
    const dir = fixture({ '.env.example': 'NEXT_PUBLIC_SUPABASE_URL=\nAUTH_SECRET=changeme' });
    const out = await detectRequiredEnv(dir);
    expect(out.map((v) => v.name).sort()).toEqual(['AUTH_SECRET', 'NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('extracts $VAR from package.json dev script', async () => {
    const dir = fixture({
      'package.json': JSON.stringify({ scripts: { dev: 'PORT=${PORT:-3000} next dev' } }),
    });
    const out = await detectRequiredEnv(dir);
    expect(out.map((v) => v.name)).toContain('PORT');
  });

  it('produces a stub of at least 32 chars for *_SECRET', async () => {
    const dir = fixture({ '.env.example': 'AUTH_SECRET=' });
    const out = await detectRequiredEnv(dir);
    const stub = out.find((v) => v.name === 'AUTH_SECRET')!.suggestedStub;
    expect(stub.length).toBeGreaterThanOrEqual(32);
  });

  it('returns [] for an empty repo', async () => {
    const dir = fixture({});
    const out = await detectRequiredEnv(dir);
    expect(out).toEqual([]);
  });
});
