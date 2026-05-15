import type { AuthSignal } from './detect-framework.js';

export interface AuthDiagnostic {
  provider: AuthSignal;
  depEvidence: boolean;
  wiringFiles: string[];
  hasMiddleware: boolean;
}

interface InspectInput {
  files: readonly string[];
  signals: readonly AuthSignal[];
}

// Path-presence rules per provider. Patterns are matched against the relative
// file path (forward slashes, no leading ./).
const WIRING_RULES: Record<AuthSignal, RegExp[]> = {
  'next-auth': [
    /^(src\/)?app\/api\/auth\/\[\.\.\.nextauth\]\/route\.(ts|tsx|js|jsx|mjs)$/,
    /^(src\/)?pages\/api\/auth\/\[\.\.\.nextauth\]\.(ts|tsx|js|jsx|mjs)$/,
    /^(src\/)?auth\.(ts|tsx|js|jsx|mjs)$/,
    /^(src\/)?lib\/auth\.(ts|tsx|js|jsx|mjs)$/,
  ],
  supabase: [
    /^(src\/)?lib\/supabase\//,
    /^(src\/)?utils\/supabase\//,
    /^(src\/)?app\/api\/auth\/callback\/route\.(ts|js|mjs)$/,
  ],
  clerk: [
    /^(src\/)?app\/sign-in\//,
    /^(src\/)?app\/sign-up\//,
  ],
  auth0: [
    /^(src\/)?app\/api\/auth\/\[auth0\]\/route\.(ts|js|mjs)$/,
    /^(src\/)?pages\/api\/auth\/\[\.\.\.auth0\]\.(ts|js|mjs)$/,
  ],
  'custom-cookie': [],
};

const MIDDLEWARE_RE = /^(src\/)?middleware\.(ts|tsx|js|jsx|mjs)$/;

export function inspectAuthWiring(input: InspectInput): AuthDiagnostic[] {
  const hasMiddleware = input.files.some((f) => MIDDLEWARE_RE.test(f));
  return input.signals.map((provider) => {
    const rules = WIRING_RULES[provider] ?? [];
    const wiringFiles = input.files.filter((f) => rules.some((re) => re.test(f))).sort();
    return {
      provider,
      depEvidence: true,
      wiringFiles,
      hasMiddleware: wiringFiles.length > 0 && hasMiddleware,
    };
  });
}
