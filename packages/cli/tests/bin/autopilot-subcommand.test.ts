// packages/cli/tests/bin/autopilot-subcommand.test.ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('contractqa autopilot --help', () => {
  it('exits 0 and mentions autopilot flags', () => {
    const bin = require.resolve('../../dist/bin/contractqa.js');
    const out = execFileSync(process.execPath, [bin, 'autopilot', '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/--time-budget/);
    expect(out).toMatch(/--no-fix/);
    expect(out).toMatch(/--yes/);
    expect(out).toMatch(/--regenerate/);
  });
});
