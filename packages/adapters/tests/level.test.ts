import { describe, it, expect } from 'vitest';
import { computeAdapterLevel } from '../src/level.js';
import { DefaultAppAdapter, SupabaseAuthAdapter } from '../src/index.js';

describe('computeAdapterLevel', () => {
  it('L0 with only AppAdapter', () => {
    const app = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    expect(computeAdapterLevel({ app })).toBe('L0');
  });
  it('L1 with AppAdapter + AuthAdapter', () => {
    const app = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    const auth = new SupabaseAuthAdapter({ url: '', anonKey: '' });
    expect(computeAdapterLevel({ app, auth })).toBe('L1');
  });
  it('L2 with BackendAdapter included', () => {
    const app = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    const auth = new SupabaseAuthAdapter({ url: '', anonKey: '' });
    const backend = {
      kind: 'postgres' as const,
      describe: () => ({ namedQueries: [], tenantField: null }),
      query: async () => null,
    };
    expect(computeAdapterLevel({ app, auth, backend })).toBe('L2');
  });
});
