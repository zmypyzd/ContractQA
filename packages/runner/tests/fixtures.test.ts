import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOracle } from '../src/fixtures.js';
import type { ContractDoc } from '@contractqa/core';

const NOISE = {
  project: 'x',
  generated_at: '2026-05-14T00:00:00Z',
  ignore: {
    localStorage_keys: [],
    sessionStorage_keys: [],
    cookies: [],
    network_url_patterns: [],
    console_patterns: [],
  },
};

describe('runOracle', () => {
  it('returns FAIL and attaches state-diff when expectations violated', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cqa-fx-'));
    const attach = vi.fn();
    const contract = {
      id: 'INV-A2',
      title: 'x',
      area: 'auth',
      severity: 'P0',
      risk_tags: [],
      preconditions: {},
      actions: [],
      expected: { url: { matches: '^/login$' } },
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    const r = await runOracle({
      contract,
      before: { url: '/x', localStorageKeys: [], cookies: [] },
      after: { url: '/agents', localStorageKeys: [], cookies: [] },
      noise: NOISE,
      missingCapabilities: [],
      attach,
      tmpDir: dir,
    });
    expect(r.verdict).toBe('FAIL');
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'evidence:state-diff', path: expect.any(String) }),
    );
  });
});
