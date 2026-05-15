import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/commands/scan.js';

describe('scan — hybrid auth markdown', () => {
  it('renders Hybrid auth section when 2 providers + --detect-auth', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-hybrid-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    await mkdir(path.join(root, 'app/api/auth/[...nextauth]'), { recursive: true });
    await writeFile(path.join(root, 'app/api/auth/[...nextauth]/route.ts'), '');
    await mkdir(path.join(root, 'lib/supabase'), { recursive: true });
    await writeFile(path.join(root, 'lib/supabase/server.ts'), '');
    await writeFile(path.join(root, 'middleware.ts'), '');

    const r = await scanProject({ cwd: root, detectAuth: true });
    expect(r.markdown).toContain('## Hybrid auth');
    expect(r.markdown).toContain('### next-auth');
    expect(r.markdown).toContain('### supabase');
    expect(r.markdown).toMatch(/Suggested session owner:\*\* next-auth/);
    expect(r.markdown).toContain('composeAuth([');
    expect(r.markdown).toContain('currently suggested: next-auth');
    expect(r.markdown).toContain('app/api/auth/[...nextauth]/route.ts');
    expect(r.markdown).toContain('lib/supabase/server.ts');
  });

  it('omits Hybrid auth section when only 1 provider', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-single-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*' },
    }));
    const r = await scanProject({ cwd: root, detectAuth: true });
    expect(r.markdown).not.toContain('## Hybrid auth');
  });

  it('omits Hybrid auth section when --detect-auth is off, even with 2 providers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-hybrid-off-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    const r = await scanProject({ cwd: root });
    expect(r.markdown).not.toContain('## Hybrid auth');
  });

  it('renders "(none found via path-presence)" when providers detected via deps only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-deps-only-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    // No wiring files, no middleware.
    const r = await scanProject({ cwd: root, detectAuth: true });
    expect(r.markdown).toContain('## Hybrid auth');
    expect(r.markdown).toContain('(none found via path-presence)');
  });
});
