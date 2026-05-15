import { describe, it, expect } from 'vitest';
import * as Public from '../src/public.js';

describe('@contractqa/adapters/public surface', () => {
  it('exports the documented stable runtime API and nothing else', () => {
    // Types are erased at runtime; we only enumerate runtime exports here.
    // If you add an export to public.ts, you MUST update this list (intentional).
    const expected = new Set([
      'NextAuthAdapter',
      'SupabaseAuthAdapter',
      'CustomCookieAuthAdapter',
      'composeAuth',
      'PostgresBackendAdapter',
      'MongoBackendAdapter',
    ]);
    const actual = new Set(Object.keys(Public));
    // Reveal both missing and extra entries clearly.
    const missing = [...expected].filter((k) => !actual.has(k));
    const extra = [...actual].filter((k) => !expected.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
