// packages/cli/tests/autopilot/stash-guard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createStashGuard } from '../../src/autopilot/stash-guard.js';

let tmp: string;

function git(cmd: string) {
  return execSync(`git ${cmd}`, { cwd: tmp }).toString().trim();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cqa-stash-'));
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email test@x.test', { cwd: tmp });
  execSync('git config user.name test', { cwd: tmp });
  writeFileSync(join(tmp, '.gitignore'), '.env.local\n');
  writeFileSync(join(tmp, 'tracked.txt'), 'hi\n');
  execSync('git add . && git commit -q -m init', { cwd: tmp });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('stash-guard', () => {
  it('reports stashed: false on clean working tree', async () => {
    const g = createStashGuard(tmp);
    const r = await g.protect({ confirmSensitive: async () => true });
    expect(r.stashed).toBe(false);
  });

  it('stashes modified tracked files', async () => {
    writeFileSync(join(tmp, 'tracked.txt'), 'changed\n');
    const g = createStashGuard(tmp);
    const r = await g.protect({ confirmSensitive: async () => true });
    expect(r.stashed).toBe(true);
    expect(r.items?.some((i) => i.path === 'tracked.txt' && i.state === 'modified')).toBe(true);
    // Working tree restored to HEAD
    expect(git('status --porcelain')).toBe('');
  });

  it('detects gitignored sensitive files (.env.local) and requires confirmation', async () => {
    writeFileSync(join(tmp, '.env.local'), 'API_KEY=secret\n');
    const g = createStashGuard(tmp);
    let asked = false;
    await g.protect({ confirmSensitive: async (items) => {
      asked = true;
      expect(items.some((i) => i.path === '.env.local' && i.isSensitive)).toBe(true);
      return true;
    }});
    expect(asked).toBe(true);
  });

  it('aborts when user declines sensitive-file confirmation', async () => {
    writeFileSync(join(tmp, '.env.local'), 'API_KEY=secret\n');
    const g = createStashGuard(tmp);
    await expect(g.protect({ confirmSensitive: async () => false }))
      .rejects.toThrow(/aborted by user/i);
  });

  it('release() does NOT pop the stash', async () => {
    writeFileSync(join(tmp, 'tracked.txt'), 'changed\n');
    const g = createStashGuard(tmp);
    await g.protect({ confirmSensitive: async () => true });
    await g.release();
    const stashList = execSync('git stash list', { cwd: tmp }).toString();
    expect(stashList).toMatch(/contractqa-autopilot/);
  });
});
