import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

/**
 * @experimental Phase 4 will fill in the body. Currently throws on every method.
 * Exported via @contractqa/adapters/public so consumers can prepare for it,
 * but should NOT be relied on for production code.
 */
export class PostgresBackendAdapter implements BackendAdapter {
  readonly kind = 'postgres' as const;
  describe(): SchemaDescriptor { throw new Error('PostgresBackendAdapter is a Phase 4 stub; not yet implemented'); }
  async query(): Promise<unknown> { throw new Error('PostgresBackendAdapter is a Phase 4 stub; not yet implemented'); }
}
