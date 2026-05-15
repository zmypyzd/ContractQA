# ContractQA stability policy

> v1.0.0 semver surface and stability tags. This document is the canonical
> policy for the whole monorepo; adapter-specific change history lives in
> [`packages/adapters/STABILITY.md`](./packages/adapters/STABILITY.md).

## Overview

ContractQA reached v1.0.0 after twelve consecutive minor releases (v0.5.0 → v0.12.0) shipped with zero breaking changes since v0.4.0. From v1.0.0 onward, the public surface is frozen under semver:

- **Patch (1.x.y):** bug fixes; no type-signature change on the public surface.
- **Minor (1.x.0):** additive — new exports, new optional fields, new methods.
- **Major (2.0.0):** removals, renames, narrowings, runtime-behaviour changes that would break a consumer following the public docs.

## Public packages

Two packages are part of the public, semver-protected surface:

- **`contractqa`** (the CLI) — command names, flag names, and stdout contract.
- **`@contractqa/adapters/public`** — only the subpath export `./public` is public. The root entry (`@contractqa/adapters`) is internal.

A third runtime entry point is public but `@experimental` at v1.0.0:

- **`@contractqa/runner/http`** — the HTTP-only subpath for `runHttpContract`. The function signature may change in any minor release; promotions and removals will be called out in the changelog.

## Internal packages

The following packages are **published** so that npm can resolve the CLI's runtime dependencies, but their root entries are NOT semver-protected and may change in any minor release:

- `@contractqa/core`
- `@contractqa/runner` (the root barrel; the `/http` subpath is public-experimental as noted above)
- `@contractqa/oracle`
- `@contractqa/evidence`
- `@contractqa/probes`
- `@contractqa/orchestrator`
- `@contractqa/repro`

If your code imports directly from any of these packages' root entries, you are using an internal surface. Switch to `contractqa` (CLI) or `@contractqa/adapters/public` if you need stability guarantees.

## Stability tags

JSDoc tags on exports document their level:

- `@stable` — semver-protected (default for any documented public export).
<!-- Maintainers: update this experimental list when promoting/removing @experimental exports. -->
- `@experimental` — may change in any minor release. v1.0.0 experimental list: `runHttpContract` (`@contractqa/runner/http`), `FirestoreBackendAdapter` (`@contractqa/adapters/public`).
- `@deprecated` — kept for at least one full minor cycle after announcement; removed only in the next major.

## Deprecation window

Stable exports flagged for removal must:

1. Carry an `@deprecated` JSDoc tag in the minor release that announces removal.
2. Remain available for at least one full minor cycle (≈ six weeks or one anchor release, whichever is longer).
3. Be removed only in the next major release.

## What counts as a break

- Renaming a stable export.
- Removing a stable export without going through the deprecation window.
- Narrowing a stable type (e.g. `string` → `'a' | 'b'`).
- Changing the runtime behaviour of a public function in a way that violates its documented contract.
- Changing the signature of `runContract`, `runHttpContract` once `@experimental` is removed, or any public adapter method (`loginAs`, `isAuthenticated`, `currentUser`, `query`, etc.).
- Changing which cookies / localStorage keys a public AuthAdapter writes.

## What does NOT count as a break

- Adding new exports.
- Adding optional fields to existing public interfaces.
- Widening a public type (e.g. `'a' | 'b'` → `string`).
- Changes inside `dogfood/`, `fixtures/`, or any path not re-exported from a public surface.
- Tightening internal error messages.
- Performance improvements that don't observably change return values.
- Any change to an `@experimental` export.
- Any change to an internal package's root entry.

## Reporting a break

Open an issue tagged `breaking-change` with the version pair and a minimal repro. We aim to either revert, patch, or document the rationale + migration path within one week.

## Engines

All publishable packages declare `engines.node >= 18` as the consumer floor. The monorepo root declares `>=20.18` as the contributor floor (newer Node features used in tests/scripts). Both are intentional.
