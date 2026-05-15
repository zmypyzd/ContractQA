import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/commands/scan.js';

describe('scanProject', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-scan-')); });

  it('reports framework, auth signals, and routes for a Next.js app-router target', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '^15', 'next-auth': '^5' },
    }));
    await writeFile(path.join(tmp, 'next.config.ts'), '');
    await mkdir(path.join(tmp, 'app'), { recursive: true });
    await writeFile(path.join(tmp, 'app', 'page.tsx'), 'export default function Page() {}');
    await mkdir(path.join(tmp, 'app', 'login'), { recursive: true });
    await writeFile(path.join(tmp, 'app', 'login', 'page.tsx'), 'export default function Login() {}');

    const report = await scanProject({ cwd: tmp });
    expect(report.framework).toBe('next-app');
    expect(report.authSignals).toContain('next-auth');
    expect(report.routes).toEqual(expect.arrayContaining(['/', '/login']));
    expect(report.markdown).toContain('# ContractQA scan report');
    expect(report.markdown).toContain('**Framework:** next-app');
    expect(report.markdown).toContain('**Auth signals:** next-auth');
    expect(report.markdown).toContain('`/login`');
  });

  it('derives routes from src/app layout', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '^16' },
    }));
    await writeFile(path.join(tmp, 'next.config.ts'), '');
    await mkdir(path.join(tmp, 'src', 'app'), { recursive: true });
    await writeFile(path.join(tmp, 'src', 'app', 'page.tsx'), '');
    await mkdir(path.join(tmp, 'src', 'app', 'login'), { recursive: true });
    await writeFile(path.join(tmp, 'src', 'app', 'login', 'page.tsx'), '');
    const report = await scanProject({ cwd: tmp });
    expect(report.framework).toBe('next-app');
    expect(report.routes).toEqual(expect.arrayContaining(['/', '/login']));
  });

  it('scanProject passes detectAuth through and produces authDiagnostics when set', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-detect-auth-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    await mkdir(path.join(root, 'app/api/auth/[...nextauth]'), { recursive: true });
    await writeFile(path.join(root, 'app/api/auth/[...nextauth]/route.ts'), '');
    await mkdir(path.join(root, 'lib/supabase'), { recursive: true });
    await writeFile(path.join(root, 'lib/supabase/server.ts'), '');
    await writeFile(path.join(root, 'middleware.ts'), '');

    const r = await scanProject({ cwd: root, detectAuth: true });
    expect(r.authDiagnostics).toBeDefined();
    expect(r.authDiagnostics).toHaveLength(2);
    const providers = r.authDiagnostics!.map((d) => d.provider).sort();
    expect(providers).toEqual(['next-auth', 'supabase']);
  });

  it('scanProject omits authDiagnostics when detectAuth is false', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-no-detect-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    const r = await scanProject({ cwd: root });
    expect(r.authDiagnostics).toBeUndefined();
  });

  it('scan markdown includes repo-level evidence (symlink diagnostic)', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-symlink-ev-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    await mkdir(path.join(root, 'apps'), { recursive: true });
    await mkdir(path.join(root, 'real-pkg'), { recursive: true });
    await writeFile(path.join(root, 'real-pkg/package.json'), JSON.stringify({
      dependencies: { vite: '*', react: '*' },
    }));
    await writeFile(path.join(root, 'real-pkg/vite.config.ts'), '');
    await symlink(path.join(root, 'real-pkg'), path.join(root, 'apps/linked'));

    const r = await scanProject({ cwd: root });
    expect(r.markdown).toMatch(/skipped 1 symlinked subdir/);
  });
});
