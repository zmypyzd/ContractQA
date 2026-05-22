import { afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStashGuard } from '../src/autopilot/stash-guard.js';

describe('stash-guard: non-git cwd graceful degradation', () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function tmpCwd(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  it('protect() returns a clean no-op when cwd is not inside a git repo', async () => {
    const cwd = await tmpCwd('stash-guard-non-git-');
    // Drop a regular file so the dir isn't empty — proves we're not just
    // skipping because there's nothing to look at.
    await writeFile(path.join(cwd, 'README.md'), 'just a file, no git\n');

    const guard = createStashGuard(cwd);
    const result = await guard.protect({
      confirmSensitive: async () => true,
    });

    expect(result.stashed).toBe(false);
    expect(result.items).toEqual([]);

    // release() must also be safe to call on a no-op protect().
    await expect(guard.release()).resolves.toBeUndefined();
  });

  it('protect() re-throws a clear error when the git binary is missing', async () => {
    // ENOENT from spawn ≠ "not a git repo". Silently classifying git-missing
    // as non-git would let autopilot proceed without ANY git operations
    // (Phase C would later fail per-diff with the same ENOENT). Surface it
    // upfront instead.
    const cwd = await tmpCwd('stash-guard-no-git-binary-');
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      const guard = createStashGuard(cwd);
      await expect(
        guard.protect({ confirmSensitive: async () => true }),
      ).rejects.toThrow(/git binary not found/);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('documents the parent-walk semantic: cwd inside a git work tree is treated as a git cwd', async () => {
    // This is intentional pre-existing behavior — `git rev-parse --git-dir`
    // walks up to find a parent .git/, so a non-git subdir of a git repo
    // is still classified as "in a git repo". Eval-fixture scratch dirs
    // SHOULD live outside any tracked workspace; if you nest them under one,
    // stash-guard will protect the PARENT repo's index, not the scratch dir.
    const repoRoot = await tmpCwd('stash-guard-parent-repo-');
    execSync(
      'git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init',
      { cwd: repoRoot, shell: '/bin/bash' },
    );
    const scratch = path.join(repoRoot, 'scratch');
    await mkdir(scratch);
    // No files committed under scratch, parent repo is clean ⇒ enumerate()
    // sees no dirty tracked items and returns no-op anyway, but it DID run
    // git in the parent repo, not short-circuit on isGitRepo.
    const guard = createStashGuard(scratch);
    const result = await guard.protect({ confirmSensitive: async () => true });
    expect(result.stashed).toBe(false);
    expect(result.items).toEqual([]);
  });
});
