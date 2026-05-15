import { describe, it, expect, vi } from 'vitest';
import { FirestoreBackendAdapter } from '../src/backend/firestore.js';

function mockFirestore(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const get = vi.fn(async () => ({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { get };
  const where = vi.fn(() => chain);
  const orderBy = vi.fn(() => chain);
  const limit = vi.fn(() => chain);
  chain.where = where;
  chain.orderBy = orderBy;
  chain.limit = limit;
  const collection = vi.fn(() => chain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { collection, _spies: { where, orderBy, limit, get } } as any;
}

describe('FirestoreBackendAdapter — query path', () => {
  it('find substitutes $N placeholder and returns docs with id merged', async () => {
    const fs = mockFirestore([{ id: 'r1', data: { user_id: 'u-1', status: 'active' } }]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        roomsByOwner: {
          description: 'rooms',
          collection: 'rooms',
          where: [['user_id', '==', '$1']],
          params: { user_id: '$1' },
        },
      },
      _clientOverride: fs,
    });
    const r = await adapter.query('roomsByOwner', { user_id: 'u-1' });
    expect(r).toEqual([{ id: 'r1', user_id: 'u-1', status: 'active' }]);
    expect(fs._spies.where).toHaveBeenCalledWith('user_id', '==', 'u-1');
  });

  it('substitutes :name-style placeholder', async () => {
    const fs = mockFirestore([]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: {
          description: '',
          collection: 'rooms',
          where: [['user_id', '==', ':user_id']],
          params: { user_id: ':user_id' },
        },
      },
      _clientOverride: fs,
    });
    await adapter.query('q', { user_id: 'u-1' });
    expect(fs._spies.where).toHaveBeenCalledWith('user_id', '==', 'u-1');
  });

  it('applies orderBy + limit when present', async () => {
    const fs = mockFirestore([]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: {
          description: '',
          collection: 'rooms',
          where: [['user_id', '==', '$1']],
          orderBy: { field: 'created_at', direction: 'desc' },
          limit: 10,
          params: { user_id: '$1' },
        },
      },
      _clientOverride: fs,
    });
    await adapter.query('q', { user_id: 'u-1' });
    expect(fs._spies.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(fs._spies.limit).toHaveBeenCalledWith(10);
  });

  it('throws on unknown named query', async () => {
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        ok: { description: '', collection: 'r', where: [['user_id', '==', '$1']], params: { user_id: '$1' } },
      },
      _clientOverride: mockFirestore([]),
    });
    await expect(adapter.query('missing', { user_id: 'u' })).rejects.toThrow(/unknown named query/);
  });

  it('post-close query throws', async () => {
    const fs = mockFirestore([]);
    const adapter = new FirestoreBackendAdapter({
      projectId: 'test',
      tenantField: 'user_id',
      namedQueries: {
        q: { description: '', collection: 'r', where: [['user_id', '==', '$1']], params: { user_id: '$1' } },
      },
      _clientOverride: fs,
    });
    await adapter.query('q', { user_id: 'u' });
    await adapter.close();
    await expect(adapter.query('q', { user_id: 'u' })).rejects.toThrow(/closed/i);
  });
});
