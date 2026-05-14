import { describe, it, expect } from 'vitest';
import { selectChangedContracts } from '../src/commands/run.js';
import type { ContractDoc } from '@contractqa/core';

const contracts = [
  { id: 'INV-A2', area: 'auth', risk_tags: ['auth', 'protected-route'] },
  { id: 'INV-L1', area: 'lobby', risk_tags: ['lobby'] },
  { id: 'INV-B1', area: 'billing', risk_tags: ['billing'] },
] as unknown as ContractDoc[];

describe('selectChangedContracts', () => {
  it('returns auth contracts when src/auth/ changed', () => {
    const sel = selectChangedContracts(contracts, ['src/auth/AuthProvider.tsx']);
    expect(sel.map((c) => c.id)).toEqual(['INV-A2']);
  });
  it('returns all when no files changed (safety default)', () => {
    expect(selectChangedContracts(contracts, []).length).toBe(3);
  });
  it('returns multi-area when several paths changed', () => {
    const sel = selectChangedContracts(contracts, ['src/auth/x.ts', 'app/lobby/page.tsx']);
    expect(sel.map((c) => c.id).sort()).toEqual(['INV-A2', 'INV-L1']);
  });
});
