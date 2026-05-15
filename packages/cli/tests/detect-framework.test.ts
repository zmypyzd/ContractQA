import { describe, it, expect } from 'vitest';
import { detectFramework } from '../src/init/detect-framework.js';

describe('detectFramework', () => {
  it('detects Next.js app-router by next.config + app/ + dep', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '^15.0.0' } },
      files: ['next.config.ts', 'app/page.tsx', 'app/layout.tsx'],
    });
    expect(r.framework).toBe('next-app');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.evidence).toContain('next.config.ts present');
  });

  it('detects Vite + React via vite.config + dep', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { vite: '^5', react: '^18' } },
      files: ['vite.config.ts', 'src/App.tsx'],
    });
    expect(r.framework).toBe('vite-react');
  });

  it('detects Vite + Vue', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { vite: '^5', vue: '^3' } },
      files: ['vite.config.ts', 'src/App.vue'],
    });
    expect(r.framework).toBe('vite-vue');
  });

  it('returns unknown with confidence 0 when nothing matches', async () => {
    const r = await detectFramework({ packageJson: {}, files: ['index.html'] });
    expect(r.framework).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('detects NextAuth in deps as auth-signal', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '^15', 'next-auth': '^5' } },
      files: ['next.config.ts', 'app/page.tsx'],
    });
    expect(r.framework).toBe('next-app');
    expect(r.authSignals).toContain('next-auth');
  });

  it('detects Supabase via @supabase/supabase-js', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { vite: '^5', react: '^18', '@supabase/supabase-js': '^2' } },
      files: ['vite.config.ts'],
    });
    expect(r.authSignals).toContain('supabase');
  });

  it('detects Next.js app-router with src/app layout', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '^16.0.0' } },
      files: ['next.config.ts', 'src/app/page.tsx', 'src/app/layout.tsx'],
    });
    expect(r.framework).toBe('next-app');
    expect(r.evidence).toContain('src/app/ directory present');
  });

  it('detects Next.js pages-router with src/pages layout', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '^14.0.0' } },
      files: ['next.config.ts', 'src/pages/index.tsx', 'src/pages/about.tsx'],
    });
    expect(r.framework).toBe('next-pages');
  });

  it('flags custom-cookie when bcryptjs is in deps', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*', bcryptjs: '^3.0.0' } },
      files: ['package.json', 'middleware.ts'],
    });
    expect(r.authSignals).toContain('custom-cookie');
  });

  it('flags custom-cookie when bcrypt is in deps', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*', bcrypt: '^5.0.0' } },
      files: ['package.json', 'middleware.ts'],
    });
    expect(r.authSignals).toContain('custom-cookie');
  });

  it('does not flag custom-cookie when neither bcrypt variant is present', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*' } },
      files: ['package.json'],
    });
    expect(r.authSignals).not.toContain('custom-cookie');
  });

  it('flags custom-cookie when bcryptjs + middleware.ts both present', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*', bcryptjs: '^3.0.0' } },
      files: ['package.json', 'middleware.ts'],
    });
    expect(r.authSignals).toContain('custom-cookie');
  });

  it('flags custom-cookie when bcrypt + app/api route handler both present', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*', bcrypt: '^5.0.0' } },
      files: ['package.json', 'app/api/login/route.ts'],
    });
    expect(r.authSignals).toContain('custom-cookie');
  });

  it('does NOT flag custom-cookie when bcryptjs is present without middleware/route', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*', bcryptjs: '^3.0.0' } },
      files: ['package.json'],
    });
    expect(r.authSignals).not.toContain('custom-cookie');
  });

  it('flags custom-cookie when bcrypt + pages/api route handler both present', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '*', bcrypt: '^5.0.0' } },
      files: ['package.json', 'pages/api/login.ts'],
    });
    expect(r.authSignals).toContain('custom-cookie');
  });
});
