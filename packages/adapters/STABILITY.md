# `@contractqa/adapters` Stability Policy

> This document covers adapter-specific stability notes. See the repo-wide [`STABILITY.md`](../../STABILITY.md) for the generic policy (deprecation window, what counts as a break, reporting).

## Versioned change log

### v0.4.0 — composeAuth routing (breaking for 2+ adapter compositions)

`composeAuth` now routes per-responsibility:

- `loginAs` / `isAuthenticated` → owner of `'session'` (unchanged)
- `currentUser` → owner of `'user-store'`, falling back to `'session'` (was: always session-owner)
- `expectFullyLoggedOut` → ALL adapters; AND-merges `fullyLoggedOut`, UNIONs `leaked_keys` (was: only session-owner)
- `sessionKeyPatterns` → UNION across all (unchanged)

Both routing changes were silent bugs in v0.2.x–v0.3.x — Phase 3 B4 documented and tolerated them. Single-adapter callers are unaffected. Callers composing 2+ adapters now get the documented behavior they expected; this is technically a runtime-behavior break per the policy below, but reverts to spec.

`PostgresBackendAdapter` was promoted from `@experimental` to `@stable` (real Postgres-backed implementation, read-only DSN guard, mandatory tenant scope, named-queries-only).

## Stable since v0.8.0

- `MongoBackendAdapter` — read-only Mongo `BackendAdapter`. Construction-time guards: named-queries-only, `find`/`aggregate` operations only, mandatory tenant field, forbidden operators (`$where`, `$function`, `$accumulator`, `$out`, `$merge`, `$listLocalSessions`) rejected via deep walk. Mirrors `PostgresBackendAdapter` API surface.

## Stable since v0.11.0

- `FirestoreBackendAdapter` — read-only Firestore `BackendAdapter`. Server-side via `@google-cloud/firestore`. Construction-time guards: named-queries-only with `where: [field, op, value]` triples, tenant field must appear in `where` with `==` op, supported operators whitelist (==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in). Supports both `$N` and `:name` placeholder styles (parity with `MongoBackendAdapter`). Completes the `BackendAdapter` family (Postgres + Mongo + Firestore).

## Public surface

The only stable, semver-protected surface is what is re-exported from `@contractqa/adapters/public`. Importing from `@contractqa/adapters` (root) or from any deep path is **internal** and may change without notice.

Exports marked `@stable` follow semver:

- **Patch:** bug fixes that don't change the type signature
- **Minor:** additive type changes (new methods, optional fields, new exports)
- **Major:** removals, renames, narrowing of existing types, or behavior changes that would break a consumer following the public docs

Exports marked `@experimental` may break in any minor release. They are documented in the changelog with a deprecation note when promoted to `@stable` or removed. `PostgresBackendAdapter` was promoted from `@experimental` to `@stable` in v0.4.0.
