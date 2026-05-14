export type Framework =
  | 'next-app'
  | 'next-pages'
  | 'vite-react'
  | 'vite-vue'
  | 'astro'
  | 'remix'
  | 'sveltekit'
  | 'unknown';

export type AuthSignal = 'next-auth' | 'supabase' | 'clerk' | 'auth0' | 'custom-cookie';

export interface DetectInput {
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  files: string[];
}

export interface DetectResult {
  framework: Framework;
  confidence: number;
  evidence: string[];
  authSignals: AuthSignal[];
}

interface Rule {
  framework: Framework;
  test: (i: DetectInput) => { matched: boolean; evidence: string[]; confidence: number };
}

const RULES: Rule[] = [
  {
    framework: 'next-app',
    test: (i) => {
      const evidence: string[] = [];
      let score = 0;
      const hasDep = !!i.packageJson.dependencies?.next || !!i.packageJson.devDependencies?.next;
      if (hasDep) { score += 0.4; evidence.push('next in dependencies'); }
      const cfg = i.files.find((f) => /^next\.config\.(ts|js|mjs|cjs)$/.test(f));
      if (cfg) { score += 0.3; evidence.push(`${cfg} present`); }
      const hasApp = i.files.some((f) => f.startsWith('app/') || f.startsWith('src/app/'));
      if (hasApp) {
        score += 0.3;
        const appEvidence = i.files.some((f) => f.startsWith('src/app/')) ? 'src/app/ directory present' : 'app/ directory present';
        evidence.push(appEvidence);
      }
      return { matched: score >= 0.6 && hasApp, evidence, confidence: Math.min(score, 1) };
    },
  },
  {
    framework: 'next-pages',
    test: (i) => {
      const evidence: string[] = [];
      let score = 0;
      const hasDep = !!i.packageJson.dependencies?.next;
      if (hasDep) { score += 0.4; evidence.push('next in dependencies'); }
      const cfg = i.files.find((f) => /^next\.config\.(ts|js|mjs|cjs)$/.test(f));
      if (cfg) { score += 0.3; evidence.push(`${cfg} present`); }
      const hasPages = i.files.some((f) => f.startsWith('pages/') || f.startsWith('src/pages/'));
      if (hasPages) {
        score += 0.3;
        const pagesEvidence = i.files.some((f) => f.startsWith('src/pages/')) ? 'src/pages/ directory present' : 'pages/ directory present';
        evidence.push(pagesEvidence);
      }
      return { matched: score >= 0.6 && hasPages, evidence, confidence: Math.min(score, 1) };
    },
  },
  {
    framework: 'vite-react',
    test: (i) => {
      const evidence: string[] = [];
      let score = 0;
      const deps = { ...i.packageJson.dependencies, ...i.packageJson.devDependencies };
      if (deps.vite) { score += 0.4; evidence.push('vite in deps'); }
      if (deps.react) { score += 0.4; evidence.push('react in deps'); }
      const cfg = i.files.find((f) => /^vite\.config\.(ts|js|mjs)$/.test(f));
      if (cfg) { score += 0.2; evidence.push(`${cfg} present`); }
      return { matched: score >= 0.8, evidence, confidence: Math.min(score, 1) };
    },
  },
  {
    framework: 'vite-vue',
    test: (i) => {
      const evidence: string[] = [];
      let score = 0;
      const deps = { ...i.packageJson.dependencies, ...i.packageJson.devDependencies };
      if (deps.vite) { score += 0.4; evidence.push('vite in deps'); }
      if (deps.vue) { score += 0.4; evidence.push('vue in deps'); }
      const cfg = i.files.find((f) => /^vite\.config\.(ts|js|mjs)$/.test(f));
      if (cfg) { score += 0.2; evidence.push(`${cfg} present`); }
      return { matched: score >= 0.8, evidence, confidence: Math.min(score, 1) };
    },
  },
  {
    framework: 'astro',
    test: (i) => {
      const evidence: string[] = [];
      let score = 0;
      if (i.packageJson.dependencies?.astro || i.packageJson.devDependencies?.astro) {
        score += 0.6; evidence.push('astro in deps');
      }
      if (i.files.some((f) => /^astro\.config\.(ts|mjs|js)$/.test(f))) {
        score += 0.4; evidence.push('astro.config present');
      }
      return { matched: score >= 0.6, evidence, confidence: Math.min(score, 1) };
    },
  },
];

const AUTH_RULES: Array<{ signal: AuthSignal; test: (deps: Record<string, string>) => boolean }> = [
  { signal: 'next-auth', test: (d) => !!d['next-auth'] || !!d['@auth/core'] },
  { signal: 'supabase', test: (d) => !!d['@supabase/supabase-js'] || !!d['@supabase/ssr'] },
  { signal: 'clerk', test: (d) => !!d['@clerk/nextjs'] || !!d['@clerk/clerk-sdk-node'] },
  { signal: 'auth0', test: (d) => !!d['@auth0/nextjs-auth0'] },
];

export async function detectFramework(input: DetectInput): Promise<DetectResult> {
  const deps = { ...input.packageJson.dependencies, ...input.packageJson.devDependencies };
  const authSignals = AUTH_RULES.filter((r) => r.test(deps)).map((r) => r.signal);

  const matches = RULES.map((r) => ({ rule: r, result: r.test(input) }))
    .filter((x) => x.result.matched)
    .sort((a, b) => b.result.confidence - a.result.confidence);

  if (matches.length === 0) {
    return { framework: 'unknown', confidence: 0, evidence: [], authSignals };
  }
  const top = matches[0]!;
  return {
    framework: top.rule.framework,
    confidence: top.result.confidence,
    evidence: top.result.evidence,
    authSignals,
  };
}
