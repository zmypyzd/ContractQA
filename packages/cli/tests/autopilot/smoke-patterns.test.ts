// packages/cli/tests/autopilot/smoke-patterns.test.ts
import { describe, it, expect } from 'vitest';
import { SMOKE_PATTERNS, applicablePatterns } from '../../src/autopilot/smoke-patterns.js';
import type { TargetContext } from '../../src/autopilot/bootstrap.js';

function ctx(overrides: Partial<TargetContext> = {}): TargetContext {
  return {
    cwd: '/tmp/fake',
    framework: 'next-app',
    authProvider: 'supabase',
    routes: ['/'],
    testCredentials: { source: 'none' },
    envFiles: [],
    ...overrides,
  };
}

describe('smoke-patterns', () => {
  it('SMOKE_PATTERNS has 6 entries', () => {
    expect(SMOKE_PATTERNS.length).toBe(6);
    const ids = SMOKE_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(6); // unique
  });

  it('applicablePatterns includes SMOKE-root-not-500 for any framework', () => {
    const patterns = applicablePatterns(ctx({ framework: 'unknown' }));
    expect(patterns.find((p) => p.id === 'SMOKE-root-not-500')).toBeDefined();
  });

  it('SMOKE-logout-clears-keys only applies when auth provider is known', () => {
    const withAuth = applicablePatterns(ctx({ authProvider: 'supabase', testCredentials: { source: 'env', email: 'x@x', password: 'p' } }));
    const withoutAuth = applicablePatterns(ctx({ authProvider: 'unknown' }));
    expect(withAuth.find((p) => p.id === 'SMOKE-logout-clears-keys')).toBeDefined();
    expect(withoutAuth.find((p) => p.id === 'SMOKE-logout-clears-keys')).toBeUndefined();
  });

  it('SMOKE-logout-clears-keys requires credentials', () => {
    const noCreds = applicablePatterns(ctx({ authProvider: 'supabase', testCredentials: { source: 'none' } }));
    expect(noCreds.find((p) => p.id === 'SMOKE-logout-clears-keys')).toBeUndefined();
    const withCreds = applicablePatterns(ctx({ authProvider: 'supabase', testCredentials: { source: 'env', email: 'x@x', password: 'p' } }));
    expect(withCreds.find((p) => p.id === 'SMOKE-logout-clears-keys')).toBeDefined();
  });

  it('every pattern generate() returns valid YAML-loadable structure', () => {
    for (const p of SMOKE_PATTERNS) {
      const spec = p.generate(ctx());
      expect(typeof spec).toBe('object');
      expect(spec.id).toMatch(/^SMOKE-/);
      expect(spec.actions).toBeDefined();
      expect(spec.expected).toBeDefined();
    }
  });
});
