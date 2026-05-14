import { detectRequiredEnv, type RequiredVar } from '../lib/env-detect.js';
import { allocatePort } from '../lib/port-pool.js';
import { detectNativeDepMismatch, type NativeMismatch } from '../lib/native-deps.js';
import { probeHostBoot, type ProbeResult } from '../lib/host-probe.js';

export interface DoctorInput {
  targetRoot: string;
  requestedPorts?: number[];
  skipBootProbe?: boolean;
  bootCommand?: { command: string; args: string[]; readinessUrl: string };
}

export interface DoctorReport {
  env: RequiredVar[];
  ports: Array<{ requested: number; allocated: number }>;
  native: NativeMismatch[];
  boot: Pick<ProbeResult, 'ready' | 'firstStderrError'> | null;
  summary: 'READY' | 'NEEDS FIX';
}

export async function doctor(i: DoctorInput): Promise<DoctorReport> {
  const env = await detectRequiredEnv(i.targetRoot);
  const ports: DoctorReport['ports'] = [];
  for (const req of i.requestedPorts ?? []) {
    ports.push({ requested: req, allocated: await allocatePort(req) });
  }
  const native = await detectNativeDepMismatch(i.targetRoot);
  let boot: DoctorReport['boot'] = null;
  if (!i.skipBootProbe && i.bootCommand) {
    const r = await probeHostBoot({
      ...i.bootCommand,
      cwd: i.targetRoot,
      timeoutMs: 30_000,
    });
    boot = { ready: r.ready, firstStderrError: r.firstStderrError };
    r.kill();
  }
  const needsFix = !!boot && !boot.ready;
  return { env, ports, native, boot, summary: needsFix ? 'NEEDS FIX' : 'READY' };
}

export function renderDoctorReport(r: DoctorReport): string {
  const lines = [`## ContractQA doctor — ${r.summary}`, ''];
  lines.push('### Env vars (target needs these set before boot)');
  if (r.env.length === 0) {
    lines.push('- (none detected)');
  }
  for (const v of r.env) {
    lines.push(`- \`${v.name}\` (${v.source}) — suggested stub: \`${v.suggestedStub}\``);
  }
  lines.push('', '### Port allocations');
  if (r.ports.length === 0) {
    lines.push('- (none requested)');
  }
  for (const p of r.ports) {
    lines.push(`- requested ${p.requested} → allocated ${p.allocated}`);
  }
  if (r.native.length) {
    lines.push('', '### Native bindings');
    for (const n of r.native) lines.push(`- ${n.binding} — ${n.suggestion}`);
  }
  if (r.boot) {
    lines.push('', '### Boot probe');
    lines.push(`- ready: ${r.boot.ready}`);
    if (r.boot.firstStderrError) lines.push(`- first stderr error: ${r.boot.firstStderrError}`);
  }
  return lines.join('\n');
}
