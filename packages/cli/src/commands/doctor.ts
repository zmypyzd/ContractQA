import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

const NATIVE_DEPS = ['better-sqlite3', 'sqlite3', 'node-gyp', 'bcrypt', 'sharp', 'canvas'];

async function fixNativeDeps(i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    const raw = await readFile(path.join(i.targetRoot, 'package.json'), 'utf8');
    pkg = JSON.parse(raw);
  } catch {
    // missing/malformed — treat as no deps
  }
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const native = NATIVE_DEPS.filter((d) => d in all);
  if (native.length === 0) {
    return { ok: true, detail: 'no native deps detected' };
  }
  return new Promise((resolve) => {
    const child = spawn('npm', ['rebuild', ...native], { cwd: i.targetRoot, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const detail = code === 0
        ? `npm rebuild ${native.join(' ')} OK`
        : `npm rebuild failed (exit ${code}): ${stderr.slice(0, 200).replace(/\s+/g, ' ').trim()}`;
      resolve({ ok: code === 0, detail });
    });
    child.on('error', (err) => {
      resolve({ ok: false, detail: `npm rebuild spawn error: ${err.message}` });
    });
  });
}

async function fixEnvStub(i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  const examplePath = path.join(i.targetRoot, '.env.example');
  const localPath = path.join(i.targetRoot, '.env.local');
  let example: string;
  try {
    example = await readFile(examplePath, 'utf8');
  } catch {
    return { ok: true, detail: 'no .env.example to stub from, skipped' };
  }
  try {
    await readFile(localPath, 'utf8');
    return { ok: true, detail: '.env.local already exists, skipped' };
  } catch {
    await writeFile(localPath, example);
    const lineCount = example.split('\n').filter((l) => l.length > 0).length;
    return { ok: true, detail: `.env.local written from .env.example (${lineCount} lines)` };
  }
}

async function fixPortCollision(i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  if (!i.requestedPorts?.length) return { ok: true, detail: 'no ports requested' };
  const swaps: string[] = [];
  for (const p of i.requestedPorts) {
    const free = await allocatePort(p);
    if (free !== p) swaps.push(`${p} → ${free}`);
  }
  return swaps.length === 0
    ? { ok: true, detail: 'all requested ports free' }
    : { ok: true, detail: `reallocated: ${swaps.join(', ')}` };
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
