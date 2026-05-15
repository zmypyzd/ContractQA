import { describe, it, expect, vi } from 'vitest';
import { MongoBackendAdapter } from '../src/backend/mongo.js';

const baseOpts = {
  uri: 'mongodb://x',
  database: 'test',
  tenantField: 'user_id',
  namedQueries: {
    q: {
      description: '',
      collection: 'r',
      operation: 'find' as const,
      filter: { user_id: '$1' },
      params: { user_id: '$1' },
    },
  },
};

describe('MongoBackendAdapter — lifecycle edge cases', () => {
  it('retries after a previous db() failure (reject-recovery)', async () => {
    let dbCalls = 0;
    const flakyClient = {
      db: vi.fn(() => {
        if (dbCalls++ === 0) throw new Error('transient ECONNREFUSED');
        return {
          collection: vi.fn(() => ({
            find: vi.fn(() => ({ toArray: vi.fn(async () => [{ ok: true }]) })),
          })),
        };
      }),
      close: vi.fn(async () => {}),
    };

    const adapter = new MongoBackendAdapter({
      ...baseOpts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _clientOverride: flakyClient as any,
    });

    await expect(adapter.query('q', { user_id: 'u' })).rejects.toThrow(/ECONNREFUSED/);
    // Retry: second call should succeed because connectingP was cleared.
    const rows = await adapter.query('q', { user_id: 'u' });
    expect(rows).toEqual([{ ok: true }]);
  });

  it('post-close query throws', async () => {
    const client = {
      db: vi.fn(() => ({
        collection: vi.fn(() => ({
          find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
        })),
      })),
      close: vi.fn(async () => {}),
    };
    const adapter = new MongoBackendAdapter({
      ...baseOpts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _clientOverride: client as any,
    });
    await adapter.query('q', { user_id: 'u' });
    await adapter.close();
    await expect(adapter.query('q', { user_id: 'u' })).rejects.toThrow(/closed/i);
  });

  it('close() waits for in-flight queries to drain before closing client', async () => {
    let resolveToArray: (rows: unknown[]) => void = () => {};
    const slowToArray = vi.fn(() => new Promise<unknown[]>((res) => { resolveToArray = res; }));
    const client = {
      db: vi.fn(() => ({
        collection: vi.fn(() => ({
          find: vi.fn(() => ({ toArray: slowToArray })),
        })),
      })),
      close: vi.fn(async () => {}),
    };
    const adapter = new MongoBackendAdapter({
      uri: 'mongodb://x',
      database: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: { description: '', collection: 'r', operation: 'find', filter: { user_id: '$1' }, params: { user_id: '$1' } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _clientOverride: client as any,
    });

    const queryP = adapter.query('q', { user_id: 'u' });
    const closeP = adapter.close();

    await new Promise((r) => setTimeout(r, 30));
    expect(client.close).not.toHaveBeenCalled();

    resolveToArray([{ ok: true }]);
    const rows = await queryP;
    expect(rows).toEqual([{ ok: true }]);
    await closeP;
    expect(client.close).toHaveBeenCalled();
  });
});
