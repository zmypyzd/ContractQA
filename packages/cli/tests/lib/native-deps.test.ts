import { describe, it, expect } from 'vitest';
import { detectNativeDepMismatch } from '../../src/lib/native-deps.js';

describe('detectNativeDepMismatch', () => {
  it('returns an empty list when there are no .node binaries', async () => {
    const out = await detectNativeDepMismatch('/nonexistent-' + Date.now());
    expect(out).toEqual([]);
  });

  it('with stub input, flags entries whose ABI differs from runtime', async () => {
    const out = await detectNativeDepMismatch(process.cwd(), {
      _stubFiles: [{ path: '/x/better_sqlite3.node', abi: '108' }],
      _runtimeAbi: '115',
    });
    expect(out.length).toBe(1);
    expect(out[0]!.suggestion).toContain('rebuild');
    expect(out[0]!.builtAbi).toBe('108');
    expect(out[0]!.runtimeAbi).toBe('115');
  });

  it('with stub input, returns [] when ABIs match', async () => {
    const out = await detectNativeDepMismatch(process.cwd(), {
      _stubFiles: [{ path: '/x/better_sqlite3.node', abi: '115' }],
      _runtimeAbi: '115',
    });
    expect(out).toEqual([]);
  });
});
