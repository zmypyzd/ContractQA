import { describe, it, expect, vi } from 'vitest';
import { runFixLoop } from '../src/fix-loop.js';

describe('runFixLoop', () => {
  it('returns SUCCESS on first attempt when validation_result PASS', async () => {
    const fix = vi.fn().mockResolvedValue({ validation_result: 'PASS', raw_stdout: '' });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.attempts).toBe(1);
  });

  it('retries until PASS within maxAttempts', async () => {
    const fix = vi
      .fn()
      .mockResolvedValueOnce({ validation_result: 'FAIL', raw_stdout: '' })
      .mockResolvedValueOnce({ validation_result: 'FAIL', raw_stdout: '' })
      .mockResolvedValueOnce({ validation_result: 'PASS', raw_stdout: '' });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.attempts).toBe(3);
  });

  it('returns EXHAUSTED after maxAttempts FAIL', async () => {
    const fix = vi.fn().mockResolvedValue({ validation_result: 'FAIL', raw_stdout: '' });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('EXHAUSTED');
    expect(r.attempts).toBe(3);
  });

  it('returns CONTRACT_REVISION_NEEDED and stops when escape valve emitted', async () => {
    const fix = vi.fn().mockResolvedValue({
      validation_result: 'FAIL',
      proposed_contract_revision: { invariant_id: 'INV-L2' },
      raw_stdout: '',
    });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('CONTRACT_REVISION_NEEDED');
    expect(r.attempts).toBe(1);
  });
});
