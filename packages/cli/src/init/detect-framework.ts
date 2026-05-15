export type Framework =
  | 'next-app'
  | 'next-pages'
  | 'vite-react'
  | 'vite-vue'
  | 'astro'
  | 'remix'
  | 'sveltekit'
  | 'unknown';

/**
 * Auth provider signals detected via package.json deps.
 *
 * `'custom-cookie'` is a heuristic signal: presence of `bcryptjs` or `bcrypt`
 * in deps suggests a hand-rolled cookie-auth setup. Advisory only — false
 * positives are acceptable (a project might use bcrypt for non-auth password
 * hashing). Phase 9 candidate: layer in file-presence verification (look for
 * `cookies()` usage in middleware or route handlers).
 */
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
  { signal: 'custom-cookie', test: (d) => !!d['bcryptjs'] || !!d['bcrypt'] },
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

import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface RepoDetectCandidate {
  subdir: string; // "." for root, otherwise relative path
  framework: Framework;
  confidence: number;
  evidence: string[];
  authSignals: AuthSignal[];
}

export interface RepoDetectResult {
  candidates: RepoDetectCandidate[];
  evidence: string[];
}

const SUBDIR_HINTS = ['apps', 'packages', 'web', 'frontend', 'client', 'site'];

export async function detectFrameworkInRepo(root: string): Promise<RepoDetectResult> {
  const candidates: RepoDetectCandidate[] = [];
  const repoEvidence: string[] = [];
  let skippedSymlinks = 0;
  const rootResult = await tryDir(root, '.');
  if (rootResult) candidates.push(rootResult);

  for (const hint of SUBDIR_HINTS) {
    const hintPath = path.join(root, hint);
    let isDir = false;
    try { isDir = (await stat(hintPath)).isDirectory(); } catch {}
    if (!isDir) continue;
    if (hint === 'apps' || hint === 'packages') {
      // Walk one level deeper.
      const subs = await readdir(hintPath);
      for (const s of subs) {
        const subPath = path.join(hintPath, s);
        const subLst = await lstat(subPath);
        if (subLst.isSymbolicLink()) { skippedSymlinks++; continue; }
        if (s.startsWith('@')) {
          // Scoped package: walk one more level (e.g. apps/@org/pkg)
          if (!subLst.isDirectory()) continue;
          const scopedSubs = await readdir(subPath);
          for (const pkg of scopedSubs) {
            const scopedPath = path.join(subPath, pkg);
            const scopedLst = await lstat(scopedPath);
            if (scopedLst.isSymbolicLink()) { skippedSymlinks++; continue; }
            if (!scopedLst.isDirectory()) continue;
            const r = await tryDir(scopedPath, `${hint}/${s}/${pkg}`);
            if (r) candidates.push(r);
          }
        } else {
          const r = await tryDir(subPath, `${hint}/${s}`);
          if (r) candidates.push(r);
        }
      }
    } else {
      const r = await tryDir(hintPath, hint);
      if (r) candidates.push(r);
    }
  }
  if (skippedSymlinks > 0) {
    repoEvidence.push(`skipped ${skippedSymlinks} symlinked subdir${skippedSymlinks > 1 ? 's' : ''}; pass --target to inspect them explicitly`);
  }
  // Sort by confidence desc; ties go to non-root subdir before root.
  candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    if (a.subdir === '.' && b.subdir !== '.') return 1;
    if (b.subdir === '.' && a.subdir !== '.') return -1;
    return 0;
  });
  return { candidates, evidence: repoEvidence };
}

async function tryDir(dir: string, subdir: string): Promise<RepoDetectCandidate | null> {
  try {
    const pj = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const files = await readdir(dir);
    const r = await detectFramework({ packageJson: pj, files });
    if (r.framework === 'unknown') return null;
    return { subdir, framework: r.framework, confidence: r.confidence, evidence: r.evidence, authSignals: r.authSignals };
  } catch { return null; }
}
