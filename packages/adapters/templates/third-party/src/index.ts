import type {
  AuthAdapter,
  SessionKeyPatterns,
  AuthStateAssertion,
} from '@contractqa/adapters/public';

/**
 * Example third-party adapter. Replace 'myapp' with your product's identifying
 * prefix, then fill in the four method bodies for your auth flow.
 *
 * Wire this into a host project's qa/adapters/auth.ts:
 *
 *   import { ExampleAuthAdapter } from 'contractqa-adapter-example';
 *   export const auth = new ExampleAuthAdapter();
 */
export class ExampleAuthAdapter implements AuthAdapter {
  readonly provider = 'custom' as const;

  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^myapp\./],
      sessionStorage: [],
      cookies: [/^myapp_/],
    };
  }

  async loginAs(role: string): Promise<void> {
    throw new Error(
      `ExampleAuthAdapter.loginAs(${role}) not implemented. ` +
        `Inject your app's session shape into the browser here — see SupabaseAuthAdapter for a reference.`,
    );
  }

  async isAuthenticated(): Promise<boolean> {
    return false;
  }

  async currentUser(): Promise<{ id: string; role: string } | null> {
    return null;
  }

  async expectFullyLoggedOut(): Promise<AuthStateAssertion> {
    return { fullyLoggedOut: true, reasons: [] };
  }
}
