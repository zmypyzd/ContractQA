import { describe, it, expect, vi } from 'vitest';
import { runClaudeFix } from '../src/claude-code.js';

describe('runClaudeFix', () => {
  it('spawns claude with --bare, allowed tools, prompt from issue bundle', async () => {
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        root_cause: 'session cleanup missing',
        files_changed: ['src/auth.ts'],
        tests_run: ['repro'],
        validation_result: 'PASS',
      }),
    });
    const r = await runClaudeFix({
      promptPath: '/tmp/fix-prompt.md',
      cwd: '/tmp/wt',
      allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
      spawn,
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      expect.arrayContaining([
        '--bare',
        '-p',
        '/tmp/fix-prompt.md',
        '--allowedTools',
        'Read,Edit,Bash,Grep,Glob',
        '--output-format',
        'json',
      ]),
      expect.objectContaining({ cwd: '/tmp/wt' }),
    );
    expect(r.validation_result).toBe('PASS');
  });

  it('returns parse error when stdout is not JSON', async () => {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'not json' });
    const r = await runClaudeFix({
      promptPath: '/p',
      cwd: '/c',
      allowedTools: ['Read'],
      spawn,
    });
    expect(r.validation_result).toBe('PARSE_ERROR');
  });

  it('returns FAIL when exit code non-zero', async () => {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 2, stdout: '' });
    const r = await runClaudeFix({
      promptPath: '/p',
      cwd: '/c',
      allowedTools: ['Read'],
      spawn,
    });
    expect(r.validation_result).toBe('FAIL');
  });
});
