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
  abiHint?: { built: string; runtime: string };
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

export function extractAbiHint(stderr: string): { built: string; runtime: string } | null {
  // Bound the lazy span to 512 chars so misbehaving stderr can't cause
  // catastrophic backtracking.
  const m = stderr.match(/NODE_MODULE_VERSION\s+(\d+)\.[^]{0,512}?requires\s*\n?\s*NODE_MODULE_VERSION\s+(\d+)/);
  return m ? { built: m[1]!, runtime: m[2]! } : null;
}

const STDERR_BUDGET = 64 * 1024;

export async function probeHostBoot(i: ProbeInput): Promise<ProbeResult> {
  let allStderr = '';
  let firstStderrError: string | null = null;
  const proc: ChildProcess = spawn(i.command, i.args, {
    cwd: i.cwd,
    env: i.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (b: Buffer) => {
    const chunk = b.toString();
    if (allStderr.length < STDERR_BUDGET) {
      allStderr += chunk.slice(0, STDERR_BUDGET - allStderr.length);
    }
    if (firstStderrError) return;
    for (const line of chunk.split('\n')) {
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
        return { ready: true, firstStderrError: null, abiHint: undefined, kill: () => proc.kill('SIGINT') };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ready: false, firstStderrError, abiHint: extractAbiHint(allStderr) ?? undefined, kill: () => proc.kill('SIGINT') };
}
