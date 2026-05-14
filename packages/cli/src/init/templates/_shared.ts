import type { TemplateInput } from './index.js';

export function smokeContract(input: TemplateInput): string {
  const head = input.authSignals.length === 0 ? '# no auth detected — render-only smoke\n' : '';
  return `${head}name: smoke
description: Home page renders without console errors
target: { url: '/', within: null }
goto: { wait: networkidle }
oracle:
  console: { error: { max: 0 } }
  dom:
    contains_text: ['${input.projectName}']
`;
}

export function authAdapterFile(provider: string, baseUrl: string): string {
  switch (provider) {
    case 'next-auth':
      return `import { NextAuthAdapter } from '@contractqa/adapters/public';\nexport const auth = new NextAuthAdapter({ baseUrl: '${baseUrl}' });\n`;
    case 'supabase':
      return `import { SupabaseAuthAdapter } from '@contractqa/adapters/public';\nexport const auth = new SupabaseAuthAdapter({ url: process.env.SUPABASE_URL ?? 'http://localhost:54321', anonKey: process.env.SUPABASE_ANON_KEY ?? 'fake' });\n`;
    case 'clerk':
      return `// Clerk adapter not yet shipped — see docs/adapters/writing-your-own.md\n`;
    case 'auth0':
      return `// Auth0 adapter not yet shipped — see docs/adapters/writing-your-own.md\n`;
    default:
      return `// no recognized auth provider in dependencies — wire your own here.\n`;
  }
}
