import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

async function makeMonorepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-monorepo-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'root', private: true, workspaces: ['packages/*'],
  }));
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  await mkdir(path.join(root, 'packages/persistence'), { recursive: true });
  await writeFile(path.join(root, 'packages/persistence/package.json'), JSON.stringify({
    name: 'persistence',
    dependencies: { 'better-sqlite3': '^11.0.0' },
  }));
  return root;
}

describe('doctor fixNativeDeps (workspace)', () => {
  it('detects better-sqlite3 declared in a workspace package, not root', async () => {
    const root = await makeMonorepo();
    const r = await doctor({ targetRoot: root, skipBootProbe: true, fix: ['native-deps'] });
    const fix = r.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    // We're in a tmpdir without an actual install — the fix should report
    // "would rebuild better-sqlite3 (no installed copy found)" rather than
    // today's "no native deps detected".
    expect(fix!.detail).not.toBe('no native deps detected');
    expect(fix!.detail).toMatch(/better-sqlite3/);
  });
});
