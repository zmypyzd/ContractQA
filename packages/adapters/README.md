# @contractqa/adapters

<!-- TODO(v1.0): confirm github.com/zmy/contractqa URL matches actual git remote before publishing -->

> AuthAdapter and BackendAdapter implementations for the [contractqa](https://www.npmjs.com/package/contractqa) platform.

Install:

```bash
npm install @contractqa/adapters
```

## Public surface

Import only from `@contractqa/adapters/public`:

```ts
import { SupabaseAuthAdapter, NextAuthAdapter, composeAuth } from '@contractqa/adapters/public';
import { PostgresBackendAdapter, MongoBackendAdapter, FirestoreBackendAdapter } from '@contractqa/adapters/public';
import type { AuthAdapter, BackendAdapter } from '@contractqa/adapters/public';
```

Importing from the root entry (`@contractqa/adapters`) or any deep path is **internal** and may change without notice. See [STABILITY.md](./STABILITY.md) (adapter-specific notes) and the repo [STABILITY.md](https://github.com/zmy/contractqa/blob/main/STABILITY.md) (repo-wide policy).

## What ships at v1.0.0

| Adapter | Stability |
|---|---|
| `SupabaseAuthAdapter` | `@stable` |
| `NextAuthAdapter` | `@stable` |
| `CustomCookieAuthAdapter` | `@stable` |
| `composeAuth` | `@stable` |
| `PostgresBackendAdapter` | `@stable` |
| `MongoBackendAdapter` | `@stable` |
| `FirestoreBackendAdapter` | `@experimental` (mocked-only tests; real-emulator integration deferred to a future release) |

Note: `Auth0Adapter` and `ClerkAuthAdapter` exist in this package but are not currently part of the `./public` semver surface. They will be promoted to the public surface in a future release once their dogfood coverage matches the other adapters. Until then, importing them directly from `@contractqa/adapters` is unsupported.

## Optional dependency

`@google-cloud/firestore` is an `optionalDependency`. It auto-installs by default. If your platform doesn't have prebuilt binaries (or you don't use Firestore), the install is allowed to fail and `FirestoreBackendAdapter` will throw at construction.

## License

See repo LICENSE.
