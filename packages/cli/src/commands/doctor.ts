import { detectRequiredEnv, type RequiredVar } from '../lib/env-detect.js';
import { allocatePort } from '../lib/port-pool.js';
import { detectNativeDepMismatch, type NativeMismatch } from '../lib/native-deps.js';
import { probeHostBoot, type ProbeResult } from '../lib/host-probe.js';

export type FixName = 'native-deps' | 'env-stub' | 'port-collision';

export interface DoctorInput {
  targetRoot: string;
  requestedPorts?: number[];
  skipBootProbe?: boolean;
  bootCommand?: { command: string; args: string[]; readinessUrl: string };
  fix?: readonly FixName[];
}

export interface DoctorReport {
  env: RequiredVar[];
  ports: Array<{ requested: number; allocated: number }>;
  native: NativeMismatch[];
  boot: Pick<ProbeResult, 'ready' | 'firstStderrError'> | null;
  summary: 'READY' | 'NEEDS FIX';
  fixesAttempted: Array<{ name: FixName; ok: boolean; detail: string }>;
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
  const report: DoctorReport = {
    env,
    ports,
    native,
    boot,
    summary: needsFix ? 'NEEDS FIX' : 'READY',
    fixesAttempted: [],
  };

  if (i.fix?.length) {
    for (const name of i.fix) {
      const result = await applyFix(name, i, report);
      report.fixesAttempted.push({ name, ok: result.ok, detail: result.detail });
    }
  }

  return report;
}

async function fixNativeDeps(_i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'native-deps not yet implemented' };
}

async function fixEnvStub(_i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'env-stub not yet implemented' };
}

async function fixPortCollision(_i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'port-collision not yet implemented' };
}

async function applyFix(name: FixName, i: DoctorInput, r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  switch (name) {
    case 'native-deps':    return fixNativeDeps(i, r);
    case 'env-stub':       return fixEnvStub(i, r);
    case 'port-collision': return fixPortCollision(i, r);
  }
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
  if (r.fixesAttempted.length > 0) {
    lines.push('');
    lines.push('### Fixes attempted');
    for (const f of r.fixesAttempted) {
      lines.push(`  ${f.ok ? '[ok]' : '[FAIL]'} ${f.name}: ${f.detail}`);
    }
  }
  return lines.join('\n');
}
