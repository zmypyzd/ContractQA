import { describe, it, expect } from 'vitest';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

const baseOpts = {
  uri: 'mongodb://localhost:27017',
  database: 'test',
  tenantField: 'user_id',
};

describe('MongoBackendAdapter — construction guards', () => {
  it('accepts a valid find named query with tenant param', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        ok: {
          description: 'list rooms',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
    })).not.toThrow();
  });

  it('rejects a find query missing the tenant field in params', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'no tenant',
          collection: 'rooms',
          operation: 'find',
          filter: {},
          params: {},
        },
      },
    })).toThrow(/tenant/i);
  });

  it('rejects $where operator (JS injection)', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'js injection',
          collection: 'rooms',
          operation: 'find',
          filter: { $where: 'this.user_id == "x"' },
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden operator|\$where/i);
  });

  it('rejects $function operator', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'js function',
          collection: 'rooms',
          operation: 'find',
          filter: { $expr: { $function: { body: 'function() {}', args: [], lang: 'js' } } },
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden operator|\$function/i);
  });

  it('rejects aggregate pipeline with $out stage', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: '$out write',
          collection: 'rooms',
          operation: 'aggregate',
          pipeline: [{ $match: { user_id: '$1' } }, { $out: 'rooms_copy' }],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden|\$out/i);
  });

  it('rejects aggregate pipeline with $merge stage', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: '$merge write',
          collection: 'rooms',
          operation: 'aggregate',
          pipeline: [{ $merge: { into: 'rooms_copy' } }],
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/forbidden|\$merge/i);
  });

  it('rejects operation type other than find / aggregate', () => {
    expect(() => new MongoBackendAdapter({
      ...baseOpts,
      namedQueries: {
        bad: {
          description: 'wrong op',
          collection: 'rooms',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          operation: 'insert' as any,
          params: { user_id: '$1' },
        },
      },
    })).toThrow(/operation/i);
  });
});
