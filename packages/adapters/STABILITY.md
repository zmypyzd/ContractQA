# `@contractqa/adapters` Stability Policy

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

## Deprecation window

Stable exports flagged for removal MUST:

1. Get an `@deprecated` JSDoc tag in the minor that announces removal.
2. Stay available for at least one full minor cycle (six weeks or one anchor release, whichever is longer).
3. Be removed only in the next major.

The same rule applies to the type contracts re-exported from `@contractqa/core` (`AuthAdapter`, `AppAdapter`, `BackendAdapter`, etc.). Type narrowings or required-field additions count as breaking changes regardless of which package they originate in.

## What counts as a break

- Renaming a stable export.
- Removing a stable export without going through the deprecation window.
- Narrowing a stable type (e.g. changing `string` → `'a' | 'b'`).
- Changing the runtime behavior of `composeAuth`'s delegation order.
- Changing which keys `SupabaseAuthAdapter` writes to localStorage.
- Changing the cookie-name regexes inside any adapter's `sessionKeyPatterns()` in a way that would cause a previously-detected session key to be missed.
- Changing the throw-vs-return contract of any stable method (e.g., a method that currently returns `null` on miss is changed to throw).

## What does NOT count as a break

- Adding new exports.
- Adding optional fields to stable interfaces.
- Widening a stable type (e.g. `'a' | 'b'` → `string`).
- Changes to anything not re-exported from `./public`.
- Changes inside `dogfood/` or `fixtures/`.
- Tightening internal error messages.
- Performance improvements that don't observably change return values.

## Reporting a break

Open an issue tagged `breaking-change` with the version pair and a minimal repro. We aim to either revert, patch, or document the rationale + migration path within one week.

## How to consume

```ts
// Recommended — semver-stable
import { SupabaseAuthAdapter, composeAuth } from '@contractqa/adapters/public';
import type { AuthAdapter } from '@contractqa/adapters/public';

// Internal — may break in any release
import { ... } from '@contractqa/adapters';
import { ... } from '@contractqa/adapters/dist/...';
```

If a runtime symbol you depend on is only available from the root entry, that's a signal it should probably be promoted to `./public`. Open an issue.
