import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/commands/init.js';

describe('initProject', () => {
  it('creates qa/ skeleton + config template', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-'));
    await initProject({ cwd: dir, provider: 'supabase' });
    await stat(path.join(dir, 'qa', 'INVARIANTS.md'));
    await stat(path.join(dir, 'qa', 'contracts'));
    await stat(path.join(dir, 'qa', 'noise-profile.yml'));
    const cfg = await readFile(path.join(dir, 'contractqa.config.ts'), 'utf8');
    expect(cfg).toContain("provider: 'supabase'");
  });
});
