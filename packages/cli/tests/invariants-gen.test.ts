import { describe, it, expect } from 'vitest';
import { renderInvariantsMd } from '../src/commands/invariants-gen.js';
import type { ContractDoc } from '@contractqa/core';

describe('renderInvariantsMd', () => {
  it('groups contracts by area with id and title bullets', () => {
    const md = renderInvariantsMd([
      { id: 'INV-A1', title: 'logout clears sb-* keys', area: 'auth', severity: 'P0' } as unknown as ContractDoc,
      { id: 'INV-A2', title: 'protected route redirects', area: 'auth', severity: 'P0' } as unknown as ContractDoc,
      { id: 'INV-L1', title: 'create table broadcasts', area: 'lobby', severity: 'P1' } as unknown as ContractDoc,
    ]);
    expect(md).toMatch(/^# Product Invariants/m);
    expect(md).toMatch(/^## Auth/m);
    expect(md).toMatch(/- INV-A1: logout clears sb-\* keys/);
    expect(md).toMatch(/## Lobby/);
  });
});
