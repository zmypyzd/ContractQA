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

export interface AuthAdapter {
  provider: AuthProviderName;
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
