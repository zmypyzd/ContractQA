import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/init/templates/index.js';

describe('renderTemplate', () => {
  it('renders Next.js app-router with NextAuth signal', () => {
    const t = renderTemplate({
      framework: 'next-app',
      authSignals: ['next-auth'],
      projectName: 'demo',
    });
    expect(t.files['contractqa.config.ts']).toContain("provider: 'next-auth'");
    expect(t.files['qa/contracts/smoke.contract.yaml']).toContain('name: smoke');
    expect(t.files['qa/adapters/app.ts']).toContain("baseUrl: 'http://localhost:3000'");
  });

  it('renders Vite + React with Supabase signal', () => {
    const t = renderTemplate({
      framework: 'vite-react',
      authSignals: ['supabase'],
      projectName: 'demo',
    });
    expect(t.files['contractqa.config.ts']).toContain("provider: 'supabase'");
    expect(t.files['qa/adapters/auth.ts']).toContain('SupabaseAuthAdapter');
  });

  it('renders unknown framework with custom-cookie fallback', () => {
    const t = renderTemplate({
      framework: 'unknown',
      authSignals: [],
      projectName: 'demo',
    });
    expect(t.files['contractqa.config.ts']).toContain("provider: 'custom'");
  });

  it('renders Vite + Vue with no-auth render-only smoke', () => {
    const t = renderTemplate({
      framework: 'vite-vue',
      authSignals: [],
      projectName: 'demo',
    });
    expect(t.files['qa/contracts/smoke.contract.yaml']).toContain('# no auth detected');
  });
});
