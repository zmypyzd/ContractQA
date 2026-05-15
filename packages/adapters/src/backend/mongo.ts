import { MongoClient, type Db } from 'mongodb';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

export interface MongoNamedQuery {
  description: string;
  collection: string;
  operation: 'find' | 'aggregate';
  /** For operation='find'. */
  filter?: Record<string, unknown>;
  /** For operation='aggregate'. Array of stages. */
  pipeline?: Array<Record<string, unknown>>;
  /** Params mapping; MUST include the tenantField. Values use `$1`-style placeholders. */
  params: Record<string, string>;
}

export interface MongoBackendAdapterOptions {
  uri: string;
  database: string;
  tenantField: string;
  namedQueries: Record<string, MongoNamedQuery>;
  /** For tests — inject a pre-built client instead of opening via uri. */
  _clientOverride?: MongoClient;
}

const FORBIDDEN_OPERATORS = ['$where', '$function', '$accumulator', '$out', '$merge', '$listLocalSessions'];

function bodyReferencesPlaceholder(node: unknown, placeholder: string): boolean {
  if (typeof node === 'string') return node === placeholder;
  if (Array.isArray(node)) return node.some((n) => bodyReferencesPlaceholder(n, placeholder));
  if (node && typeof node === 'object') {
    return Object.values(node as Record<string, unknown>).some((v) => bodyReferencesPlaceholder(v, placeholder));
  }
  return false;
}

/** Deep-walk an object/array; throw if any FORBIDDEN_OPERATORS appears as a key. */
function assertNoForbiddenOperators(node: unknown, namedQueryName: string): void {
  if (Array.isArray(node)) {
    for (const item of node) assertNoForbiddenOperators(item, namedQueryName);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_OPERATORS.includes(key)) {
        throw new Error(`named query "${namedQueryName}" uses forbidden operator ${key}`);
      }
      assertNoForbiddenOperators(val, namedQueryName);
    }
  }
}

/**
 * @stable since v0.8.0. Read-only Mongo-backed BackendAdapter.
 *
 * Enforces design-doc §7.6.3 safety rails:
 *  - Named queries only (no raw operations from contracts).
 *  - find / aggregate only (no insert / update / delete / replace).
 *  - Tenant field must be present in every query's `params`.
 *  - Forbidden operators rejected at construction via deep-walk:
 *    $where, $function, $accumulator (JS execution); $out, $merge (writes);
 *    $listLocalSessions (admin).
 */
export class MongoBackendAdapter implements BackendAdapter {
  readonly kind = 'mongo' as const;
  private client: MongoClient | null = null;
  private connectingP: Promise<MongoClient> | null = null;
  private opts: MongoBackendAdapterOptions;

  constructor(opts: MongoBackendAdapterOptions) {
    for (const [name, q] of Object.entries(opts.namedQueries)) {
      if (q.operation !== 'find' && q.operation !== 'aggregate') {
        throw new Error(`named query "${name}": operation must be 'find' or 'aggregate', got '${q.operation}'`);
      }
      if (!(opts.tenantField in q.params)) {
        throw new Error(`named query "${name}": params is missing the tenant field "${opts.tenantField}"`);
      }
      if (q.operation === 'find') {
        assertNoForbiddenOperators(q.filter ?? {}, name);
      } else {
        assertNoForbiddenOperators(q.pipeline ?? [], name);
      }
      const tenantPlaceholder = q.params[opts.tenantField];
      if (tenantPlaceholder) {
        const body = q.operation === 'find' ? (q.filter ?? {}) : (q.pipeline ?? []);
        if (!bodyReferencesPlaceholder(body, tenantPlaceholder)) {
          throw new Error(`named query "${name}": tenant placeholder ${tenantPlaceholder} is declared in params but not referenced in ${q.operation === 'find' ? 'filter' : 'pipeline'}`);
        }
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
    const q = this.opts.namedQueries[namedQuery];
    if (!q) throw new Error(`unknown named query: ${namedQuery}`);

    const db = await this.getDb();
    const col = db.collection(q.collection);
    const substitute = (val: unknown): unknown => {
      if (typeof val === 'string' && /^\$\d+$/.test(val)) {
        const idx = Number.parseInt(val.slice(1), 10) - 1;
        const paramName = Object.keys(q.params)[idx];
        if (!paramName) throw new Error(`named query "${namedQuery}" placeholder ${val} has no matching param`);
        return params[paramName];
      }
      if (Array.isArray(val)) return val.map(substitute);
      if (val && typeof val === 'object') {
        return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, substitute(v)]));
      }
      return val;
    };

    if (q.operation === 'find') {
      const filter = substitute(q.filter ?? {}) as Record<string, unknown>;
      return col.find(filter).toArray();
    } else {
      const pipeline = (substitute(q.pipeline ?? []) as Array<Record<string, unknown>>);
      return col.aggregate(pipeline).toArray();
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connectingP = null;
    }
  }

  private async getDb(): Promise<Db> {
    if (!this.client) {
      if (!this.connectingP) {
        this.connectingP = (async () => {
          const client = this.opts._clientOverride ?? new MongoClient(this.opts.uri);
          if (!this.opts._clientOverride) await client.connect();
          return client;
        })();
      }
      this.client = await this.connectingP;
    }
    return this.client.db(this.opts.database);
  }
}
