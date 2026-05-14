import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ContractQAReporter } from '../src/reporter.js';

describe('ContractQAReporter', () => {
  it('writes a bundle on test failure with attached evidence', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-rep-'));
    const sd = path.join(dir, 'sd.json');
    const trace = path.join(dir, 'trace.zip');
    await writeFile(sd, '{"a":1}');
    await writeFile(trace, 'PK\x03\x04');

    const writer = vi.fn().mockResolvedValue({ bundle_id: 'b', files: [] });
    const r = new ContractQAReporter({ artifactsRoot: '/tmp', writer });
    const fakeResult = {
      status: 'failed',
      errors: [{ message: 'INV-A2 violated' }],
      attachments: [
        { name: 'evidence:state-diff', path: sd, contentType: 'application/json' },
        { name: 'evidence:trace', path: trace, contentType: 'application/zip' },
      ],
    };
    const fakeTest = { title: 'INV-A2: logout' };
    await (r as unknown as { onTestEnd(t: unknown, r: unknown): Promise<void> }).onTestEnd(
      fakeTest,
      fakeResult,
    );
    expect(writer).toHaveBeenCalled();
    const arg = writer.mock.calls[0]![0];
    expect(arg.contractId).toBe('INV-A2');
    expect(Object.keys(arg.files)).toContain('diffs/state-diff.json');
    expect(Object.keys(arg.files)).toContain('trace.zip');
  });

  it('skips PASS tests', async () => {
    const writer = vi.fn();
    const r = new ContractQAReporter({ artifactsRoot: '/tmp', writer });
    await (r as unknown as { onTestEnd(t: unknown, r: unknown): Promise<void> }).onTestEnd(
      { title: 'INV-A2: ok' },
      { status: 'passed', attachments: [] },
    );
    expect(writer).not.toHaveBeenCalled();
  });
});
