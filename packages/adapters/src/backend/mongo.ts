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
  /**
   * Params mapping; MUST include the tenantField. Values use placeholder syntax:
   *  - `$N` (positional, e.g. `$1`, `$2`) — resolved by declaration order in this map
   *  - `:name` (named, e.g. `:user_id`) — resolved by name lookup at query time
   * Both styles can coexist within a single named query.
   */
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
  private closed = false;
  private inFlight = 0;
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
    // Check closed before incrementing so post-close callers throw immediately.
    // In-flight queries already past this point are drained by close().
    if (this.closed) throw new Error('MongoBackendAdapter is closed');
    this.inFlight++;
    try {
      const q = this.opts.namedQueries[namedQuery];
      if (!q) throw new Error(`unknown named query: ${namedQuery}`);

      const db = await this.getDb();
      const col = db.collection(q.collection);
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
        if (Array.isArray(val)) return val.map(substitute);
        if (val && typeof val === 'object') {
          return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, substitute(v)]));
        }
        return val;
      };

      if (q.operation === 'find') {
        const filter = substitute(q.filter ?? {}) as Record<string, unknown>;
        return await col.find(filter).toArray();
      } else {
        const pipeline = (substitute(q.pipeline ?? []) as Array<Record<string, unknown>>);
        return await col.aggregate(pipeline).toArray();
      }
    } finally {
      this.inFlight--;
    }
  }

  /**
   * Close the adapter. Sets a `closed` flag (post-close `query()` calls throw),
   * awaits any in-flight `connect()` promise, then drains in-flight `query()`
   * calls (up to 5s hard timeout) before terminating the underlying `MongoClient`.
   *
   * Concurrent `query()` and `close()`:
   *  - query already past `getDb()` → drained (its `toArray()` runs to completion)
   *  - query starting after `close()` flag set → throws `'is closed'`
   *
   * Idempotent — calling `close()` twice is safe.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.connectingP) {
      try { await this.connectingP; } catch { /* ignore */ }
    }
    // Drain in-flight queries (up to 5s hard timeout).
    const deadline = Date.now() + 5_000;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connectingP = null;
    }
  }

  private async getDb(): Promise<Db> {
    if (this.client) {
      return this.client.db(this.opts.database);
    }
    if (!this.connectingP) {
      this.connectingP = (async () => {
        const client = this.opts._clientOverride ?? new MongoClient(this.opts.uri);
        if (!this.opts._clientOverride) await client.connect();
        return client;
      })();
    }
    try {
      const client = await this.connectingP;
      const db = client.db(this.opts.database);
      this.client = client;
      return db;
    } catch (e) {
      this.connectingP = null;
      throw e;
    }
  }
}
