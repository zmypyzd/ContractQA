import { describe, it, expect } from 'vitest';
import { doctor, renderDoctorReport } from '../src/commands/doctor.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('doctor', () => {
  it('produces a report with env + ports + summary', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 't', scripts: { dev: 'echo hi' } }),
    );
    writeFileSync(path.join(dir, '.env.example'), 'FOO=\nAUTH_SECRET=');
    const report = await doctor({
      targetRoot: dir,
      requestedPorts: [3713],
      skipBootProbe: true,
    });
    expect(report.env.some((v) => v.name === 'FOO')).toBe(true);
    expect(report.env.some((v) => v.name === 'AUTH_SECRET')).toBe(true);
    expect(report.ports[0]!.allocated).toBeGreaterThanOrEqual(3713);
    expect(report.summary).toBe('READY');
  });

  it('renders a markdown report', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
    writeFileSync(path.join(dir, '.env.example'), 'AUTH_SECRET=');
    const report = await doctor({ targetRoot: dir, requestedPorts: [3714], skipBootProbe: true });
    const md = renderDoctorReport(report);
    expect(md).toContain('ContractQA doctor');
    expect(md).toContain('AUTH_SECRET');
    expect(md).toContain('Port allocations');
  });
});

describe('doctor --fix (scaffolding)', () => {
  it('returns fixesAttempted with placeholder entries when --fix specified', async () => {
    const { doctor: doctorFn } = await import('../src/commands/doctor.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'doctor-fix-'));
    const report = await doctorFn({
      targetRoot: dir,
      skipBootProbe: true,
      fix: ['native-deps', 'env-stub', 'port-collision'],
    });
    expect(report.fixesAttempted).toHaveLength(3);
    expect(report.fixesAttempted.map((f) => f.name).sort()).toEqual(['env-stub', 'native-deps', 'port-collision']);
    for (const f of report.fixesAttempted) {
      expect(typeof f.ok).toBe('boolean');
      expect(typeof f.detail).toBe('string');
    }
  });

  it('returns empty fixesAttempted when --fix not specified', async () => {
    const { doctor: doctorFn } = await import('../src/commands/doctor.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'doctor-nofix-'));
    const report = await doctorFn({ targetRoot: dir, skipBootProbe: true });
    expect(report.fixesAttempted).toEqual([]);
  });
});
