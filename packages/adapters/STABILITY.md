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

## Experimental at v1.0.0 (shipped v0.11.0)

- `FirestoreBackendAdapter` — read-only Firestore `BackendAdapter`. Server-side via `@google-cloud/firestore`. Construction-time guards: named-queries-only with `where: [field, op, value]` triples, tenant field must appear in `where` with `==` op, supported operators whitelist (==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in). Supports both `$N` and `:name` placeholder styles (parity with `MongoBackendAdapter`). Completes the `BackendAdapter` family (Postgres + Mongo + Firestore). **Status: `@experimental`** — the API may change in any minor release until a real-Firestore-emulator integration test lands. Mocked-only tests today.

## Public surface

The semver-protected surface is documented in [README.md](./README.md) and the repo-level [`STABILITY.md`](../../STABILITY.md).
