import { describe, it, expect } from 'vitest';
import { FirestoreBackendAdapter } from '../src/backend/firestore.js';

const baseOpts = {
  projectId: 'test-project',
  tenantField: 'user_id',
};

describe('FirestoreBackendAdapter — construction guards', () => {
  it('accepts a valid query with tenant where-clause', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        ok: {
          description: 'rooms by owner',
          collection: 'rooms',
          where: [['user_id', '==', '$1']],
          params: { user_id: '$1' },
        },
      },
    })).not.toThrow();
  });

  it('accepts :name-style placeholder in tenant where', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        ok: {
          description: 'rooms by owner',
          collection: 'rooms',
          where: [['user_id', '==', ':user_id']],
          params: { user_id: ':user_id' },
        },
      },
    })).not.toThrow();
  });

  it('rejects a query missing the tenant field in params', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'no tenant',
          collection: 'rooms',
          where: [['status', '==', 'active']],
          params: {},
        },
      },
    })).toThrow(/tenant/i);
  });

  it('rejects a query that declares tenant in params but does not include it in where', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'unscoped',
          collection: 'rooms',
          where: [['status', '==', 'active']],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/tenant.*where|where.*tenant|scope/i);
  });

  it('rejects tenant scoped with a non-equality operator', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'wrong op for tenant',
          collection: 'rooms',
          where: [['user_id', '!=', '$1']],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/tenant.*==|equality/i);
  });

  it('rejects unsupported operator in where', () => {
    expect(() => new FirestoreBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'unknown op',
          collection: 'rooms',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: [['user_id', 'bogus' as any, '$1']],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/unsupported operator/i);
  });
});
