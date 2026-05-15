import { describe, it, expect, vi } from 'vitest';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

function mockClient(rows: unknown[]) {
  const toArray = vi.fn(async () => rows);
  const find = vi.fn(() => ({ toArray }));
  const aggregate = vi.fn(() => ({ toArray }));
  const collection = vi.fn(() => ({ find, aggregate }));
  const db = vi.fn(() => ({ collection }));
  const close = vi.fn(async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db, close, _spies: { find, aggregate, toArray, collection } } as any;
}

describe('MongoBackendAdapter — query path', () => {
  it('find substitutes $1 with params[firstName] and returns rows', async () => {
    const client = mockClient([{ _id: 'r1', user_id: 'u-1' }]);
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
      _clientOverride: client,
    });
    const r = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(r).toEqual([{ _id: 'r1', user_id: 'u-1' }]);
    expect(client._spies.find).toHaveBeenCalledWith({ user_id: 'u-1' });
  });

  it('aggregate substitutes deep within pipeline stages', async () => {
    const client = mockClient([{ _id: 'r1' }]);
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        countByOwner: {
          description: 'count',
          collection: 'rooms',
          operation: 'aggregate',
          pipeline: [{ $match: { user_id: '$1' } }, { $count: 'n' }],
          params: { user_id: '$1' },
        },
      },
      _clientOverride: client,
    });
    await adapter.query('countByOwner', { user_id: 'u-1' });
    expect(client._spies.aggregate).toHaveBeenCalledWith([
      { $match: { user_id: 'u-1' } },
      { $count: 'n' },
    ]);
  });

  it('throws on unknown named query', async () => {
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        ok: { description: '', collection: 'r', operation: 'find', filter: { user_id: '$1' }, params: { user_id: '$1' } },
      },
      _clientOverride: mockClient([]),
    });
    await expect(adapter.query('missing', { user_id: 'u' })).rejects.toThrow(/unknown named query/);
  });

  it('substitutes :name-style placeholder by looking up params[name]', async () => {
    const client = mockClient([{ _id: 'r1', user_id: 'u-1' }]);
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: ':user_id' },
          params: { user_id: ':user_id' },
        },
      },
      _clientOverride: client,
    });
    const r = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(r).toEqual([{ _id: 'r1', user_id: 'u-1' }]);
    expect(client._spies.find).toHaveBeenCalledWith({ user_id: 'u-1' });
  });

  it('mixed $N and :name placeholders both substitute correctly', async () => {
    const client = mockClient([]);
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        mix: {
          description: '',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: ':user_id', status: '$2' },
          params: { user_id: ':user_id', status: '$2' },
        },
      },
      _clientOverride: client,
    });
    await adapter.query('mix', { user_id: 'u-1', status: 'active' });
    expect(client._spies.find).toHaveBeenCalledWith({ user_id: 'u-1', status: 'active' });
  });
});
