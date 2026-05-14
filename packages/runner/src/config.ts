import type { AuthProviderName } from '@contractqa/core';

export interface ContractQAConfig {
  app: { baseUrl: string; startCommand?: string; healthCheckUrl: string };
  auth: { provider: AuthProviderName };
  contracts: { dir: string; invariants: string; noiseProfile: string };
  artifacts: { root: string; s3: { bucket: string; endpoint?: string } | null };
  pipelines: {
    critical_path: { blocking: boolean; timeoutSeconds: number };
    shadow_fix: { blocking: boolean; timeoutSeconds: number; maxFixAttempts: number };
  };
}

export function defineConfig(c: ContractQAConfig): ContractQAConfig {
  return c;
}
