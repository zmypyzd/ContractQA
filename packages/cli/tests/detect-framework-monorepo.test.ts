import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectFrameworkInRepo } from '../src/init/detect-framework.js';

async function makeMonorepo(layout: 'apps-web' | 'web' | 'frontend'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  const sub = layout === 'apps-web' ? 'apps/web' : layout;
  await mkdir(path.join(root, sub), { recursive: true });
  await writeFile(path.join(root, sub, 'package.json'), JSON.stringify({
    dependencies: { react: '^18.0.0', vite: '^5.0.0' },
  }));
  await writeFile(path.join(root, sub, 'vite.config.ts'), '');
  return root;
}

describe('detectFrameworkInRepo — monorepo subdirectory walking', () => {
  it('detects vite-react in apps/web/', async () => {
    const root = await makeMonorepo('apps-web');
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates.length).toBeGreaterThan(0);
    const c = r.candidates.find((c) => c.subdir === 'apps/web');
    expect(c, 'should find apps/web candidate').toBeDefined();
    expect(c!.framework).toBe('vite-react');
  });

  it('detects vite-react in web/', async () => {
    const root = await makeMonorepo('web');
    const r = await detectFrameworkInRepo(root);
    const c = r.candidates.find((c) => c.subdir === 'web');
    expect(c, 'should find web candidate').toBeDefined();
    expect(c!.framework).toBe('vite-react');
  });

  it('detects vite-react in frontend/', async () => {
    const root = await makeMonorepo('frontend');
    const r = await detectFrameworkInRepo(root);
    const c = r.candidates.find((c) => c.subdir === 'frontend');
    expect(c, 'should find frontend candidate').toBeDefined();
    expect(c!.framework).toBe('vite-react');
  });

  it('returns root candidate (subdir = ".") when root is itself the framework', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-root-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '*', vite: '*' } }));
    await writeFile(path.join(root, 'vite.config.ts'), '');
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates[0]?.subdir).toBe('.');
  });

  it('returns empty candidates when nothing matches', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-empty-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'empty' }));
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates).toEqual([]);
  });

  it('walks scoped workspace packages (apps/@scope/pkg)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-scoped-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    await mkdir(path.join(root, 'apps/@org/web'), { recursive: true });
    await writeFile(path.join(root, 'apps/@org/web/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'apps/@org/web/vite.config.ts'), '');
    const r = await detectFrameworkInRepo(root);
    const found = r.candidates.find((c) => c.subdir === 'apps/@org/web');
    expect(found).toBeDefined();
    expect(found!.framework).toBe('vite-react');
  });

  it('skips symlinked subdirs to avoid descending into pnpm injection', async () => {
    if (process.platform === 'win32') return; // symlink() needs elevated rights on Windows
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-symlink-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }));
    await mkdir(path.join(root, 'apps'), { recursive: true });
    await mkdir(path.join(root, 'real-pkg'), { recursive: true });
    await writeFile(path.join(root, 'real-pkg/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'real-pkg/vite.config.ts'), '');
    await symlink(path.join(root, 'real-pkg'), path.join(root, 'apps/linked'));
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates.find((c) => c.subdir === 'apps/linked')).toBeUndefined();
  });

  it('records symlink-skipped diagnostic in evidence', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-symlink-evidence-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }));
    await mkdir(path.join(root, 'apps'), { recursive: true });
    await mkdir(path.join(root, 'real-pkg'), { recursive: true });
    await writeFile(path.join(root, 'real-pkg/package.json'), JSON.stringify({
      dependencies: { vite: '*', react: '*' },
    }));
    await writeFile(path.join(root, 'real-pkg/vite.config.ts'), '');
    await symlink(path.join(root, 'real-pkg'), path.join(root, 'apps/linked'));
    const r = await detectFrameworkInRepo(root);
    expect(r.evidence.some((e) => /skipped 1 symlinked/.test(e))).toBe(true);
  });
});
