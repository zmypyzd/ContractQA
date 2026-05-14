// SupabaseAuthAdapter v2 wiring for 5-4-claude dogfood.
//
// Defensive fallbacks: when SUPABASE_URL / SUPABASE_ANON_KEY are unset (stub-env
// / Phase 2 render-only lane), the adapter is still constructed with placeholder
// values.  loginAs() will then fail at the GoTrue fetch, which is correct — the
// login contract will error/skip, while the render contract (which never calls
// loginAs) is unaffected.
//
// When @contractqa/adapters/public is introduced by Part C, update the import
// path to that sub-path export.  For now we import from the package root, which
// re-exports SupabaseAuthAdapter.
import { SupabaseAuthAdapter } from '@contractqa/adapters';

export const auth = new SupabaseAuthAdapter({
  url: process.env.SUPABASE_URL ?? 'http://localhost:54321',
  anonKey: process.env.SUPABASE_ANON_KEY ?? 'fake',
  projectRef: process.env.SUPABASE_PROJECT_REF ?? 'localhost',
});
