import { describe, it, expect } from 'vitest';
import { PostgresBackendAdapter } from '../src/backend/postgres.js';

describe('PostgresBackendAdapter — tenant scope', () => {
  it('throws when query is called without tenant field in params', async () => {
    const a = new PostgresBackendAdapter({
      dsn: 'postgres://nowhere',
      tenantField: 'user_id',
      namedQueries: {
        pendingHands: {
          description: 'pending hands for a user',
          sql: 'SELECT id FROM hands WHERE user_id = $1',
          params: { user_id: '$1' },
        },
      },
    });
    await expect(a.query('pendingHands', {})).rejects.toThrow(/tenant field "user_id"/);
    await expect(a.query('pendingHands', { other: 'x' })).rejects.toThrow(/tenant field "user_id"/);
  });

  it('throws when named query does not exist', async () => {
    const a = new PostgresBackendAdapter({
      dsn: 'postgres://nowhere',
      tenantField: 'user_id',
      namedQueries: {},
    });
    await expect(a.query('nonexistent', { user_id: 'u1' })).rejects.toThrow(/no named query "nonexistent"/);
  });
});
