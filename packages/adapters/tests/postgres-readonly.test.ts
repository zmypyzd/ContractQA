import { describe, it, expect } from 'vitest';
import { PostgresBackendAdapter } from '../src/backend/postgres.js';

describe('PostgresBackendAdapter — read-only enforcement', () => {
  it('rejects INSERT in named query at construction', () => {
    expect(() => new PostgresBackendAdapter({
      dsn: 'postgres://x',
      tenantField: 'user_id',
      namedQueries: {
        bad: { description: 'bad', sql: 'INSERT INTO foo VALUES (1)', params: {} },
      },
    })).toThrow(/read-only|INSERT|SELECT|WITH/);
  });

  it('rejects UPDATE / DELETE / DROP / CREATE / TRUNCATE / GRANT', () => {
    for (const sql of ['UPDATE foo SET a=1', 'DELETE FROM foo', 'DROP TABLE foo', 'CREATE TABLE foo (a int)', 'TRUNCATE foo', 'GRANT ALL ON foo TO bar']) {
      expect(() => new PostgresBackendAdapter({
        dsn: 'postgres://x',
        tenantField: 'user_id',
        namedQueries: { bad: { description: 'bad', sql, params: {} } },
      })).toThrow();
    }
  });

  it('accepts SELECT and WITH ... SELECT', () => {
    expect(() => new PostgresBackendAdapter({
      dsn: 'postgres://x',
      tenantField: 'user_id',
      namedQueries: {
        good: { description: 'good', sql: 'SELECT * FROM hands WHERE user_id = $1', params: { user_id: '$1' } },
        cte: { description: 'cte', sql: 'WITH t AS (SELECT 1) SELECT * FROM t', params: {} },
      },
    })).not.toThrow();
  });

  it('describe() returns SchemaDescriptor with tenantField and namedQueries', () => {
    const a = new PostgresBackendAdapter({
      dsn: 'postgres://x',
      tenantField: 'user_id',
      namedQueries: {
        pendingHands: { description: 'pending hands for a user', sql: 'SELECT id FROM hands WHERE user_id = $1', params: { user_id: '$1' } },
      },
    });
    const d = a.describe();
    expect(d.tenantField).toBe('user_id');
    expect(d.namedQueries).toEqual([
      { name: 'pendingHands', description: 'pending hands for a user', params: { user_id: '$1' } },
    ]);
  });
});
