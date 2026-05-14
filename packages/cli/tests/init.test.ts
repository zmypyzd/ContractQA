import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from '../src/commands/init.js';

describe('initProject', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-init-'));
  });

  it('auto-detects Vite + React and writes scaffold', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'tiny-vite',
      dependencies: { vite: '^5', react: '^18' },
    }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');

    const report = await initProject({ cwd: tmp, yes: true });
    expect(report.detected.framework).toBe('vite-react');
    expect(report.framework).toBe('vite-react');
    const cfg = await readFile(path.join(tmp, 'contractqa.config.ts'), 'utf8');
    expect(cfg).toContain('baseUrl');
    expect(report.filesWritten).toContain('contractqa.config.ts');
  });

  it('refuses to overwrite without --force', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { vite: '^5', react: '^18' },
    }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');
    await mkdir(path.join(tmp, 'qa'), { recursive: true });
    await writeFile(path.join(tmp, 'qa', 'INVARIANTS.md'), 'existing content');
    await expect(initProject({ cwd: tmp, yes: true })).rejects.toThrow(/already exists/);
  });

  it('overwrites with --force', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { vite: '^5', react: '^18' },
    }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');
    await mkdir(path.join(tmp, 'qa'), { recursive: true });
    await writeFile(path.join(tmp, 'qa', 'INVARIANTS.md'), 'existing content');
    const report = await initProject({ cwd: tmp, yes: true, force: true });
    expect(report.framework).toBeDefined();
    const overwritten = await readFile(path.join(tmp, 'qa', 'INVARIANTS.md'), 'utf8');
    expect(overwritten).toContain('Product Invariants');
  });

  it('respects --framework override', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { vite: '^5', react: '^18' },
    }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');
    const report = await initProject({ cwd: tmp, yes: true, framework: 'astro' });
    expect(report.detected.framework).toBe('vite-react'); // detection still ran
    expect(report.framework).toBe('astro');              // but override won
    const cfg = await readFile(path.join(tmp, 'contractqa.config.ts'), 'utf8');
    expect(cfg).toContain('http://localhost:4321'); // astro baseUrl
  });
});
