// packages/cli/tests/autopilot-non-git-warn.test.ts
//
// Phase C follow-up to the stashGuard non-git fix (commit f89f5a5):
// when cwd is not a git repo AND fix is enabled (the default), runAutopilot
// should surface a single upfront warn telling the user that Phase C will
// not be able to apply any diffs (git apply --index needs a git work tree).
// Without this warn, fix-enabled runs in non-git dirs silently produce zero
// applied diffs while reporting Phase C as "complete" — confusing.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAutopilot, type AutopilotProgressEvent } from '../src/commands/autopilot.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';

function emptyLLM(): LLMClient {
  return {
    providerName: 'openai-compatible',
    modelHint: 'fake',
    async generate() {
      return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

const NON_GIT_WARN_RE = /not a git repo|non-git cwd/i;

describe('autopilot: non-git cwd upfront warn', () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop();
      if (d) await rm(d, { recursive: true, force: true });
    }
  });

  async function makeCwd(prefix: string, gitInit: boolean): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), prefix));
    tmpDirs.push(cwd);
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0' } }),
    );
    if (gitInit) {
      execSync(
        'git init -q && git -c user.email=t@t -c user.name=t add . && git -c user.email=t@t -c user.name=t commit -q -m init',
        { cwd, shell: '/bin/bash' },
      );
    }
    return cwd;
  }

  async function collectEvents(cwd: string, fix: boolean): Promise<AutopilotProgressEvent[]> {
    const events: AutopilotProgressEvent[] = [];
    await runAutopilot({
      cwd,
      llmClient: emptyLLM(),
      timeBudgetMs: 60_000,
      fix,
      yes: true,
      onProgress: (e) => events.push(e),
    });
    return events;
  }

  function findNonGitWarn(events: AutopilotProgressEvent[]): AutopilotProgressEvent | undefined {
    return events.find(
      (e) => e.type === 'log' && e.level === 'warn' && NON_GIT_WARN_RE.test(e.message),
    );
  }

  it('emits one upfront warn when cwd is non-git and fix is enabled (default)', async () => {
    const cwd = await makeCwd('autopilot-non-git-warn-', false);
    const events = await collectEvents(cwd, true);

    const warn = findNonGitWarn(events);
    expect(warn).toBeDefined();
    // Phase C will be unable to apply diffs — the warn should point users to
    // --no-fix so they understand the workaround.
    expect(warn && warn.type === 'log' && warn.message).toMatch(/--no-fix|no-fix/);
  });

  it('does NOT emit the warn when fix is disabled (--no-fix)', async () => {
    const cwd = await makeCwd('autopilot-non-git-no-warn-nofix-', false);
    const events = await collectEvents(cwd, false);

    expect(findNonGitWarn(events)).toBeUndefined();
  });

  it('does NOT emit the warn when cwd is a real git repo', async () => {
    const cwd = await makeCwd('autopilot-git-no-warn-', true);
    const events = await collectEvents(cwd, true);

    expect(findNonGitWarn(events)).toBeUndefined();
  });
});
