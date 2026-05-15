import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { rcompare, valid } from 'semver';
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
  boot: Pick<ProbeResult, 'ready' | 'firstStderrError' | 'abiHint'> | null;
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
    boot = { ready: r.ready, firstStderrError: r.firstStderrError, abiHint: r.abiHint };
    r.kill();
  }
  // 'NEEDS FIX' fires on either a failed boot probe OR detected native
  // mismatches (the latter matters when callers pass skipBootProbe — common
  // in CI).
  const needsFix = (!!boot && !boot.ready) || native.length > 0;
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

async function readNativeDepsFromWorkspace(targetRoot: string): Promise<string[]> {
  const native = new Set<string>();
  const candidatePackageJsons = [path.join(targetRoot, 'package.json')];
  // Heuristic: walk apps/* and packages/* (covers ~90% of pnpm/turborepo layouts).
  for (const sub of ['apps/*/package.json', 'packages/*/package.json']) {
    for (const f of await glob([sub], { cwd: targetRoot, absolute: true })) {
      candidatePackageJsons.push(f);
    }
  }
  for (const pj of candidatePackageJsons) {
    try {
      const raw = await readFile(pj, 'utf8');
      const parsed = JSON.parse(raw);
      const all = { ...parsed.dependencies, ...parsed.devDependencies };
      for (const d of NATIVE_DEPS) if (d in all) native.add(d);
    } catch { /* ignore unreadable / malformed */ }
  }
  return [...native];
}

async function findPnpmPkgDir(targetRoot: string, pkg: string): Promise<string | null> {
  const dotPnpm = path.join(targetRoot, 'node_modules', '.pnpm');
  try {
    const entries = await readdir(dotPnpm);
    const matches = entries.filter((d) => d.startsWith(`${pkg}@`));
    // Sort by parsed semver (descending — newest first); fall back to lexicographic
    // when semver parse fails (preserves Phase 5/6 behavior for non-semver dir names).
    matches.sort((a, b) => {
      const va = a.split('@').pop() ?? '';
      const vb = b.split('@').pop() ?? '';
      if (valid(va) && valid(vb)) return rcompare(va, vb);
      return b.localeCompare(a);
    });
    if (matches.length === 0) return null;
    return path.join(dotPnpm, matches[0]!, 'node_modules', pkg);
  } catch { return null; }
}

async function runNpmInstallScript(cwd: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'install'], { cwd, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, detail: 'npm run install OK' });
        return;
      }
      const base = stderr.slice(0, 200).replace(/\s+/g, ' ').trim();
      const hint = /Missing script:\s*["']?install["']?/i.test(base)
        ? ' (package has no install script — try `pnpm rebuild <pkg>` or `npm rebuild <pkg>`)'
        : '';
      resolve({ ok: false, detail: (base + hint).slice(0, 300) });
    });
    child.on('error', (err) => resolve({ ok: false, detail: err.message }));
  });
}

async function fixNativeDeps(i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  const native = await readNativeDepsFromWorkspace(i.targetRoot);
  if (native.length === 0) {
    return { ok: true, detail: 'no native deps detected' };
  }

  const results: string[] = [];
  let allOk = true;
  for (const pkg of native) {
    // Find the .pnpm-mirrored copy of <pkg>.
    // Sort lexicographically and pick the first entry — deterministic across runs.
    // NOTE: ASCII sort puts '11.10.0' before '9.6.0'; semver-aware selection is a Phase 7 candidate.
    const installDir = await findPnpmPkgDir(i.targetRoot, pkg);
    if (!installDir) {
      results.push(`${pkg}: no installed copy found in node_modules/.pnpm`);
      allOk = false;
      continue;
    }
    // Extract the resolved version from the .pnpm dir entry (e.g. better-sqlite3@11.10.0)
    const pnpmEntry = path.basename(path.dirname(path.dirname(installDir)));
    const resolvedVersion = pnpmEntry.includes('@') ? pnpmEntry.split('@').pop() ?? '' : '';
    const versionTag = resolvedVersion ? `@${resolvedVersion}` : '';
    const r = await runNpmInstallScript(installDir);
    results.push(`${pkg}${versionTag}: ${r.ok ? 'rebuilt OK' : `failed — ${r.detail}`}`);
    if (!r.ok) allOk = false;
  }
  return { ok: allOk, detail: results.join('; ') };
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
    if (r.boot?.abiHint) {
      lines.push(`- ABI mismatch hint: built ${r.boot.abiHint.built}, runtime ${r.boot.abiHint.runtime} → run \`contractqa doctor --fix=native-deps <target>\``);
    }
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
