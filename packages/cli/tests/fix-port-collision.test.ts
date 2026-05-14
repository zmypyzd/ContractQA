import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { doctor } from '../src/commands/doctor.js';

describe('doctor --fix port-collision', () => {
  let servers: Server[] = [];
  afterEach(() => {
    for (const s of servers) s.close();
    servers = [];
  });

  it('returns ok when all requested ports are free', async () => {
    // Use ports very unlikely to be in use — pick high numbers
    const report = await doctor({ targetRoot: process.cwd(), requestedPorts: [54881, 54882], fix: ['port-collision'], skipBootProbe: true });
    const fix = report.fixesAttempted.find((f) => f.name === 'port-collision');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/all requested ports free|no swaps needed/i);
  });

  it('reallocates when requested port is held', async () => {
    const held = await new Promise<number>((resolve, reject) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const addr = s.address();
        if (addr && typeof addr === 'object') {
          servers.push(s);
          resolve(addr.port);
        } else {
          reject(new Error('listen failed'));
        }
      });
      s.on('error', reject);
    });

    const report = await doctor({ targetRoot: process.cwd(), requestedPorts: [held], fix: ['port-collision'], skipBootProbe: true });
    const fix = report.fixesAttempted.find((f) => f.name === 'port-collision');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(new RegExp(`\\b${held}\\b`));
    expect(fix!.detail).toMatch(/reallocated|→/);
  });

  it('returns ok with detail when no ports requested', async () => {
    const report = await doctor({ targetRoot: process.cwd(), fix: ['port-collision'], skipBootProbe: true });
    const fix = report.fixesAttempted.find((f) => f.name === 'port-collision');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/no ports requested/i);
  });
});
