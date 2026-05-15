import { Pool } from 'pg';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

export interface NamedQuery {
  description: string;
  sql: string;
  params: Record<string, string>;
}

export interface PostgresBackendAdapterOptions {
  dsn: string;
  tenantField: string;
  namedQueries: Record<string, NamedQuery>;
}

const READ_VERBS = /^(SELECT|WITH)\b/i;

// Postgres allows DML inside CTEs: `WITH del AS (DELETE FROM t WHERE …) SELECT …`.
// The READ_VERBS check passes such statements at the top level, so we also
// reject any DML/DDL keyword token anywhere in the body. False-positive risk
// on string literals (e.g. SELECT 'INSERT INTO foo') is accepted — a contract
// asserting on user-controlled SQL fragments is itself a smell.
const FORBIDDEN_DML_DDL = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|MERGE|CALL|DO)\b/i;

/**
 * @stable since v0.4.0. Read-only Postgres-backed BackendAdapter.
 *
 * Enforces design-doc §7.6.3 safety rails:
 *  - Named queries only (no raw SQL from contracts).
 *  - SELECT/WITH only (statement-type guarded at construction).
 *  - Tenant field must be present in every query's params.
 */
export class PostgresBackendAdapter implements BackendAdapter {
  readonly kind = 'postgres' as const;
  private pool: Pool | null = null;
  private opts: PostgresBackendAdapterOptions;

  constructor(opts: PostgresBackendAdapterOptions) {
    for (const [name, q] of Object.entries(opts.namedQueries)) {
      const trimmed = q.sql.trim().replace(/^\(/, '');
      if (!READ_VERBS.test(trimmed)) {
        throw new Error(
          `PostgresBackendAdapter: named query "${name}" must start with SELECT or WITH; got: ${trimmed.slice(0, 40)}…`,
        );
      }
      if (FORBIDDEN_DML_DDL.test(trimmed)) {
        throw new Error(
          `PostgresBackendAdapter: named query "${name}" contains a DML/DDL token (INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE/GRANT/REVOKE/MERGE/CALL/DO); writable CTEs are rejected.`,
        );
      }
    }
    this.opts = opts;
  }

  describe(): SchemaDescriptor {
    return {
      tenantField: this.opts.tenantField,
      namedQueries: Object.entries(this.opts.namedQueries).map(([name, q]) => ({
        name,
        description: q.description,
        params: q.params,
      })),
    };
  }

  async query(name: string, params: Record<string, unknown>): Promise<unknown[]> {
    const q = this.opts.namedQueries[name];
    if (!q) throw new Error(`PostgresBackendAdapter: no named query "${name}"`);
    if (params[this.opts.tenantField] === undefined) {
      throw new Error(
        `PostgresBackendAdapter: named query "${name}" requires tenant field "${this.opts.tenantField}" in params`,
      );
    }
    if (!this.pool) this.pool = new Pool({ connectionString: this.opts.dsn });
    const ordered = Object.keys(q.params).map((k) => params[k]);
    const r = await this.pool.query({ text: q.sql, values: ordered });
    return r.rows;
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }
}
