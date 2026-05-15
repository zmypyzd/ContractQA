import { describe, it, expect } from 'vitest';
import { detectNativeDepMismatch } from '../../src/lib/native-deps.js';

const FIXTURE = process.env.CONTRACTQA_LOCAL_TARGET ?? '';

describe.skipIf(!process.env.CONTRACTQA_LOCAL_TARGET)('native-deps against real target', () => {
  it('detects better-sqlite3 ABI mismatch when runtime != built', async () => {
    const r = await detectNativeDepMismatch(FIXTURE);
    const sqlite = r.find((m) => m.binding === 'better_sqlite3.node');
    expect(sqlite, 'should find better_sqlite3.node binding').toBeDefined();
    if (sqlite!.builtAbi !== null) {
      expect(sqlite!.builtAbi).toMatch(/^1\d{2}$/);
    }
  });
});
