import { spawn as nodeSpawn } from 'node:child_process';

export interface ClaudeFixInput {
  promptPath: string;
  cwd: string;
  allowedTools: string[];
  spawn?: (
    cmd: string,
    args: string[],
    opts: { cwd: string },
  ) => Promise<{ exitCode: number; stdout: string }>;
  claudeBin?: string;
}

export interface ClaudeFixResult {
  root_cause?: string;
  files_changed?: string[];
  tests_run?: string[];
  validation_result: 'PASS' | 'FAIL' | 'PARSE_ERROR';
  proposed_contract_revision?: unknown;
  raw_stdout: string;
}

export async function runClaudeFix(i: ClaudeFixInput): Promise<ClaudeFixResult> {
  const run = i.spawn ?? defaultSpawn;
  const args = [
    '--bare',
    '-p',
    i.promptPath,
    '--allowedTools',
    i.allowedTools.join(','),
    '--output-format',
    'json',
  ];
  const { exitCode, stdout } = await run(i.claudeBin ?? 'claude', args, { cwd: i.cwd });
  if (exitCode !== 0) return { validation_result: 'FAIL', raw_stdout: stdout };
  try {
    const parsed = JSON.parse(stdout);
    return {
      ...parsed,
      validation_result: parsed.validation_result ?? 'PASS',
      raw_stdout: stdout,
    };
  } catch {
    return { validation_result: 'PARSE_ERROR', raw_stdout: stdout };
  }
}

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string }) {
  return new Promise<{ exitCode: number; stdout: string }>((resolve) => {
    const proc = nodeSpawn(cmd, args, { cwd: opts.cwd });
    let stdout = '';
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.on('exit', (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}
