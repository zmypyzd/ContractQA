import { spawn, type ChildProcess } from 'node:child_process';

export interface ProbeInput {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readinessUrl: string;
  timeoutMs: number;
}

export interface ProbeResult {
  ready: boolean;
  firstStderrError: string | null;
  kill: () => void;
}

// Lines we never count as "first error" — noise from package managers.
const NOISE_PATTERNS = [
  /^\s*$/,
  /WARN /,
  /warning:/i,
  /^npm /,
  /^pnpm /,
  /Done in /,
  /next-dev/,
];

function isError(line: string): boolean {
  if (NOISE_PATTERNS.some((p) => p.test(line))) return false;
  return /error|exception|cannot find|not found|enoent/i.test(line);
}

export async function probeHostBoot(i: ProbeInput): Promise<ProbeResult> {
  let firstStderrError: string | null = null;
  const proc: ChildProcess = spawn(i.command, i.args, {
    cwd: i.cwd,
    env: i.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (b: Buffer) => {
    if (firstStderrError) return;
    for (const line of b.toString().split('\n')) {
      if (isError(line)) {
        firstStderrError = line.trim();
        break;
      }
    }
  });

  const deadline = Date.now() + i.timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const r = await fetch(i.readinessUrl, { redirect: 'manual' });
      if (r.status === 200) {
        return { ready: true, firstStderrError: null, kill: () => proc.kill('SIGINT') };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ready: false, firstStderrError, kill: () => proc.kill('SIGINT') };
}
