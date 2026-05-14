import type { Page } from './page-shim.js';
import type { AuthStateAssertion } from './snapshot.js';

export type SeedProfile = 'minimal' | 'standard' | 'rich' | { name: string; fixtureDir: string };

export interface AppAdapter {
  baseUrl: string;
  startCommand?: string;
  healthCheckUrl: string;
  resetState(): Promise<void>;
  seed(profile: SeedProfile): Promise<void>;
}

export type AuthProviderName = 'supabase' | 'clerk' | 'next-auth' | 'auth0' | 'custom';

export interface SessionKeyPatterns {
  localStorage: RegExp[];
  sessionStorage: RegExp[];
  cookies: RegExp[];
}

// Phase 2 addition: AuthResponsibility lets multiple adapters share an
// `auth` slot, each owning a slice of the contract surface. E.g. NextAuth
// owns 'session' (cookies + getSession), Supabase owns 'user-store' (db
// lookups). composeAuth([next, supabase]) returns one adapter that
// delegates per-responsibility.
export type AuthResponsibility = 'session' | 'user-store' | 'oauth-callback';

export interface AuthAdapter {
  provider: AuthProviderName;
  // Optional. When set, composeAuth delegates per-responsibility. When
  // unset, the adapter is treated as owning every responsibility (backward
  // compatible — Phase 1 adapters keep working unchanged).
  responsibilities?: readonly AuthResponsibility[];
  loginAs(role: string, page: Page): Promise<void>;
  isAuthenticated(page: Page): Promise<boolean>;
  currentUser(page: Page): Promise<{ id: string; role: string } | null>;
  sessionKeyPatterns(): SessionKeyPatterns;
  expectFullyLoggedOut(page: Page): Promise<AuthStateAssertion>;
}

export interface SchemaDescriptor {
  namedQueries: Array<{ name: string; description: string; params: Record<string, string> }>;
  tenantField: string | null;
}

export interface BackendAdapter {
  kind: 'postgres' | 'mongo' | 'firestore' | 'custom';
  describe(): SchemaDescriptor;
  query(name: string, params: unknown): Promise<unknown>;
  authProviderState?(userId: string): Promise<{ sessionExists: boolean; userId?: string; role?: string }>;
}
