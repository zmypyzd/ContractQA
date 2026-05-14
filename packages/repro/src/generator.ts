import type { ContractDoc, AuthProviderName } from '@contractqa/core';

export interface GenerateReproInput {
  contract: ContractDoc;
  authProvider: AuthProviderName;
}

export function generateRepro(input: GenerateReproInput): string {
  const c = input.contract;
  const role = c.preconditions.role ?? 'normal_user';
  const steps: string[] = [];

  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const regexLiteral = (pat: string) => `/${pat.replace(/\//g, '\\/')}/`;

  for (const a of c.actions) {
    if (a.type === 'goto') {
      steps.push(`  await page.goto(${q(a.path)});`);
    } else if (a.type === 'click') {
      steps.push(
        `  await page.getByRole(${JSON.stringify(a.target.role ?? 'button')}, { name: ${
          a.target.name_regex ? `/${a.target.name_regex}/i` : `'click'`
        } }).click();`,
      );
    } else if (a.type === 'fill') {
      steps.push(
        `  await page.getByRole(${JSON.stringify(
          a.target.role ?? 'textbox',
        )}, { name: ${
          a.target.name_regex ? `/${a.target.name_regex}/i` : `'field'`
        } }).fill(${JSON.stringify(a.value)});`,
      );
    } else if (a.type === 'wait') {
      steps.push(`  await page.waitForTimeout(${a.ms});`);
    }
  }

  const assertions: string[] = [];
  if (c.expected.url?.matches) {
    assertions.push(`  await expect(page).toHaveURL(${regexLiteral(c.expected.url.matches)});`);
  }
  if (c.expected.localStorage?.no_key_matches) {
    assertions.push(
      `  await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter((k) => ${regexLiteral(c.expected.localStorage!.no_key_matches!)}.test(k)))).toEqual([]);`,
    );
  }
  if (c.expected.auth_state?.fully_logged_out) {
    const adapterName =
      input.authProvider === 'supabase'
        ? 'SupabaseAuthAdapter'
        : input.authProvider === 'clerk'
          ? 'ClerkAuthAdapter'
          : input.authProvider === 'next-auth'
            ? 'NextAuthAdapter'
            : 'Auth0Adapter';
    const adapterCtor =
      input.authProvider === 'supabase'
        ? 'SupabaseAuthAdapter({ url: process.env.SUPABASE_URL!, anonKey: process.env.SUPABASE_ANON_KEY! })'
        : `${adapterName}()`;
    assertions.push(
      `  const { ${adapterName} } = await import('@contractqa/adapters');`,
      `  const __auth = new ${adapterCtor};`,
      `  const __r = await __auth.expectFullyLoggedOut(page);`,
      `  expect(__r.fullyLoggedOut, __r.reasons.join('; ')).toBe(true);`,
    );
  }

  return `import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test('${c.id}: ${c.title}', async ({ page }) => {
  await loginAs(page, '${role}');
${steps.join('\n')}
${assertions.join('\n')}
});
`;
}
