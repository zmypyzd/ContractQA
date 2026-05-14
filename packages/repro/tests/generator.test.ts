import { describe, it, expect } from 'vitest';
import { generateRepro } from '../src/generator.js';
import type { ContractDoc } from '@contractqa/core';

const c = {
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
  expected: { url: { matches: '^/login' }, auth_state: { fully_logged_out: true } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
} as unknown as ContractDoc;

describe('generateRepro', () => {
  it('emits Playwright test asserting expected, not actual', () => {
    const src = generateRepro({ contract: c, authProvider: 'supabase' });
    expect(src).toContain("import { test, expect } from '@playwright/test'");
    expect(src).toContain("loginAs(page, 'normal_user')");
    expect(src).toContain("await page.goto('/lobby')");
    expect(src).toContain("await page.goto('/agents')");
    expect(src).toContain('await expect(page).toHaveURL(/^\\/login/);');
    expect(src).toContain('SupabaseAuthAdapter');
    expect(src).not.toContain('// FIXME');
  });
});
