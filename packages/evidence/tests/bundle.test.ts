import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeEvidenceBundle } from '../src/bundle.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeEvidenceBundle', () => {
  it('creates §11.1 directory structure', async () => {
    const bundle = await writeEvidenceBundle({
      runId: '2026-05-14T10-20-31Z_auth_logout',
      contractId: 'INV-A2',
      artifactsRoot: dir,
      files: {
        'issue.json': Buffer.from('{}'),
        'repro.spec.ts': Buffer.from('// repro'),
        'trace.zip': Buffer.from('PK\x03\x04'),
        'screenshots/001-before-login.png': Buffer.from('PNG'),
        'snapshots/001-before.json': Buffer.from('{}'),
        'diffs/state-diff.json': Buffer.from('{}'),
        'network/network.har': Buffer.from('{}'),
        'console/console.log': Buffer.from(''),
      },
    });
    const runDir = path.join(dir, 'runs', '2026-05-14T10-20-31Z_auth_logout');
    const entries = await readdir(runDir);
    expect(entries).toContain('issue.json');
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('repro.spec.ts');
    expect(entries).toContain('screenshots');
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    expect(manifest.files).toBeInstanceOf(Array);
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.bundle_id).toBe(bundle.bundle_id);
  });

  it('writes redaction_applied flag', async () => {
    const b = await writeEvidenceBundle({
      runId: 'r1',
      contractId: 'INV-A1',
      artifactsRoot: dir,
      files: {},
      redactionApplied: true,
    });
    expect(b.redaction_applied).toBe(true);
  });
});
