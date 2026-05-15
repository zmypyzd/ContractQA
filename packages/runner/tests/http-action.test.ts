import { describe, it, expect, vi } from 'vitest';
import { runHttpContract } from '../src/run-contract.js';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

class FakeBackend implements BackendAdapter {
  readonly kind = 'postgres' as const;
  constructor(private rows: unknown[]) {}
  describe(): SchemaDescriptor {
    return { tenantField: 'user_id', namedQueries: [{ name: 'q', description: '', params: {} }] };
  }
  async query(): Promise<unknown[]> { return this.rows; }
}

describe('runHttpContract', () => {
  it('executes a POST and produces PASS when backend_state matches', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;

    const r = await runHttpContract({
      contract: {
        id: 'INV-HTTP',
        title: 'http test',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'POST', path: '/api/v1/rooms', body: { name: 'x' } }],
        expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 1 } } },
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
      } as any,
      backend: new FakeBackend([{ id: 'r1' }]),
      baseUrl: 'http://127.0.0.1:3287',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3287/api/v1/rooms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'x' }),
      }),
    );
    expect(r.verdict.verdict).toBe('PASS');
  });

  it('executes a GET without body', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    global.fetch = fetchMock as any;

    const r = await runHttpContract({
      contract: {
        id: 'INV-HTTP-GET',
        title: 'http get',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'GET', path: '/api/v1/rooms' }],
        expected: {},
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://127.0.0.1:3287',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3287/api/v1/rooms',
      expect.objectContaining({ method: 'GET' }),
    );
    const callArgs = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(callArgs.body).toBeUndefined();
    expect(r.verdict.verdict).toBe('PASS');
  });

  it('throws when a non-http action is present', async () => {
    await expect(runHttpContract({
      contract: {
        id: 'INV-MIX',
        title: 'mixed',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'goto', path: '/' } as any, { type: 'http', method: 'GET', path: '/api/v1/x' }],
        expected: {},
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://x',
    })).rejects.toThrow(/all actions must be http|mixed/i);
  });

  it('INCONCLUSIVE when backend_state is present but no backend provided', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    const r = await runHttpContract({
      contract: {
        id: 'INV-NB',
        title: 'no backend',
        area: 'backend',
        severity: 'P1',
        actions: [{ type: 'http', method: 'GET', path: '/api/v1/x' }],
        expected: { backend_state: { named_query: 'q', params: { user_id: 'u' }, assert: { rowCount: 0 } } },
        risk_tags: [], preconditions: {}, verification: { wait_ms: 0, retries: 0, evidence_required: [] },
      } as any,
      baseUrl: 'http://x',
    });
    expect(r.verdict.verdict).toBe('INCONCLUSIVE');
  });
});
