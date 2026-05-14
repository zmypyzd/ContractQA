/**
 * @contractqa/adapters/public
 *
 * Public, semver-stable surface. Anything not exported here is internal
 * and may change without notice. See `STABILITY.md` (Task C3) for the
 * break policy.
 */

/** @stable Core adapter type contracts. */
export type {
  AuthAdapter,
  AppAdapter,
  BackendAdapter,
  SessionKeyPatterns,
  AuthResponsibility,
  AuthProviderName,
  AuthStateAssertion,
  SeedProfile,
  SchemaDescriptor,
} from '@contractqa/core';

/** @stable */
export { NextAuthAdapter } from './auth/next-auth.js';

/** @stable */
export { SupabaseAuthAdapter } from './auth/supabase.js';

/** @stable */
export { CustomCookieAuthAdapter } from './auth/custom-cookie.js';

/** @stable */
export { composeAuth } from './auth/composite.js';

/** @stable @experimental Phase 4 will fill in the body. */
export { PostgresBackendAdapter } from './backend/postgres-stub.js';
