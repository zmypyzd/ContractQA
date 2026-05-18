import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('contractqa dashboard --help', () => {
  it('exits 0 and mentions dashboard flags', () => {
    const bin = require.resolve('../../dist/bin/contractqa.js');
    const out = execFileSync(process.execPath, [bin, 'dashboard', '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/--port/);
    expect(out).toMatch(/--no-docker/);
    expect(out).toMatch(/--no-migrate/);
    expect(out).toMatch(/--db-url/);
  });

  it('is listed in the top-level help', () => {
    const bin = require.resolve('../../dist/bin/contractqa.js');
    const out = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/dashboard/);
  });
});
