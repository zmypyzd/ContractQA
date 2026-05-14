import { describe, it, expect, vi } from 'vitest';
import { compileContract, type CompiledPage } from '../src/compile.js';
import type { ContractDoc } from '@contractqa/core';

const contract = {
  id: 'INV-A2',
  title: 'logout blocks /agents',
  area: 'auth',
  severity: 'P0',
  risk_tags: [],
  preconditions: { auth_state: 'logged_in', role: 'normal_user' },
  actions: [
    { type: 'goto', path: '/lobby' },
    { type: 'click', target: { role: 'button', name_regex: 'logout' } },
    { type: 'goto', path: '/agents' },
  ],
  expected: { url: { matches: '^/login' } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
} as unknown as ContractDoc;

describe('compileContract', () => {
  it('returns a thunk that performs actions in order', async () => {
    const calls: string[] = [];
    const page: CompiledPage = {
      goto: vi.fn(async (p: string) => {
        calls.push(`goto:${p}`);
        return undefined;
      }),
      getByRole: () => ({
        click: vi.fn(async () => {
          calls.push('click');
        }),
        fill: vi.fn(async () => undefined),
      }),
      url: () => '/login',
      waitForTimeout: vi.fn(async () => undefined),
    };
    const thunk = compileContract(contract);
    await thunk({
      page,
      snapshot: async () => ({ url: '/login', localStorageKeys: [], cookies: [] }),
    });
    expect(calls).toEqual(['goto:/lobby', 'click', 'goto:/agents']);
  });
});
