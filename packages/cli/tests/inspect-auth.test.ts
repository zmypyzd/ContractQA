import { describe, it, expect } from 'vitest';
import { inspectAuthWiring } from '../src/init/inspect-auth.js';

describe('inspectAuthWiring — path-presence per provider', () => {
  it('flags next-auth when app/api/auth/[...nextauth]/route.ts exists', () => {
    const r = inspectAuthWiring({
      files: ['app/api/auth/[...nextauth]/route.ts', 'package.json'],
      signals: ['next-auth'],
    });
    expect(r).toEqual([
      {
        provider: 'next-auth',
        depEvidence: true,
        wiringFiles: ['app/api/auth/[...nextauth]/route.ts'],
        hasMiddleware: false,
      },
    ]);
  });

  it('flags supabase via lib/supabase/server.ts + middleware.ts', () => {
    const r = inspectAuthWiring({
      files: ['lib/supabase/server.ts', 'lib/supabase/client.ts', 'middleware.ts'],
      signals: ['supabase'],
    });
    expect(r).toEqual([
      {
        provider: 'supabase',
        depEvidence: true,
        wiringFiles: ['lib/supabase/client.ts', 'lib/supabase/server.ts'],
        hasMiddleware: true,
      },
    ]);
  });

  it('returns one entry per signal even when no wiring file matches', () => {
    const r = inspectAuthWiring({
      files: ['src/main.tsx'],
      signals: ['clerk'],
    });
    expect(r).toEqual([
      { provider: 'clerk', depEvidence: true, wiringFiles: [], hasMiddleware: false },
    ]);
  });

  it('detects NextAuth pages-router route too', () => {
    const r = inspectAuthWiring({
      files: ['pages/api/auth/[...nextauth].ts'],
      signals: ['next-auth'],
    });
    expect(r[0]!.wiringFiles).toEqual(['pages/api/auth/[...nextauth].ts']);
  });

  it('detects next-auth with App Router route-groups', () => {
    const r = inspectAuthWiring({
      files: ['app/(auth)/api/auth/[...nextauth]/route.ts'],
      signals: ['next-auth'],
    });
    expect(r[0]!.wiringFiles).toEqual(['app/(auth)/api/auth/[...nextauth]/route.ts']);
  });
});
