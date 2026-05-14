import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
});
