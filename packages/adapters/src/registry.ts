import type { AuthAdapter, AuthProviderName } from '@contractqa/core';

const registry = new Map<AuthProviderName, () => AuthAdapter>();

export function registerAuthAdapter(name: AuthProviderName, factory: () => AuthAdapter): void {
  registry.set(name, factory);
}

export function getAuthAdapter(name: AuthProviderName): AuthAdapter {
  const f = registry.get(name);
  if (!f) throw new Error(`auth provider not registered: ${name}`);
  return f();
}
