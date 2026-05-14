import { SupabaseAuthAdapter, type SupabaseAuthAdapterOptions } from './auth/supabase.js';
import { ClerkAuthAdapter } from './auth/clerk.js';
import { NextAuthAdapter } from './auth/next-auth.js';
import { Auth0Adapter } from './auth/auth0.js';
import { registerAuthAdapter } from './registry.js';

export { DefaultAppAdapter } from './app/default.js';
export type { DefaultAppAdapterOptions } from './app/default.js';
export { SupabaseAuthAdapter, ClerkAuthAdapter, NextAuthAdapter, Auth0Adapter };
export type { SupabaseAuthAdapterOptions };
export { registerAuthAdapter, getAuthAdapter } from './registry.js';
export { computeAdapterLevel, meetsMinimum } from './level.js';
export type { AdapterLevel, AdapterSet } from './level.js';

registerAuthAdapter('supabase', () => new SupabaseAuthAdapter({ url: '', anonKey: '' }));
registerAuthAdapter('clerk', () => new ClerkAuthAdapter());
registerAuthAdapter('next-auth', () => new NextAuthAdapter());
registerAuthAdapter('auth0', () => new Auth0Adapter());
