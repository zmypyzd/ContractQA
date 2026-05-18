import { describe, expect, it, vi } from 'vitest';
import { runAutoPrPreflight } from '../src/commands/autopilot-watch.js';

describe('autopilot-watch --auto-pr preflight', () => {
  it('returns ok=false when gh CLI is missing', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') {
        return { stdout: '', stderr: 'not found', exitCode: 127 };
      }
      return { stdout: 'git version 2.39.0', stderr: '', exitCode: 0 };
    });
    const result = await runAutoPrPreflight({ cwd: '/tmp', exec });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('gh');
  });

  it('returns ok=false when on detached HEAD', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') return { stdout: 'gh version 2.40.0', stderr: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'auth') return { stdout: 'ok', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === '--version') return { stdout: 'git version 2.39.0', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { stdout: 'HEAD\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await runAutoPrPreflight({ cwd: '/tmp', exec });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('detached');
  });

  it('returns ok=true with baseBranch when all checks pass', async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === '--version') return { stdout: 'gh version 2.40.0', stderr: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'auth') return { stdout: 'ok', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === '--version') return { stdout: 'git version 2.39.0', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'rev-parse') return { stdout: 'feature/foo\n', stderr: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'remote') return { stdout: 'git@github.com:x/y.git\n', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await runAutoPrPreflight({ cwd: '/tmp', exec });
    expect(result.ok).toBe(true);
    expect(result.baseBranch).toBe('feature/foo');
  });
});
