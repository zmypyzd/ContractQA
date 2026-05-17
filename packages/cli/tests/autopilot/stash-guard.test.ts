// packages/cli/tests/autopilot/stash-guard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
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

  it('gitignored sensitive files (.env.local) do NOT trigger confirmSensitive', async () => {
    // .env.local is in .gitignore (set up in beforeEach), so it's untracked-gitignored.
    // After I1 fix, confirmSensitive must NOT fire for gitignored-only sensitive files.
    writeFileSync(join(tmp, '.env.local'), 'API_KEY=secret\n');
    const g = createStashGuard(tmp);
    let asked = false;
    await g.protect({ confirmSensitive: async () => {
      asked = true;
      return true;
    }});
    expect(asked).toBe(false);
  });

  it('aborts when user declines sensitive-file confirmation for tracked sensitive files', async () => {
    // Create a tracked sensitive file (not gitignored) that is then modified.
    writeFileSync(join(tmp, '.env'), 'API_KEY=secret\n');
    execSync('git add .env && git commit -q -m "add env"', { cwd: tmp });
    // Modify it so it shows as modified (tracked sensitive).
    writeFileSync(join(tmp, '.env'), 'API_KEY=changed\n');
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

  it('blocks and calls confirmSensitive when a dirty submodule is detected', async () => {
    // Create a sub-repo that will act as the submodule content.
    const subTmp = mkdtempSync(join(tmpdir(), 'cqa-sub-'));
    try {
      execSync('git init -q', { cwd: subTmp });
      execSync('git config user.email test@x.test', { cwd: subTmp });
      execSync('git config user.name test', { cwd: subTmp });
      writeFileSync(join(subTmp, 'sub.txt'), 'sub\n');
      execSync('git add . && git commit -q -m "sub init"', { cwd: subTmp });

      // Add it as a submodule.
      execSync(`git -c protocol.file.allow=always submodule add "${subTmp}" mysubmodule`, { cwd: tmp });
      execSync('git config user.email test@x.test', { cwd: tmp });
      execSync('git config user.name test', { cwd: tmp });
      execSync('git add . && git commit -q -m "add submodule"', { cwd: tmp });

      // Make the submodule dirty (add a new commit in the submodule).
      writeFileSync(join(tmp, 'mysubmodule', 'extra.txt'), 'dirty\n');
      execSync('git add extra.txt && git commit -q -m "dirty sub commit"', { cwd: join(tmp, 'mysubmodule') });

      // Now git submodule status should show '+' for the submodule.
      const g = createStashGuard(tmp);
      let confirmCalled = false;
      let confirmItems: Array<{ path: string }> = [];
      await g.protect({
        confirmSensitive: async (items) => {
          confirmCalled = true;
          confirmItems = items as Array<{ path: string }>;
          return true;
        },
      });
      expect(confirmCalled).toBe(true);
      expect(confirmItems.some((i) => i.path.includes('mysubmodule'))).toBe(true);
    } finally {
      rmSync(subTmp, { recursive: true, force: true });
    }
  });

  it('aborts when user declines dirty-submodule confirmation', async () => {
    // Create a sub-repo that will act as the submodule content.
    const subTmp = mkdtempSync(join(tmpdir(), 'cqa-sub2-'));
    try {
      execSync('git init -q', { cwd: subTmp });
      execSync('git config user.email test@x.test', { cwd: subTmp });
      execSync('git config user.name test', { cwd: subTmp });
      writeFileSync(join(subTmp, 'sub.txt'), 'sub\n');
      execSync('git add . && git commit -q -m "sub init"', { cwd: subTmp });

      execSync(`git -c protocol.file.allow=always submodule add "${subTmp}" mysubmodule`, { cwd: tmp });
      execSync('git config user.email test@x.test', { cwd: tmp });
      execSync('git config user.name test', { cwd: tmp });
      execSync('git add . && git commit -q -m "add submodule"', { cwd: tmp });

      // Make the submodule dirty.
      writeFileSync(join(tmp, 'mysubmodule', 'extra.txt'), 'dirty\n');
      execSync('git add extra.txt && git commit -q -m "dirty sub commit"', { cwd: join(tmp, 'mysubmodule') });

      const g = createStashGuard(tmp);
      await expect(g.protect({ confirmSensitive: async () => false }))
        .rejects.toThrow(/aborted by user.*submodule/i);
    } finally {
      rmSync(subTmp, { recursive: true, force: true });
    }
  });
});
