import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/commands/init.js';

describe('init — monorepo target selection', () => {
  it('writes scaffold into apps/web/qa when target is auto-detected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-mono-'));
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    await writeFile(path.join(root, 'apps/web/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'apps/web/vite.config.ts'), '');

    const r = await initProject({ cwd: root, yes: true });
    expect(r.scaffoldRoot).toBe(path.join(root, 'apps/web'));
    expect((await stat(path.join(root, 'apps/web/qa'))).isDirectory()).toBe(true);
  });

  it('with target=apps/web, writes there even if root also detects', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-target-'));
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'vite.config.ts'), '');
    await writeFile(path.join(root, 'apps/web/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'apps/web/vite.config.ts'), '');

    const r = await initProject({ cwd: root, yes: true, target: 'apps/web' });
    expect(r.scaffoldRoot).toBe(path.join(root, 'apps/web'));
  });

  it('throws AmbiguousTarget when multiple subdirs match and no target given', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-ambig-'));
    for (const sub of ['apps/web', 'apps/admin']) {
      await mkdir(path.join(root, sub), { recursive: true });
      await writeFile(path.join(root, sub, 'package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
      await writeFile(path.join(root, sub, 'vite.config.ts'), '');
    }
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    await expect(initProject({ cwd: root, yes: true })).rejects.toThrow(/AmbiguousTarget|multiple|--target/);
  });

  it('preserves existing single-detection root behavior', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-singleroot-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'vite.config.ts'), '');
    const r = await initProject({ cwd: root, yes: true });
    expect(r.scaffoldRoot).toBe(root);
  });
});
