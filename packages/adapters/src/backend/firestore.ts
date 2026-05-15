import { Firestore, type Settings } from '@google-cloud/firestore';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

export type FirestoreOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

const SUPPORTED_OPS: readonly FirestoreOperator[] = [
  '==', '!=', '<', '<=', '>', '>=', 'array-contains', 'array-contains-any', 'in', 'not-in',
];

export type WhereTriple = readonly [field: string, op: FirestoreOperator, value: unknown];

export interface FirestoreNamedQuery {
  description: string;
  collection: string;
  /** Required. Each triple is `[field, op, value]`. Values use `$N` or `:name` placeholders. */
  where: WhereTriple[];
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  /** MUST include the tenantField; tenant must appear in `where` with `==` op. */
  params: Record<string, string>;
}

export interface FirestoreBackendAdapterOptions {
  projectId: string;
  tenantField: string;
  namedQueries: Record<string, FirestoreNamedQuery>;
  /** Inject a pre-built Firestore client for tests. */
  _clientOverride?: Firestore;
  /** Extra settings for the underlying Firestore client. */
  settings?: Settings;
}

/**
 * @stable since v0.11.0. Read-only Firestore-backed BackendAdapter.
 *
 * Enforces design-doc §7.6.3 safety rails:
 *  - Named queries only (no raw `.where()` chains from contracts).
 *  - Read-only (`get()` only — no `add`, `set`, `update`, `delete`, `batch`, `transaction`).
 *  - Tenant field must appear in `where` with `==` operator (construction-time check).
 *  - Supported operators: ==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in.
 */
export class FirestoreBackendAdapter implements BackendAdapter {
  readonly kind = 'firestore' as const;
  private client: Firestore | null = null;
  private opts: FirestoreBackendAdapterOptions;
  private closed = false;

  constructor(opts: FirestoreBackendAdapterOptions) {
    for (const [name, q] of Object.entries(opts.namedQueries)) {
      if (!(opts.tenantField in q.params)) {
        throw new Error(`named query "${name}": params is missing the tenant field "${opts.tenantField}"`);
      }
      // Validate operators
      for (const [, op] of q.where) {
        if (!SUPPORTED_OPS.includes(op as FirestoreOperator)) {
          throw new Error(`named query "${name}": unsupported operator "${op}"`);
        }
      }
      // Tenant scope: at least one `where` must be `[tenantField, '==', <placeholder>]`
      const tenantPlaceholder = q.params[opts.tenantField];
      const hasTenantWhere = q.where.some(([f, op, v]) =>
        f === opts.tenantField && op === '==' && v === tenantPlaceholder,
      );
      if (!hasTenantWhere) {
        const tenantAnywhere = q.where.some(([f]) => f === opts.tenantField);
        if (tenantAnywhere) {
          throw new Error(`named query "${name}": tenant field "${opts.tenantField}" must use '==' operator for scope (equality required)`);
        }
        throw new Error(`named query "${name}": tenant field "${opts.tenantField}" must appear in where (scope missing)`);
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
        params: Object.keys(q.params).reduce<Record<string, string>>((acc, k) => {
          acc[k] = q.params[k]!;
          return acc;
        }, {}),
      })),
    };
  }

  async query(namedQuery: string, params: Record<string, unknown>): Promise<unknown[]> {
    if (this.closed) throw new Error('FirestoreBackendAdapter is closed');
    const q = this.opts.namedQueries[namedQuery];
    if (!q) throw new Error(`unknown named query: ${namedQuery}`);

    const substitute = (val: unknown): unknown => {
      if (typeof val === 'string') {
        if (/^\$\d+$/.test(val)) {
          const idx = Number.parseInt(val.slice(1), 10) - 1;
          const paramName = Object.keys(q.params)[idx];
          if (!paramName) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
          return params[paramName];
        }
        if (/^:[a-zA-Z_][a-zA-Z0-9_]*$/.test(val)) {
          const name = val.slice(1);
          if (!(name in params)) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
          return params[name];
        }
      }
      return val;
    };

    const fs = await this.getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = fs.collection(q.collection);
    for (const [field, op, value] of q.where) {
      query = query.where(field, op, substitute(value));
    }
    if (q.orderBy) {
      query = query.orderBy(q.orderBy.field, q.orderBy.direction ?? 'asc');
    }
    if (q.limit !== undefined) {
      query = query.limit(q.limit);
    }
    const snap = await query.get();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.client && !this.opts._clientOverride) {
      await this.client.terminate();
    }
    this.client = null;
  }

  private async getClient(): Promise<Firestore> {
    if (!this.client) {
      this.client = this.opts._clientOverride ?? new Firestore({
        projectId: this.opts.projectId,
        ...this.opts.settings,
      });
    }
    return this.client;
  }
}
