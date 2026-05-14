import { describe, it, expect } from 'vitest';
import { probeHostBoot } from '../../src/lib/host-probe.js';

describe('probeHostBoot', () => {
  it('returns ready: true when the readinessUrl answers 200 within budget', async () => {
    const result = await probeHostBoot({
      command: 'node',
      args: [
        '-e',
        "require('http').createServer((_,r)=>r.end('ok')).listen(3711, '127.0.0.1')",
      ],
      readinessUrl: 'http://127.0.0.1:3711/',
      timeoutMs: 5_000,
    });
    expect(result.ready).toBe(true);
    expect(result.firstStderrError).toBeNull();
    result.kill();
  });

  it('returns ready: false + firstStderrError when the host crashes', async () => {
    const result = await probeHostBoot({
      command: 'node',
      args: [
        '-e',
        "console.error('Error: better-sqlite3 bindings not found'); process.exit(1);",
      ],
      readinessUrl: 'http://127.0.0.1:3712/',
      timeoutMs: 3_000,
    });
    expect(result.ready).toBe(false);
    expect(result.firstStderrError).toContain('better-sqlite3');
    result.kill();
  });
});
