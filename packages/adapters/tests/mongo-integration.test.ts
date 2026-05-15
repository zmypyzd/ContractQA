import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

const SKIP = process.env['MONGOMS_SKIP'] === '1';

(SKIP ? describe.skip : describe)('MongoBackendAdapter — real-Mongo integration', () => {
  let mongod: MongoMemoryServer;
  let adapter: MongoBackendAdapter;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();

    const client = new MongoClient(uri);
    await client.connect();
    await client.db('test').collection('rooms').insertMany([
      { _id: 'r1' as any, user_id: 'u-1', status: 'active' },
      { _id: 'r2' as any, user_id: 'u-2', status: 'active' },
    ]);
    await client.close();

    adapter = new MongoBackendAdapter({
      uri,
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms owned by user',
          collection: 'rooms',
          operation: 'find',
          filter: { user_id: '$1' },
          params: { user_id: '$1' },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (adapter) await adapter.close();
    if (mongod) await mongod.stop();
  });

  it('find returns only docs matching the tenant scope', async () => {
    const rows = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).user_id).toBe('u-1');
  });

  it('find returns empty when no docs match', async () => {
    const rows = await adapter.query('roomsByOwner', { user_id: 'u-nobody' });
    expect(rows).toEqual([]);
  });
});
