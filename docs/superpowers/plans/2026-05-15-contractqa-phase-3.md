# ContractQA Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive ContractQA from "works in 5 dogfood targets after manual setup" to "drops into a fresh repo, auto-detects the framework, fixes its own boot problems, and exercises real Supabase auth — with a publishable third-party adapter surface."

**Architecture:** Three independently-mergeable parts sharing one acceptance script.
- **Part A — CLI onboarding:** `contractqa init` gains framework detection + per-framework scaffolds; new `contractqa scan` produces a proposed-contracts report; `contractqa doctor --fix` turns Phase 2's read-only preflight into a one-shot remediator.
- **Part B — Real-cloud Supabase:** Vendored docker-compose Supabase stack + SupabaseAuthAdapter v2 with a real default `loginAs`, retiring Phase 1's stub-throwing version for any target that opts in.
- **Part C — Public adapter API:** Promote `@contractqa/adapters` to a publishable surface with an explicit `public` entry point, stability tags, semver break policy, and an out-of-tree starter template proven via a smoke test.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest, Playwright, Commander (CLI), Docker Compose, Supabase self-host (GoTrue, PostgREST, Postgres 15), zod (schemas).

---

## Required reading (before starting)

1. `claude_code_qa_agent_design.md` §7.6 (public API gating), §15.3–§15.6 (dashboard, deferred to Phase 4), §17.1 (BackendAdapter — explicitly deferred), §24 (logout invariants).
2. `dogfood/FINDINGS.md` — "Findings DEFERRED to Phase 3" list. Every anchor in this plan maps back to that list.
3. `docs/superpowers/plans/2026-05-14-contractqa-phase-2.md` — Phase 2's "Out of Phase 2 (Phase 3 candidates)" section is this plan's input set; "Risk register" is its inherited risk surface.
4. `packages/cli/src/commands/{init,doctor}.ts` — both exist; Phase 3 enhances them, doesn't create them.
5. `packages/adapters/src/auth/supabase.ts` — Phase 1's adapter that throws on `loginAs`; v2 replaces only the body, keeps the class name + options shape.
6. `dogfood/5-4-claude/` — the target that needs real Supabase; its FINDINGS.md flags the render-only fallback explicitly.

---

## Scope decisions (CEO 鸭 verdict 2026-05-14)

| Decision | Verdict | Source |
|---|---|---|
| Phase 3 anchor count | 3 (init/scan, doctor --fix, SupabaseAuthAdapter v2) | Asked for 1-2; user picked 3. BackendAdapter is the one dropped. |
| Real-cloud fixture | Docker-compose Supabase + Postgres (vendored) | Pairs with SupabaseAuthAdapter v2; powers Part B end-to-end. |
| Public adapter API | OPEN in Phase 3 — `@contractqa/adapters` ships a `./public` stable entry | Reverses design doc §7.6.5 v0.5+ gate. Add `STABILITY.md` + semver policy. |
| BackendAdapter | Deferred to Phase 4 | Biggest of the four candidates; api-only repos wait one more cycle. |

Version target at end of Phase 3: **v0.3.0** (all workspace packages bumped together).

---

## Non-goals (do not touch)

- Dashboard UI work (design doc §15.3–§15.6 — Phase 4).
- BackendAdapter / api-only contract surface (design doc §17.1 — Phase 4).
- Persona dogfood agents (still backlog).
- Property/model-based test generation (still backlog).
- TypeScript project references via `tsc -b` (backlog item; cheap mitigation = Task D1 acceptance-script reorder).
- Publishing to npm. We prepare the surface but do not run `pnpm publish` — that is a user-gated post-Phase-3 step.

---

## Dependency graph

```
Part A (CLI onboarding) ────────┐
                                ├──► Cross-part D (acceptance + release)
Part B (Supabase real-cloud) ───┤
                                │
Part C (Public adapter API) ────┘
```

Parts A and C are fully independent and can be worktree-parallel.
Part B depends on Phase 2's `composeAuth` (already shipped) but is otherwise independent.
Cross-part D depends on all three.

**Suggested worktree layout (matches Phase 2's pattern):**
- `worktrees/phase3-a-cli-onboarding`
- `worktrees/phase3-b-supabase-realcloud`
- `worktrees/phase3-c-public-adapter`
- `worktrees/phase3-d-release` (created last)

---

# Part A: CLI onboarding (init/scan + doctor --fix)

**Acceptance gate A:** `contractqa init` on any of the 5 Phase 2 targets produces a working `qa/` directory in one command (no `--provider` flag required). `contractqa scan` on the same targets produces a `qa/SCAN_REPORT.md` listing at least one detected auth pattern and one route. `contractqa doctor --fix /path/to/5-4-codex` rebuilds `better-sqlite3` automatically (today's manual `npm rebuild` step).

---

### Task A1: Framework detector module

**Files:**
- Create: `packages/cli/src/init/detect-framework.ts`
- Create: `packages/cli/tests/detect-framework.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/detect-framework.test.ts
import { describe, it, expect } from 'vitest';
import { detectFramework } from '../src/init/detect-framework.js';

describe('detectFramework', () => {
  it('detects Next.js app-router by next.config + app/ + dep', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '^15.0.0' } },
      files: ['next.config.ts', 'app/page.tsx', 'app/layout.tsx'],
    });
    expect(r.framework).toBe('next-app');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.evidence).toContain('next.config.ts present');
  });

  it('detects Vite + React via vite.config + dep', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { vite: '^5', react: '^18' } },
      files: ['vite.config.ts', 'src/App.tsx'],
    });
    expect(r.framework).toBe('vite-react');
  });

  it('detects Vite + Vue', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { vite: '^5', vue: '^3' } },
      files: ['vite.config.ts', 'src/App.vue'],
    });
    expect(r.framework).toBe('vite-vue');
  });

  it('returns unknown with confidence 0 when nothing matches', async () => {
    const r = await detectFramework({ packageJson: {}, files: ['index.html'] });
    expect(r.framework).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('detects NextAuth in deps as auth-signal', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { next: '^15', 'next-auth': '^5' } },
      files: ['next.config.ts', 'app/page.tsx'],
    });
    expect(r.framework).toBe('next-app');
    expect(r.authSignals).toContain('next-auth');
  });

  it('detects Supabase via @supabase/supabase-js', async () => {
    const r = await detectFramework({
      packageJson: { dependencies: { vite: '^5', react: '^18', '@supabase/supabase-js': '^2' } },
      files: ['vite.config.ts'],
    });
    expect(r.authSignals).toContain('supabase');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter contractqa test detect-framework
```

Expected: `FAIL` — `Cannot find module '../src/init/detect-framework.js'`.

- [ ] **Step 3: Implement the detector**

```typescript
// packages/cli/src/init/detect-framework.ts
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
  confidence: number; // 0..1
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
      const hasApp = i.files.some((f) => f.startsWith('app/'));
      if (hasApp) { score += 0.3; evidence.push('app/ directory present'); }
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
      const hasPages = i.files.some((f) => f.startsWith('pages/'));
      if (hasPages) { score += 0.3; evidence.push('pages/ directory present'); }
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
  const top = matches[0];
  return {
    framework: top.rule.framework,
    confidence: top.result.confidence,
    evidence: top.result.evidence,
    authSignals,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter contractqa test detect-framework
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework.test.ts
git commit -m "feat(cli): detectFramework + auth-signal scanner for init/scan"
```

---

### Task A2: Per-framework scaffold templates

**Files:**
- Create: `packages/cli/src/init/templates/index.ts`
- Create: `packages/cli/src/init/templates/next-app.ts`
- Create: `packages/cli/src/init/templates/next-pages.ts`
- Create: `packages/cli/src/init/templates/vite-react.ts`
- Create: `packages/cli/src/init/templates/vite-vue.ts`
- Create: `packages/cli/src/init/templates/astro.ts`
- Create: `packages/cli/src/init/templates/unknown.ts`
- Create: `packages/cli/tests/templates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/templates.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/init/templates/index.js';

describe('renderTemplate', () => {
  it('renders Next.js app-router with NextAuth signal', () => {
    const t = renderTemplate({
      framework: 'next-app',
      authSignals: ['next-auth'],
      projectName: 'demo',
    });
    expect(t.files['contractqa.config.ts']).toContain("provider: 'next-auth'");
    expect(t.files['qa/contracts/smoke.contract.yaml']).toContain('name: smoke');
    expect(t.files['qa/adapters/app.ts']).toContain("baseUrl: 'http://localhost:3000'");
  });

  it('renders Vite + React with Supabase signal', () => {
    const t = renderTemplate({
      framework: 'vite-react',
      authSignals: ['supabase'],
      projectName: 'demo',
    });
    expect(t.files['contractqa.config.ts']).toContain("provider: 'supabase'");
    expect(t.files['qa/adapters/auth.ts']).toContain('SupabaseAuthAdapter');
  });

  it('renders unknown framework with custom-cookie fallback', () => {
    const t = renderTemplate({
      framework: 'unknown',
      authSignals: [],
      projectName: 'demo',
    });
    expect(t.files['contractqa.config.ts']).toContain("provider: 'custom'");
  });

  it('renders Vite + Vue with no-auth render-only smoke', () => {
    const t = renderTemplate({
      framework: 'vite-vue',
      authSignals: [],
      projectName: 'demo',
    });
    expect(t.files['qa/contracts/smoke.contract.yaml']).toContain('# no auth detected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter contractqa test templates
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement templates**

Create `packages/cli/src/init/templates/index.ts`:

```typescript
import type { Framework, AuthSignal } from '../detect-framework.js';
import { nextAppTemplate } from './next-app.js';
import { nextPagesTemplate } from './next-pages.js';
import { viteReactTemplate } from './vite-react.js';
import { viteVueTemplate } from './vite-vue.js';
import { astroTemplate } from './astro.js';
import { unknownTemplate } from './unknown.js';

export interface TemplateInput {
  framework: Framework;
  authSignals: readonly AuthSignal[];
  projectName: string;
}

export interface TemplateOutput {
  files: Record<string, string>;
}

export function renderTemplate(input: TemplateInput): TemplateOutput {
  switch (input.framework) {
    case 'next-app':   return nextAppTemplate(input);
    case 'next-pages': return nextPagesTemplate(input);
    case 'vite-react': return viteReactTemplate(input);
    case 'vite-vue':   return viteVueTemplate(input);
    case 'astro':      return astroTemplate(input);
    default:           return unknownTemplate(input);
  }
}

export function pickProvider(signals: readonly AuthSignal[]): string {
  if (signals.includes('next-auth')) return 'next-auth';
  if (signals.includes('supabase')) return 'supabase';
  if (signals.includes('clerk')) return 'clerk';
  if (signals.includes('auth0')) return 'auth0';
  return 'custom';
}
```

Implement each template file to return a `TemplateOutput` with the keys:
- `contractqa.config.ts`
- `qa/contracts/smoke.contract.yaml`
- `qa/adapters/app.ts`
- `qa/adapters/auth.ts` (if any authSignal)
- `qa/INVARIANTS.md`
- `qa/noise-profile.yml`

Example for Next.js app-router:

```typescript
// packages/cli/src/init/templates/next-app.ts
import type { TemplateInput, TemplateOutput } from './index.js';
import { pickProvider } from './index.js';

export function nextAppTemplate(input: TemplateInput): TemplateOutput {
  const provider = pickProvider(input.authSignals);
  return {
    files: {
      'contractqa.config.ts': `import { defineConfig } from '@contractqa/runner';
export default defineConfig({
  app: { baseUrl: 'http://localhost:3000', healthCheckUrl: 'http://localhost:3000/api/health' },
  auth: { provider: '${provider}' },
  contracts: { dir: 'qa/contracts', invariants: 'qa/INVARIANTS.md', noiseProfile: 'qa/noise-profile.yml' },
  artifacts: { root: 'artifacts', s3: null },
  pipelines: {
    critical_path: { blocking: true, timeoutSeconds: 300 },
    shadow_fix: { blocking: false, timeoutSeconds: 1800, maxFixAttempts: 3 },
  },
});
`,
      'qa/contracts/smoke.contract.yaml': `name: smoke
description: Home page renders without console errors
target: { url: '/', within: null }
goto: { wait: 'networkidle' }
oracle:
  console: { error: { max: 0 } }
  dom:
    contains_text: ['${input.projectName}']
`,
      'qa/adapters/app.ts': `import type { AppAdapter } from '@contractqa/adapters/public';
export const app: AppAdapter = {
  baseUrl: 'http://localhost:3000',
  healthCheckUrl: 'http://localhost:3000/api/health',
  async resetState() { /* fill in for your DB reset hook */ },
  async seed() { /* fill in for fixture loading */ },
};
`,
      'qa/adapters/auth.ts': provider === 'next-auth'
        ? `import { NextAuthAdapter } from '@contractqa/adapters/public';
export const auth = new NextAuthAdapter({ baseUrl: 'http://localhost:3000' });
`
        : `// no recognized auth provider in dependencies — wire your own here.
`,
      'qa/INVARIANTS.md': `# Product Invariants\n\n_(generated, run \`contractqa invariants:gen\`)_\n`,
      'qa/noise-profile.yml': `project: ${input.projectName}\ngenerated_at: ${new Date().toISOString()}\nignore: {}\n`,
    },
  };
}
```

Implement the other templates with the same shape but framework-appropriate baseUrls (Vite/Astro default to `:5173` and `:4321`) and provider stubs.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter contractqa test templates
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/templates packages/cli/tests/templates.test.ts
git commit -m "feat(cli): per-framework init scaffolds (next-app, vite-react, vite-vue, astro, unknown)"
```

---

### Task A3: Wire detector + templates into `contractqa init`

**Files:**
- Modify: `packages/cli/src/commands/init.ts` (full rewrite — current 35 lines becomes ~80)
- Modify: `packages/cli/bin/contractqa.ts` (add `--yes`, `--force` flags)
- Create: `packages/cli/tests/init.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/init.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from '../src/commands/init.js';

describe('initProject', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-init-'));
  });

  it('auto-detects Vite + React and writes scaffold', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'tiny-vite',
      dependencies: { vite: '^5', react: '^18' },
    }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');

    const report = await initProject({ cwd: tmp, yes: true });
    expect(report.detected.framework).toBe('vite-react');
    const cfg = await readFile(path.join(tmp, 'contractqa.config.ts'), 'utf8');
    expect(cfg).toContain('baseUrl');
  });

  it('refuses to overwrite without --force', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { vite: '^5', react: '^18' } }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');
    await mkdir(path.join(tmp, 'qa'), { recursive: true });
    await writeFile(path.join(tmp, 'qa', 'INVARIANTS.md'), 'existing content');
    await expect(initProject({ cwd: tmp, yes: true })).rejects.toThrow(/already exists/);
  });

  it('overwrites with --force', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { vite: '^5', react: '^18' } }));
    await writeFile(path.join(tmp, 'vite.config.ts'), '');
    await mkdir(path.join(tmp, 'qa'), { recursive: true });
    await writeFile(path.join(tmp, 'qa', 'INVARIANTS.md'), 'existing content');
    const report = await initProject({ cwd: tmp, yes: true, force: true });
    expect(report.framework).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter contractqa test init
```

Expected: `FAIL` — current `initProject` takes a `provider` arg, not the new options shape.

- [ ] **Step 3: Rewrite `init.ts`**

```typescript
// packages/cli/src/commands/init.ts
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, type DetectResult } from '../init/detect-framework.js';
import { renderTemplate } from '../init/templates/index.js';

export interface InitOptions {
  cwd: string;
  yes?: boolean;
  force?: boolean;
  framework?: string; // override auto-detect
}

export interface InitReport {
  detected: DetectResult;
  framework: string;
  filesWritten: string[];
}

async function scanFiles(dir: string, depth: number = 2, prefix: string = ''): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(`${rel}/`);
      out.push(...await scanFiles(path.join(dir, e.name), depth - 1, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

async function readPackageJson(cwd: string): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

export async function initProject(opts: InitOptions): Promise<InitReport> {
  const pkg = await readPackageJson(opts.cwd);
  const files = await scanFiles(opts.cwd);
  const detected = await detectFramework({ packageJson: pkg, files });
  const framework = opts.framework ?? detected.framework;

  const projectName = path.basename(opts.cwd);
  const template = renderTemplate({
    framework: framework as DetectResult['framework'],
    authSignals: detected.authSignals,
    projectName,
  });

  // Refuse to overwrite without --force
  if (!opts.force) {
    for (const rel of Object.keys(template.files)) {
      if (await pathExists(path.join(opts.cwd, rel))) {
        throw new Error(`${rel} already exists. Re-run with --force to overwrite.`);
      }
    }
  }

  const written: string[] = [];
  for (const [rel, content] of Object.entries(template.files)) {
    const abs = path.join(opts.cwd, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
    written.push(rel);
  }

  return { detected, framework, filesWritten: written };
}
```

- [ ] **Step 4: Wire to CLI bin**

In `packages/cli/bin/contractqa.ts`, find the `init` command registration and update:

```typescript
program
  .command('init')
  .description('Scaffold qa/ directory for the current project (auto-detects framework)')
  .option('-y, --yes', 'skip confirmation prompts')
  .option('-f, --force', 'overwrite existing files')
  .option('--framework <name>', 'force a specific framework (next-app, vite-react, ...)')
  .action(async (opts) => {
    const report = await initProject({ cwd: process.cwd(), yes: opts.yes, force: opts.force, framework: opts.framework });
    console.log(`Detected: ${report.detected.framework} (confidence ${report.detected.confidence.toFixed(2)})`);
    console.log(`Auth signals: ${report.detected.authSignals.join(', ') || '(none)'}`);
    console.log(`Wrote ${report.filesWritten.length} files:`);
    for (const f of report.filesWritten) console.log(`  ${f}`);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter contractqa test init
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/bin/contractqa.ts packages/cli/tests/init.test.ts
git commit -m "feat(cli): contractqa init auto-detects framework + writes per-framework scaffold"
```

---

### Task A4: `contractqa scan` command (report-only)

**Files:**
- Create: `packages/cli/src/commands/scan.ts`
- Create: `packages/cli/tests/scan.test.ts`
- Modify: `packages/cli/bin/contractqa.ts` (register command)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/scan.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/commands/scan.js';

describe('scanProject', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-scan-')); });

  it('reports detected framework, auth signals, and at least one route for a Next.js app-router target', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '^15', 'next-auth': '^5' },
    }));
    await writeFile(path.join(tmp, 'next.config.ts'), '');
    await mkdir(path.join(tmp, 'app'), { recursive: true });
    await writeFile(path.join(tmp, 'app', 'page.tsx'), 'export default function Page() {}');
    await mkdir(path.join(tmp, 'app', 'login'), { recursive: true });
    await writeFile(path.join(tmp, 'app', 'login', 'page.tsx'), 'export default function Login() {}');

    const report = await scanProject({ cwd: tmp });
    expect(report.framework).toBe('next-app');
    expect(report.authSignals).toContain('next-auth');
    expect(report.routes).toEqual(expect.arrayContaining(['/', '/login']));
    expect(report.markdown).toContain('# ContractQA scan report');
  });
});
```

- [ ] **Step 2: Implement scan**

```typescript
// packages/cli/src/commands/scan.ts
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, type DetectResult } from '../init/detect-framework.js';

export interface ScanReport {
  framework: DetectResult['framework'];
  confidence: number;
  authSignals: readonly string[];
  routes: string[];
  evidence: readonly string[];
  markdown: string;
}

async function walk(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(root, rel));
    else out.push(rel);
  }
  return out;
}

function deriveRoutes(framework: DetectResult['framework'], files: readonly string[]): string[] {
  if (framework === 'next-app') {
    return files
      .filter((f) => /^app\/.*page\.(tsx|ts|jsx|js)$/.test(f))
      .map((f) => {
        const seg = f.replace(/^app\//, '').replace(/\/page\.[^.]+$/, '');
        return seg === '' ? '/' : `/${seg}`;
      })
      .sort();
  }
  if (framework === 'next-pages') {
    return files
      .filter((f) => /^pages\/.*\.(tsx|ts|jsx|js)$/.test(f) && !/_app|_document|api\//.test(f))
      .map((f) => '/' + f.replace(/^pages\//, '').replace(/\.[^.]+$/, '').replace(/index$/, ''))
      .map((r) => r === '/' ? '/' : r.replace(/\/$/, ''))
      .sort();
  }
  // vite/astro/unknown — no router-level route extraction in Phase 3
  return ['/'];
}

export async function scanProject(opts: { cwd: string }): Promise<ScanReport> {
  const pkg = JSON.parse(await readFile(path.join(opts.cwd, 'package.json'), 'utf8').catch(() => '{}'));
  const files = await walk(opts.cwd);
  const detected = await detectFramework({ packageJson: pkg, files });
  const routes = deriveRoutes(detected.framework, files);

  const md = [
    '# ContractQA scan report',
    '',
    `**Framework:** ${detected.framework} (confidence ${detected.confidence.toFixed(2)})`,
    `**Auth signals:** ${detected.authSignals.join(', ') || '(none)'}`,
    '',
    '## Routes',
    ...routes.map((r) => `- \`${r}\``),
    '',
    '## Suggested contracts',
    ...routes.map((r) => `- smoke: \`${r}\` renders without console errors`),
    '',
    '## Evidence',
    ...detected.evidence.map((e) => `- ${e}`),
  ].join('\n');

  return {
    framework: detected.framework,
    confidence: detected.confidence,
    authSignals: detected.authSignals,
    routes,
    evidence: detected.evidence,
    markdown: md,
  };
}
```

- [ ] **Step 3: Wire to CLI bin**

```typescript
program
  .command('scan')
  .description('Scan project and write qa/SCAN_REPORT.md with detected framework + suggested contracts')
  .option('-o, --out <path>', 'output path', 'qa/SCAN_REPORT.md')
  .action(async (opts) => {
    const r = await scanProject({ cwd: process.cwd() });
    await mkdir(path.dirname(opts.out), { recursive: true });
    await writeFile(opts.out, r.markdown);
    console.log(`Wrote ${opts.out}`);
  });
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter contractqa test scan
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/scan.ts packages/cli/tests/scan.test.ts packages/cli/bin/contractqa.ts
git commit -m "feat(cli): contractqa scan — framework + route + suggested-contract report"
```

---

### Task A5: `contractqa doctor --fix` scaffolding

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts` (extend `DoctorInput`, add `applyFixes` function)
- Modify: `packages/cli/bin/contractqa.ts` (add `--fix` flag)
- Modify: `packages/cli/tests/doctor.test.ts` (add `--fix` cases)

- [ ] **Step 1: Extend the DoctorInput / DoctorReport types**

```typescript
// packages/cli/src/commands/doctor.ts (delta)
export interface DoctorInput {
  target: string;
  ports?: number[];
  fix?: ReadonlyArray<'native-deps' | 'env-stub' | 'port-collision'>;
  // 'native-deps' = npm rebuild for ABI mismatches
  // 'env-stub'    = write missing .env.local from .env.example
  // 'port-collision' = re-allocate the requested ports if in use
}

export interface DoctorReport {
  // existing fields …
  fixesAttempted: Array<{ name: string; ok: boolean; detail: string }>;
}
```

- [ ] **Step 2: Add `applyFixes` dispatch**

```typescript
async function applyFix(name: 'native-deps' | 'env-stub' | 'port-collision', i: DoctorInput, report: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  switch (name) {
    case 'native-deps':     return fixNativeDeps(i, report);
    case 'env-stub':        return fixEnvStub(i, report);
    case 'port-collision':  return fixPortCollision(i, report);
  }
}

export async function doctor(i: DoctorInput): Promise<DoctorReport> {
  const report = await runChecks(i); // existing logic, refactored into runChecks
  if (i.fix?.length) {
    for (const name of i.fix) {
      const result = await applyFix(name, i, report);
      report.fixesAttempted.push({ name, ...result });
    }
  }
  return report;
}
```

- [ ] **Step 3: Wire `--fix` CLI flag**

```typescript
program
  .command('doctor <target>')
  .option('--port <n...>', 'ports to verify')
  .option('--fix [names]', 'comma-separated list: native-deps,env-stub,port-collision (or "all")', '')
  .action(async (target, opts) => {
    const fix = opts.fix === 'all'
      ? ['native-deps', 'env-stub', 'port-collision'] as const
      : opts.fix ? opts.fix.split(',') : undefined;
    const report = await doctor({ target, ports: opts.port?.map(Number), fix });
    console.log(renderDoctorReport(report));
  });
```

- [ ] **Step 4: Commit (scaffolding only — fix bodies in A6-A8)**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/bin/contractqa.ts
git commit -m "feat(cli): doctor --fix scaffolding (dispatch only, fixers in subsequent tasks)"
```

---

### Task A6: `doctor --fix native-deps`

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts` (add `fixNativeDeps`)
- Create: `packages/cli/tests/fix-native-deps.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/fix-native-deps.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

describe('doctor --fix native-deps', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-fix-')); });

  it('attempts npm rebuild when better-sqlite3 ABI mismatch is detected', async () => {
    // Set up a fake target with better-sqlite3 in package.json
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { 'better-sqlite3': '^11' },
    }));
    const report = await doctor({ target: tmp, fix: ['native-deps'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    expect(fix!.detail).toContain('npm rebuild');
  });

  it('is a no-op when no native deps detected', async () => {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }));
    const report = await doctor({ target: tmp, fix: ['native-deps'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(/no native deps/i);
  });
});
```

- [ ] **Step 2: Implement `fixNativeDeps`**

```typescript
// in doctor.ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const NATIVE_DEPS = ['better-sqlite3', 'sqlite3', 'node-gyp', 'bcrypt', 'sharp', 'canvas'];

async function fixNativeDeps(i: DoctorInput, _report: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(await readFile(path.join(i.target, 'package.json'), 'utf8')); } catch {}
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const native = NATIVE_DEPS.filter((d) => d in all);
  if (native.length === 0) return { ok: true, detail: 'no native deps detected' };

  return new Promise((resolve) => {
    const child = spawn('npm', ['rebuild', ...native], { cwd: i.target, stdio: 'pipe' });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('close', (code) => {
      const detail = code === 0
        ? `npm rebuild ${native.join(' ')} OK`
        : `npm rebuild failed (exit ${code}): ${stderr.slice(0, 200)}`;
      resolve({ ok: code === 0, detail });
    });
  });
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter contractqa test fix-native-deps
```

Expected: PASS (the rebuild may take seconds on a real machine — vitest default timeout is 5s, may need `it('...', { timeout: 60_000 }, ...)`).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/tests/fix-native-deps.test.ts
git commit -m "feat(cli): doctor --fix=native-deps runs npm rebuild for detected native deps"
```

---

### Task A7: `doctor --fix env-stub`

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts` (add `fixEnvStub`)
- Create: `packages/cli/tests/fix-env-stub.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/fix-env-stub.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

describe('doctor --fix env-stub', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(path.join(tmpdir(), 'contractqa-env-')); });

  it('writes .env.local from .env.example when missing', async () => {
    await writeFile(path.join(tmp, '.env.example'), 'DATABASE_URL=postgres://example\nNEXTAUTH_SECRET=changeme\n');
    const report = await doctor({ target: tmp, fix: ['env-stub'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'env-stub');
    expect(fix!.ok).toBe(true);
    const written = await readFile(path.join(tmp, '.env.local'), 'utf8');
    expect(written).toContain('DATABASE_URL=postgres://example');
  });

  it('skips when .env.local already exists', async () => {
    await writeFile(path.join(tmp, '.env.example'), 'DATABASE_URL=postgres://example\n');
    await writeFile(path.join(tmp, '.env.local'), 'DATABASE_URL=actual-value\n');
    const report = await doctor({ target: tmp, fix: ['env-stub'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'env-stub');
    expect(fix!.detail).toMatch(/already exists/);
    const written = await readFile(path.join(tmp, '.env.local'), 'utf8');
    expect(written).toBe('DATABASE_URL=actual-value\n');
  });
});
```

- [ ] **Step 2: Implement `fixEnvStub`**

```typescript
async function fixEnvStub(i: DoctorInput, _report: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  const examplePath = path.join(i.target, '.env.example');
  const localPath = path.join(i.target, '.env.local');
  try {
    const example = await readFile(examplePath, 'utf8');
    try {
      await readFile(localPath, 'utf8');
      return { ok: true, detail: '.env.local already exists, skipped' };
    } catch {
      await writeFile(localPath, example);
      return { ok: true, detail: `.env.local written from .env.example (${example.split('\n').length - 1} lines)` };
    }
  } catch {
    return { ok: true, detail: 'no .env.example to stub from, skipped' };
  }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter contractqa test fix-env-stub
git add packages/cli/src/commands/doctor.ts packages/cli/tests/fix-env-stub.test.ts
git commit -m "feat(cli): doctor --fix=env-stub writes .env.local from .env.example"
```

---

### Task A8: `doctor --fix port-collision`

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts` (use Phase 2's `allocatePort`)
- Create: `packages/cli/tests/fix-port-collision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { doctor } from '../src/commands/doctor.js';

describe('doctor --fix port-collision', () => {
  it('re-allocates a free port when the requested port is held', async () => {
    const server = createServer().listen(0); // bind to ephemeral port
    await new Promise((r) => server.once('listening', r));
    const held = (server.address() as { port: number }).port;
    const report = await doctor({ target: process.cwd(), ports: [held], fix: ['port-collision'] });
    const fix = report.fixesAttempted.find((f) => f.name === 'port-collision');
    expect(fix!.ok).toBe(true);
    expect(fix!.detail).toMatch(new RegExp(`\\b${held}\\b`));
    expect(fix!.detail).toMatch(/reallocated|free port \d+/);
    server.close();
  });
});
```

- [ ] **Step 2: Implement `fixPortCollision`**

```typescript
import { allocatePort } from '../util/allocate-port.js'; // Phase 2 helper

async function fixPortCollision(i: DoctorInput, report: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  if (!i.ports?.length) return { ok: true, detail: 'no ports requested' };
  const swaps: string[] = [];
  for (const p of i.ports) {
    const free = await allocatePort({ preferred: p });
    if (free !== p) swaps.push(`${p} → ${free}`);
  }
  return swaps.length === 0
    ? { ok: true, detail: 'all requested ports free' }
    : { ok: true, detail: `reallocated: ${swaps.join(', ')}` };
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter contractqa test fix-port-collision
git add packages/cli/src/commands/doctor.ts packages/cli/tests/fix-port-collision.test.ts
git commit -m "feat(cli): doctor --fix=port-collision auto-allocates free ports"
```

---

### Task A9: Dogfood Part A — re-init all 5 Phase 2 targets

**Files:**
- Create: `dogfood/scripts/phase3-a-rerun.sh`
- Update: `dogfood/<each-target>/FINDINGS.md` with Phase 3 re-run notes

- [ ] **Step 1: Run `contractqa init` in a clean clone of each of the 5 Phase 2 targets**

For each target in `{5-4-codex, website_vercel-supabase-main, WolfMind-main, 5-4-claude, agent-poker-platform-gpt}`:

1. `cd /tmp && rm -rf <target>-clone && cp -r /path/to/<target> <target>-clone`
2. `cd /tmp/<target>-clone && rm -rf qa/ contractqa.config.ts`
3. `npx --package=file:/path/to/qa-agent/dist-host/contractqa-cli-0.3.0.tgz contractqa init --yes`
4. Compare generated `contractqa.config.ts` vs Phase 2's hand-written version. Document differences in `dogfood/<target>/FINDINGS.md` under a new `## Phase 3 init re-run` heading.
5. `contractqa scan` and confirm `qa/SCAN_REPORT.md` is sensible.
6. `contractqa doctor --fix=all <target-clone>` and confirm it remediates any setup issues the target had.

- [ ] **Step 2: Capture findings and decide gaps**

For each target, write one of:
- ✅ init scaffold matches Phase 2 hand-config (modulo whitespace)
- 🟡 init scaffold is close but missed `<thing>` → file a Phase 3a follow-up task or backlog it
- ❌ init scaffold wrong / unusable → must-fix before merging Part A

- [ ] **Step 3: Commit dogfood findings**

```bash
git add dogfood/scripts/phase3-a-rerun.sh dogfood/*/FINDINGS.md
git commit -m "dogfood(phase3-a): re-init across 5 Phase 2 targets — findings recorded"
```

**Part A acceptance:** All 5 targets get a ✅ or 🟡 (no ❌). Any 🟡 entries either get backlogged or fixed inline before moving to Part B.

---

# Part B: Real-cloud Supabase fixture + SupabaseAuthAdapter v2

**Acceptance gate B:** A new `dogfood/5-4-claude/contracts/login.contract.yaml` exercises real authentication against a local Supabase stack (started by the fixture scripts) and reaches a logged-in DOM state. `expectFullyLoggedOut` still asserts cleanly post-logout. CI runs the new lane behind an opt-in flag — default test suite remains stub-env.

---

### Task B1: Vendored docker-compose Supabase stack

**Files:**
- Create: `fixtures/supabase-stack/docker-compose.yml`
- Create: `fixtures/supabase-stack/.env`
- Create: `fixtures/supabase-stack/README.md`
- Create: `fixtures/supabase-stack/volumes/db/init/00-roles.sql`
- Create: `fixtures/supabase-stack/volumes/api/kong.yml`

- [ ] **Step 1: Vendor a pinned subset of Supabase's self-host compose**

Source of truth: `https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml` (read it; don't fetch live). Vendor with pinned image tags only — we don't need the Studio UI, analytics, or storage for auth tests.

Minimal services required:
- `db` — `supabase/postgres:15.6.1.146`
- `auth` (GoTrue) — `supabase/gotrue:v2.171.0`
- `rest` (PostgREST) — `postgrest/postgrest:v12.2.0`
- `kong` — `kong:2.8.1`
- `meta` — `supabase/postgres-meta:v0.84.2` (optional but Studio expects it)

```yaml
# fixtures/supabase-stack/docker-compose.yml (sketch)
services:
  db:
    image: supabase/postgres:15.6.1.146
    ports: ['54322:5432']
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./volumes/db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'postgres']
      interval: 2s
      timeout: 5s
      retries: 20
  auth:
    image: supabase/gotrue:v2.171.0
    depends_on: { db: { condition: service_healthy } }
    environment:
      GOTRUE_SITE_URL: http://localhost:3000
      GOTRUE_JWT_SECRET: ${JWT_SECRET}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/postgres
    ports: ['54321:9999']
  # ... rest, kong as needed
```

Pin every image tag. Document each in `README.md`.

- [ ] **Step 2: `.env` with development-only secrets**

```
POSTGRES_PASSWORD=postgres-dev
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...    # canned signed-with-JWT_SECRET
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # canned signed-with-JWT_SECRET
```

Add `fixtures/supabase-stack/.env` to `.gitignore.example` lines documented in the README; commit a sibling `.env.example` that's safe.

- [ ] **Step 3: Commit**

```bash
git add fixtures/supabase-stack
git commit -m "feat(fixtures): vendored docker-compose Supabase stack (postgres+gotrue+rest+kong, pinned tags)"
```

---

### Task B2: Harness scripts (up / seed / down)

**Files:**
- Create: `fixtures/supabase-stack/scripts/up.sh`
- Create: `fixtures/supabase-stack/scripts/down.sh`
- Create: `fixtures/supabase-stack/scripts/seed.sh`
- Create: `fixtures/supabase-stack/scripts/wait-for-health.sh`

- [ ] **Step 1: `up.sh` — start + wait**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d
bash scripts/wait-for-health.sh
echo "Supabase up at http://localhost:54321 (auth) / postgres://localhost:54322 (db)"
```

- [ ] **Step 2: `wait-for-health.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Waiting for db..."
for _ in {1..30}; do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "Waiting for auth..."
for _ in {1..30}; do
  if curl -sf http://localhost:54321/health >/dev/null; then break; fi
  sleep 1
done
echo "Healthy."
```

- [ ] **Step 3: `seed.sh` — create fixture users via GoTrue admin API**

```bash
#!/usr/bin/env bash
set -euo pipefail
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?must be set}"
AUTH_URL="${AUTH_URL:-http://localhost:54321}"

curl -sf -X POST "$AUTH_URL/admin/users" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"AdminPass123!","email_confirm":true,"user_metadata":{"role":"admin"}}'

curl -sf -X POST "$AUTH_URL/admin/users" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.test","password":"UserPass123!","email_confirm":true,"user_metadata":{"role":"user"}}'

echo "Seeded admin@example.test / user@example.test"
```

- [ ] **Step 4: `down.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down -v
echo "Supabase down + volumes pruned"
```

- [ ] **Step 5: Make executable + commit**

```bash
chmod +x fixtures/supabase-stack/scripts/*.sh
git add fixtures/supabase-stack/scripts
git commit -m "feat(fixtures): supabase stack up/seed/down scripts with health waits"
```

---

### Task B3: SupabaseAuthAdapter v2 implementation

**Files:**
- Modify: `packages/adapters/src/auth/supabase.ts` (replace `loginAs`/`currentUser` bodies, keep class name + options shape)
- Create: `packages/adapters/tests/supabase-v2.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/adapters/tests/supabase-v2.test.ts
import { describe, it, expect } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase.js';

// This test uses a fake `page` shim — no browser required.
function fakePage(state: Record<string, string> = {}) {
  return {
    async evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
      // simulate page.evaluate by passing fake globalThis with localStorage
      const localStorage = {
        getItem: (k: string) => state[k] ?? null,
        setItem: (k: string, v: string) => { state[k] = v; },
        removeItem: (k: string) => { delete state[k]; },
        get length() { return Object.keys(state).length; },
        key: (i: number) => Object.keys(state)[i] ?? null,
      };
      return (fn as unknown as (g: unknown, ...a: unknown[]) => T)({ localStorage }, ...args);
    },
    context: () => ({ cookies: async () => [] }),
  };
}

describe('SupabaseAuthAdapter v2', () => {
  it('loginAs injects a valid Supabase session into localStorage', async () => {
    const state: Record<string, string> = {};
    const page = fakePage(state);
    const adapter = new SupabaseAuthAdapter({
      url: 'http://localhost:54321',
      anonKey: 'fake-anon-key',
      projectRef: 'localhost', // for the sb-<ref>-auth-token key
      // injected fetcher so test doesn't hit real network
      tokenIssuer: async (role) => ({
        access_token: 'fake.jwt.token',
        refresh_token: 'refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'user-1', email: `${role}@example.test`, user_metadata: { role } },
      }),
    });
    await adapter.loginAs('admin', page as never);
    const stored = state['sb-localhost-auth-token'];
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored);
    expect(parsed.access_token).toBe('fake.jwt.token');
    expect(parsed.user.user_metadata.role).toBe('admin');
  });

  it('currentUser returns user from stored session', async () => {
    const state: Record<string, string> = {
      'sb-localhost-auth-token': JSON.stringify({
        access_token: 'x', refresh_token: 'y', expires_in: 3600, token_type: 'bearer',
        user: { id: 'user-2', user_metadata: { role: 'user' } },
      }),
    };
    const page = fakePage(state);
    const adapter = new SupabaseAuthAdapter({ url: 'http://localhost:54321', anonKey: 'fake', projectRef: 'localhost' });
    const u = await adapter.currentUser(page as never);
    expect(u).toEqual({ id: 'user-2', role: 'user' });
  });

  it('expectFullyLoggedOut detects sb-* localStorage keys', async () => {
    const state: Record<string, string> = { 'sb-localhost-auth-token': '{}' };
    const page = fakePage(state);
    const adapter = new SupabaseAuthAdapter({ url: 'http://localhost:54321', anonKey: 'fake', projectRef: 'localhost' });
    const r = await adapter.expectFullyLoggedOut(page as never);
    expect(r.fullyLoggedOut).toBe(false);
    expect(r.reasons[0]).toMatch(/sb-/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @contractqa/adapters test supabase-v2
```

Expected: FAIL. The Phase 1 `loginAs` throws.

- [ ] **Step 3: Rewrite `supabase.ts`**

```typescript
// packages/adapters/src/auth/supabase.ts
import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns, AuthResponsibility } from '@contractqa/core';

export interface SupabaseAuthAdapterOptions {
  url: string;          // e.g. http://localhost:54321
  anonKey: string;
  projectRef?: string;  // defaults to 'localhost' when url is local
  /**
   * Test-injectable token issuer. In prod, defaults to hitting GoTrue.
   * Each role must be representable as a fixture user (use the seed.sh ones for local dev).
   */
  tokenIssuer?: (role: string) => Promise<SupabaseSession>;
  /** Map role → fixture email/password. Used by the default tokenIssuer. */
  roleFixtures?: Record<string, { email: string; password: string }>;
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'bearer';
  user: { id: string; email?: string; user_metadata?: { role?: string } };
}

type PageLike = import('@contractqa/core').Page;

const DEFAULT_ROLE_FIXTURES: Record<string, { email: string; password: string }> = {
  admin: { email: 'admin@example.test', password: 'AdminPass123!' },
  user:  { email: 'user@example.test',  password: 'UserPass123!' },
};

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly provider = 'supabase' as const;
  readonly responsibilities: readonly AuthResponsibility[] = ['session'];
  private readonly projectRef: string;
  private readonly issuer: NonNullable<SupabaseAuthAdapterOptions['tokenIssuer']>;

  constructor(private readonly opts: SupabaseAuthAdapterOptions) {
    this.projectRef = opts.projectRef ?? 'localhost';
    this.issuer = opts.tokenIssuer ?? this.defaultIssuer.bind(this);
  }

  private async defaultIssuer(role: string): Promise<SupabaseSession> {
    const fixture = (this.opts.roleFixtures ?? DEFAULT_ROLE_FIXTURES)[role];
    if (!fixture) throw new Error(`No fixture for role "${role}". Provide roleFixtures or a tokenIssuer.`);
    const res = await fetch(`${this.opts.url}/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': this.opts.anonKey },
      body: JSON.stringify({ email: fixture.email, password: fixture.password }),
    });
    if (!res.ok) throw new Error(`GoTrue token request failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^sb-/, /^supabase\.auth\./],
      sessionStorage: [/^sb-/],
      cookies: [/^sb-/, /^supabase/],
    };
  }

  async loginAs(role: string, page: PageLike): Promise<void> {
    const session = await this.issuer(role);
    const key = `sb-${this.projectRef}-auth-token`;
    const value = JSON.stringify(session);
    await page.evaluate(
      (g: unknown, args: { key: string; value: string }) => {
        (g as { localStorage: Storage }).localStorage.setItem(args.key, args.value);
      },
      { key, value },
    );
  }

  async isAuthenticated(page: PageLike): Promise<boolean> {
    const r = await this.expectFullyLoggedOut(page);
    return !r.fullyLoggedOut;
  }

  async currentUser(page: PageLike): Promise<{ id: string; role: string } | null> {
    const key = `sb-${this.projectRef}-auth-token`;
    const raw = await page.evaluate(
      (g: unknown, k: string) => (g as { localStorage: Storage }).localStorage.getItem(k),
      key,
    );
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as SupabaseSession;
      return { id: session.user.id, role: session.user.user_metadata?.role ?? 'user' };
    } catch { return null; }
  }

  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const localKeys = await page.evaluate(() =>
      Object.keys((globalThis as { localStorage?: Storage }).localStorage ?? {}),
    );
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons: string[] = [];
    for (const k of localKeys) {
      if (pats.localStorage.some((r) => r.test(k))) reasons.push(`localStorage key ${k} still present`);
    }
    for (const c of cookies) {
      if (pats.cookies.some((r) => r.test(c.name))) reasons.push(`cookie ${c.name} still present`);
    }
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
```

- [ ] **Step 4: Re-run tests, then rebuild core (we know about the stale-dist trap from today)**

```bash
pnpm --filter @contractqa/core build
pnpm --filter @contractqa/adapters test supabase-v2
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/auth/supabase.ts packages/adapters/tests/supabase-v2.test.ts
git commit -m "feat(adapters): SupabaseAuthAdapter v2 — real loginAs + currentUser via injectable issuer"
```

---

### Task B4: Compose v2 with Phase 2's cookie adapter (multi-adapter scenarios)

**Files:**
- Create: `packages/adapters/tests/supabase-compose.test.ts`

- [ ] **Step 1: Write the composition test**

The Phase 2 `composeAuth([adapter, ...])` adapter-of-adapters should route `loginAs` to Supabase v2 (session responsibility) and `currentUser` to a UserStoreAdapter (user-store responsibility). Verify it.

```typescript
import { describe, it, expect } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase.js';
import { composeAuth } from '../src/auth/composite.js';
import type { AuthAdapter } from '@contractqa/core';

const fakeUserStore: AuthAdapter = {
  provider: 'custom',
  responsibilities: ['user-store'],
  async loginAs() { /* never called */ },
  async isAuthenticated() { return true; },
  async currentUser() { return { id: 'from-userstore', role: 'admin' }; },
  sessionKeyPatterns() { return { localStorage: [], sessionStorage: [], cookies: [] }; },
  async expectFullyLoggedOut() { return { fullyLoggedOut: true, reasons: [] }; },
};

describe('composeAuth(supabase v2, userstore)', () => {
  it('delegates loginAs to Supabase (session owner) and currentUser to UserStore', async () => {
    const sb = new SupabaseAuthAdapter({
      url: 'http://localhost:54321',
      anonKey: 'fake',
      projectRef: 'localhost',
      tokenIssuer: async () => ({
        access_token: 't', refresh_token: 'r', expires_in: 3600, token_type: 'bearer',
        user: { id: 'sb-user', user_metadata: { role: 'admin' } },
      }),
    });
    const composed = composeAuth([sb, fakeUserStore]);
    // ...assert composed.currentUser returns the user-store identity, not the sb-localStorage one
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @contractqa/adapters test supabase-compose
git add packages/adapters/tests/supabase-compose.test.ts
git commit -m "test(adapters): supabase v2 + user-store composition routes per-responsibility"
```

---

### Task B5: Dogfood 5-4-claude with real-auth contract

**Files:**
- Create: `dogfood/5-4-claude/qa/contracts/login.contract.yaml`
- Modify: `dogfood/5-4-claude/qa/adapters/auth.ts` (wire SupabaseAuthAdapter v2)
- Update: `dogfood/5-4-claude/FINDINGS.md`
- Create: `dogfood/5-4-claude/scripts/test-real-cloud.sh`

- [ ] **Step 1: Write the login contract**

```yaml
# dogfood/5-4-claude/qa/contracts/login.contract.yaml
name: login-supabase
description: User logs in via Supabase and reaches the dashboard
target:
  url: /
  within: null
goto:
  wait: networkidle
auth:
  loginAs: user
oracle:
  console: { error: { max: 0 } }
  dom:
    contains_text: ['Welcome', 'Dashboard']
    not_contains_text: ['Sign in', 'Log in']
```

- [ ] **Step 2: Wire `qa/adapters/auth.ts`**

```typescript
import { SupabaseAuthAdapter } from '@contractqa/adapters/public';

export const auth = new SupabaseAuthAdapter({
  url: process.env.SUPABASE_URL ?? 'http://localhost:54321',
  anonKey: process.env.SUPABASE_ANON_KEY ?? 'fake',
  projectRef: 'localhost',
});
```

- [ ] **Step 3: Real-cloud test script**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Bringing up Supabase..."
bash ../../fixtures/supabase-stack/scripts/up.sh
echo "Seeding fixture users..."
SUPABASE_URL=http://localhost:54321 \
SERVICE_ROLE_KEY=$(grep ^SERVICE_ROLE_KEY ../../fixtures/supabase-stack/.env | cut -d= -f2) \
bash ../../fixtures/supabase-stack/scripts/seed.sh
echo "Running 5-4-claude contracts..."
pnpm --filter @contractqa/dogfood-5-4-claude test
bash ../../fixtures/supabase-stack/scripts/down.sh
```

- [ ] **Step 4: Run end-to-end**

```bash
bash dogfood/5-4-claude/scripts/test-real-cloud.sh
```

Expected: contract verdict PASS, attachments include screenshot of logged-in dashboard.

- [ ] **Step 5: Commit**

```bash
git add dogfood/5-4-claude
git commit -m "dogfood(5-4-claude): real-cloud login contract — SupabaseAuthAdapter v2 + docker fixture"
```

---

### Task B6: CI integration (opt-in real-cloud lane)

**Files:**
- Create: `.github/workflows/real-cloud.yml`
- Modify: `scripts/phase3-acceptance.sh` (add `--real-cloud` flag)

- [ ] **Step 1: Workflow file**

```yaml
# .github/workflows/real-cloud.yml
name: Real-cloud lane
on:
  workflow_dispatch:
  pull_request:
    paths:
      - 'fixtures/supabase-stack/**'
      - 'packages/adapters/src/auth/supabase.ts'
      - 'dogfood/5-4-claude/**'

jobs:
  real-cloud:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: bash fixtures/supabase-stack/scripts/up.sh
      - run: bash fixtures/supabase-stack/scripts/seed.sh
      - run: bash dogfood/5-4-claude/scripts/test-real-cloud.sh
      - if: always()
        run: bash fixtures/supabase-stack/scripts/down.sh
```

- [ ] **Step 2: Acceptance script flag**

```bash
# scripts/phase3-acceptance.sh (excerpt)
if [[ "${1:-}" == "--real-cloud" ]]; then
  bash fixtures/supabase-stack/scripts/up.sh
  bash fixtures/supabase-stack/scripts/seed.sh
  bash dogfood/5-4-claude/scripts/test-real-cloud.sh
  bash fixtures/supabase-stack/scripts/down.sh
fi
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/real-cloud.yml scripts/phase3-acceptance.sh
git commit -m "feat(ci): opt-in real-cloud workflow + acceptance --real-cloud flag"
```

---

### Task B7: Stub-env fallback path preserved

Verify that running 5-4-claude's existing render-only contract (Phase 2's `qa/contracts/render.contract.yaml`) STILL passes with no docker-compose running and no env vars set. This is a no-code task — just run the Phase 2 contract and confirm it passes unchanged.

- [ ] **Step 1: Run**

```bash
cd dogfood/5-4-claude && pnpm test
```

Expected: render contract PASS (stub mode), login contract SKIPPED or marked needs-real-cloud.

- [ ] **Step 2: If login contract errors out instead of skipping, fix the skip logic and commit:**

```bash
git add dogfood/5-4-claude/qa/contracts/login.contract.yaml
git commit -m "fix(dogfood): login contract skips cleanly when SUPABASE_URL unset"
```

**Part B acceptance:** Stub-env still passes (Phase 2 invariant preserved); real-cloud lane passes when docker is up and seeded.

---

# Part C: Public adapter API (`@contractqa/adapters`)

**Acceptance gate C:** `@contractqa/adapters/public` exports a documented, semver-stable surface. An out-of-tree adapter built from the starter template installs into a Phase 2 target via `npm i file:` and runs a contract successfully.

---

### Task C1: Stability boundary (`src/public.ts`)

**Files:**
- Create: `packages/adapters/src/public.ts`
- Create: `packages/adapters/tests/public-surface.test.ts`

- [ ] **Step 1: Write the surface test**

```typescript
// packages/adapters/tests/public-surface.test.ts
import { describe, it, expect } from 'vitest';
import * as Public from '../src/public.js';

describe('@contractqa/adapters/public surface', () => {
  it('exports the documented stable API and nothing else', () => {
    const expected = new Set([
      // Adapter interfaces (re-exported types)
      // Types are compile-time only, so we list the runtime exports here.
      'NextAuthAdapter',
      'SupabaseAuthAdapter',
      'CustomCookieAuthAdapter',
      'composeAuth',
      // Backends
      'PostgresBackendAdapter', // empty stub; full Phase 4
    ]);
    const actual = new Set(Object.keys(Public));
    expect(actual).toEqual(expected);
  });
});
```

- [ ] **Step 2: Implement `src/public.ts`**

```typescript
/**
 * @contractqa/adapters/public
 *
 * Public, semver-stable surface. Anything not exported here is internal
 * and may change without notice.
 *
 * See STABILITY.md for the break policy.
 */

/** @stable */
export type {
  AuthAdapter,
  AppAdapter,
  BackendAdapter,
  SessionKeyPatterns,
  AuthResponsibility,
  AuthProviderName,
  SeedProfile,
  SchemaDescriptor,
} from '@contractqa/core';

/** @stable */
export { NextAuthAdapter } from './auth/next-auth.js';

/** @stable */
export { SupabaseAuthAdapter } from './auth/supabase.js';

/** @stable */
export { CustomCookieAuthAdapter } from './auth/custom-cookie.js';

/** @stable */
export { composeAuth } from './auth/composite.js';

/** @stable @experimental Phase 4 will fill in the body. */
export { PostgresBackendAdapter } from './backend/postgres-stub.js';
```

- [ ] **Step 3: Create the experimental backend stub so the public export resolves**

```typescript
// packages/adapters/src/backend/postgres-stub.ts
import type { BackendAdapter } from '@contractqa/core';

export class PostgresBackendAdapter implements BackendAdapter {
  readonly kind = 'postgres' as const;
  describe() { throw new Error('PostgresBackendAdapter is a Phase 4 stub; not yet implemented'); }
  async query() { throw new Error('PostgresBackendAdapter is a Phase 4 stub; not yet implemented'); }
}
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter @contractqa/adapters test public-surface
git add packages/adapters/src/public.ts packages/adapters/src/backend/postgres-stub.ts packages/adapters/tests/public-surface.test.ts
git commit -m "feat(adapters): public stability boundary src/public.ts (semver-stable surface)"
```

---

### Task C2: `package.json` exports + publishConfig

**Files:**
- Modify: `packages/adapters/package.json`

- [ ] **Step 1: Update `exports` and add publishConfig**

```json
{
  "name": "@contractqa/adapters",
  "version": "0.3.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./public": { "import": "./dist/public.js", "types": "./dist/public.d.ts" }
  },
  "files": ["dist", "STABILITY.md", "README.md"],
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 2: Verify the new entry resolves**

```bash
pnpm --filter @contractqa/adapters build
node -e "import('@contractqa/adapters/public').then(m => console.log(Object.keys(m)))"
```

Expected output: `[ 'NextAuthAdapter', 'SupabaseAuthAdapter', 'CustomCookieAuthAdapter', 'composeAuth', 'PostgresBackendAdapter' ]`.

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/package.json
git commit -m "feat(adapters): publish-ready exports map with /public stable entry"
```

---

### Task C3: `STABILITY.md` break policy

**Files:**
- Create: `packages/adapters/STABILITY.md`

- [ ] **Step 1: Author the policy**

```markdown
# `@contractqa/adapters` Stability Policy

## Public surface

The only stable, semver-protected surface is what is re-exported from
`@contractqa/adapters/public`. Importing from `@contractqa/adapters` (root)
or from any deep path is **internal** and may change without notice.

Exports marked `@stable` follow semver:
- **Patch:** bug fixes that don't change the type signature
- **Minor:** additive type changes (new methods, optional fields, new
  exports)
- **Major:** removals, renames, narrowing of existing types, or
  behavior changes that would break a consumer following the public docs

Exports marked `@experimental` may break in any minor release. They are
documented in the changelog with a deprecation note when promoted to
`@stable` or removed.

## Deprecation window

Stable exports flagged for removal MUST:
1. Get an `@deprecated` JSDoc tag in the minor that announces removal.
2. Stay available for at least one full minor cycle.
3. Be removed in the next major.

## What counts as a break

- Renaming a stable export
- Removing a stable export without going through deprecation
- Narrowing a stable type (e.g. `string` → `'a' | 'b'`)
- Changing the runtime behavior of `composeAuth`'s delegation order
- Changing which keys `SupabaseAuthAdapter` writes to localStorage

## What does NOT count as a break

- Adding new exports
- Adding optional fields to stable interfaces
- Widening a stable type (e.g. `'a' | 'b'` → `string`)
- Changes to anything not re-exported from `./public`
- Changes inside `dogfood/` or `fixtures/`

## Reporting a break

Open an issue tagged `breaking-change` with the version pair and a
minimal repro. We will either revert, patch, or document the rationale
+ migration path within one week.
```

- [ ] **Step 2: Commit**

```bash
git add packages/adapters/STABILITY.md
git commit -m "docs(adapters): STABILITY.md — semver policy for the /public surface"
```

---

### Task C4: Third-party adapter starter template

**Files:**
- Create: `packages/adapters/templates/third-party/package.json`
- Create: `packages/adapters/templates/third-party/tsconfig.json`
- Create: `packages/adapters/templates/third-party/src/index.ts`
- Create: `packages/adapters/templates/third-party/README.md`
- Create: `docs/adapters/writing-your-own.md`

- [ ] **Step 1: Starter package skeleton**

```json
// packages/adapters/templates/third-party/package.json
{
  "name": "contractqa-adapter-example",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "@contractqa/adapters": "^0.3.0" },
  "devDependencies": { "typescript": "^5.7.2" }
}
```

```typescript
// packages/adapters/templates/third-party/src/index.ts
import type { AuthAdapter, SessionKeyPatterns, AuthStateAssertion } from '@contractqa/adapters/public';

export class ExampleAuthAdapter implements AuthAdapter {
  readonly provider = 'custom' as const;

  sessionKeyPatterns(): SessionKeyPatterns {
    return { localStorage: [/^myapp\./], sessionStorage: [], cookies: [/^myapp_/] };
  }

  async loginAs(role: string): Promise<void> {
    throw new Error(`Implement loginAs(${role}, page) for your app's login flow`);
  }

  async isAuthenticated(): Promise<boolean> { return false; }
  async currentUser(): Promise<{ id: string; role: string } | null> { return null; }
  async expectFullyLoggedOut(): Promise<AuthStateAssertion> {
    return { fullyLoggedOut: true, reasons: [] };
  }
}
```

- [ ] **Step 2: Write `docs/adapters/writing-your-own.md`**

Document the four-step path:
1. Copy the starter template
2. Implement the methods listed
3. `npm i file:./contractqa-adapter-example` into your target
4. Reference it from `qa/adapters/auth.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/templates docs/adapters
git commit -m "feat(adapters): third-party adapter starter template + writing-your-own guide"
```

---

### Task C5: Out-of-tree adapter smoke test

**Files:**
- Create: `scripts/test-third-party-adapter.sh`

- [ ] **Step 1: Smoke script**

```bash
#!/usr/bin/env bash
set -euo pipefail
TMP=$(mktemp -d)
echo "Building local @contractqa/adapters tarball..."
bash scripts/pack-for-host.sh "$TMP/host-pkgs"
ADAPTER_TGZ=$(ls "$TMP/host-pkgs"/contractqa-adapters-*.tgz)

echo "Copying starter template..."
cp -r packages/adapters/templates/third-party "$TMP/example-adapter"
cd "$TMP/example-adapter"
sed -i.bak "s#\"@contractqa/adapters\": \"\\^0.3.0\"#\"@contractqa/adapters\": \"file:$ADAPTER_TGZ\"#" package.json
npm install
npm run build
test -f dist/index.js || { echo "Build did not produce dist/index.js"; exit 1; }

echo "OK — out-of-tree adapter builds against the published surface."
```

- [ ] **Step 2: Run + commit**

```bash
chmod +x scripts/test-third-party-adapter.sh
bash scripts/test-third-party-adapter.sh
git add scripts/test-third-party-adapter.sh
git commit -m "test: out-of-tree adapter builds against @contractqa/adapters/public surface"
```

---

### Task C6: Design doc update (§7.6.5 reversal)

**Files:**
- Modify: `claude_code_qa_agent_design.md` (§7.6.5)

- [ ] **Step 1: Update §7.6.5**

Find the existing "Public adapter API gated to v0.5+" paragraph and replace with:

```markdown
### §7.6.5 Public adapter API (opened in Phase 3 / v0.3.0)

Phase 3 reverses the original v0.5+ gate. `@contractqa/adapters/public`
is now the semver-stable surface. See `packages/adapters/STABILITY.md`
for the policy. The original concern — that adapter shapes were still
churning — is mitigated by:
1. Only the `/public` entry is stable; internal modules can still churn.
2. `@experimental` tag exists for not-yet-stable types like
   `BackendAdapter` (Phase 4 will finalize).
3. `composeAuth` + `AuthResponsibility` (Phase 2) gave us a clean
   composition primitive, so future churn happens via composition
   rather than interface mutation.
```

- [ ] **Step 2: Commit**

```bash
git add claude_code_qa_agent_design.md
git commit -m "docs(design): §7.6.5 reversal — public adapter API opens in Phase 3 / v0.3.0"
```

**Part C acceptance:** `node -e "import('@contractqa/adapters/public').then(m => Object.keys(m))"` lists exactly the documented exports; out-of-tree starter builds; STABILITY.md exists and §7.6.5 reflects the reversal.

---

# Cross-part: Acceptance + release

### Task D1: Fix the acceptance-script ordering bug (today's discovery)

**Files:**
- Modify: `scripts/phase2-acceptance.sh` (rename to `phase3-acceptance.sh` in D2; this D1 patches the immediate bug)

- [ ] **Step 1: Reorder — `build` before `typecheck`**

```bash
# scripts/phase2-acceptance.sh — replace the first three sections with:
echo "--- build (must precede typecheck — downstream packages typecheck against dist/)"
pnpm -r --filter './packages/**' build

echo "--- typecheck"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests"
pnpm -r --filter './packages/**' test
```

- [ ] **Step 2: Verify on a clean tree**

```bash
rm -rf packages/*/dist
./scripts/phase2-acceptance.sh
```

Expected: passes end-to-end on first run (no manual `pnpm build` needed first).

- [ ] **Step 3: Commit**

```bash
git add scripts/phase2-acceptance.sh
git commit -m "fix(scripts): build before typecheck (downstream packages resolve @contractqa/core via dist/)"
```

---

### Task D2: `scripts/phase3-acceptance.sh`

**Files:**
- Create: `scripts/phase3-acceptance.sh`

- [ ] **Step 1: Author the new script**

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "== ContractQA Phase 3 acceptance =="

echo "--- build"
pnpm -r --filter './packages/**' build

echo "--- typecheck"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests"
pnpm -r --filter './packages/**' test

echo "--- Part A: init + scan smoke (against 5 Phase 2 targets)"
bash dogfood/scripts/phase3-a-rerun.sh

echo "--- Part A: doctor --fix smoke (5-4-codex)"
node packages/cli/dist/bin/contractqa.js doctor /Users/zmy/intership/5/5-4-codex --port 3287 --port 5287 --fix=all

echo "--- Part B: stub-env still passes"
pnpm --filter @contractqa/dogfood-5-4-claude test

if [[ "${1:-}" == "--real-cloud" ]]; then
  echo "--- Part B: real-cloud lane"
  bash fixtures/supabase-stack/scripts/up.sh
  bash fixtures/supabase-stack/scripts/seed.sh
  bash dogfood/5-4-claude/scripts/test-real-cloud.sh
  bash fixtures/supabase-stack/scripts/down.sh
fi

echo "--- Part C: public surface + out-of-tree adapter"
bash scripts/test-third-party-adapter.sh

echo "OK — Phase 3 acceptance passed."
```

- [ ] **Step 2: Commit**

```bash
chmod +x scripts/phase3-acceptance.sh
git add scripts/phase3-acceptance.sh
git commit -m "chore: scripts/phase3-acceptance.sh — Parts A/B/C + opt-in --real-cloud"
```

---

### Task D3: Version bump + CHANGELOG + tag

**Files:**
- Modify: every `packages/*/package.json` (`version: 0.1.0` → `0.3.0`)
- Modify: `package.json` (root, if it has a version)
- Modify: `CHANGELOG.md` (or create)
- Modify: `dogfood/FINDINGS.md` — mark Phase 3 anchors RESOLVED, BackendAdapter still DEFERRED

- [ ] **Step 1: Bump all package versions**

```bash
find packages -name package.json -not -path '*/node_modules/*' -exec \
  sed -i.bak 's/"version": "0.1.0"/"version": "0.3.0"/' {} \;
find packages -name 'package.json.bak' -delete
```

- [ ] **Step 2: Bump `VERSION` constant**

```typescript
// packages/core/src/index.ts
export const VERSION = '0.3.0';
```

- [ ] **Step 3: CHANGELOG entry**

```markdown
## v0.3.0 — 2026-05-?? (Phase 3)

### Added
- `contractqa init` — auto-detects framework (Next.js / Vite / Astro / unknown) and writes per-framework scaffolds. `--force` to overwrite, `--framework` to override detection.
- `contractqa scan` — produces `qa/SCAN_REPORT.md` listing detected framework, auth signals, routes, and suggested contracts.
- `contractqa doctor --fix` — auto-remediates `better-sqlite3` ABI mismatches (`native-deps`), missing `.env.local` (`env-stub`), and port collisions (`port-collision`). `--fix=all` runs every fixer.
- `SupabaseAuthAdapter` v2 — real default `loginAs` against local GoTrue (was: Phase 1 threw). Injectable `tokenIssuer` for tests; `roleFixtures` for seeded users.
- `fixtures/supabase-stack/` — vendored docker-compose stack (Postgres + GoTrue + PostgREST + Kong, pinned image tags) with `up.sh` / `seed.sh` / `down.sh`.
- `@contractqa/adapters/public` — semver-stable third-party adapter surface. See `packages/adapters/STABILITY.md`.
- Third-party adapter starter template at `packages/adapters/templates/third-party/`.
- Opt-in real-cloud CI workflow (`.github/workflows/real-cloud.yml`).

### Changed
- `scripts/phase2-acceptance.sh` reorders `build` before `typecheck` (downstream packages were typechecking against stale `dist/.d.ts`).

### Documentation
- Design doc §7.6.5 reversal: public adapter API opens in v0.3.0 (was: gated to v0.5+).

### Still deferred
- `BackendAdapter` for HTTP-API-only repos (Phase 4 anchor candidate).
- TypeScript project references (`tsc -b`) — D1 acceptance-script reorder is the cheaper mitigation.
- Dashboard §15.3–§15.6.
- Persona dogfood agents.
- Property/model-based test generation.
```

- [ ] **Step 4: Update FINDINGS.md status table**

In `dogfood/FINDINGS.md`, mark:
- `contractqa init` framework detection → ✅ RESOLVED (Task A1-A3)
- `contractqa doctor --fix` → ✅ RESOLVED (A5-A8)
- SupabaseAuthAdapter v2 → ✅ RESOLVED (B3)
- Real-Supabase fixture → ✅ RESOLVED (B1-B2)
- Public adapter API → ✅ RESOLVED (C1-C6)
- `BackendAdapter` → ⏳ STILL DEFERRED (Phase 4)
- TS project references → ⏳ STILL DEFERRED (D1 mitigation accepted for now)

- [ ] **Step 5: Final acceptance run**

```bash
./scripts/phase3-acceptance.sh
./scripts/phase3-acceptance.sh --real-cloud   # requires docker
```

Both must end in `OK — Phase 3 acceptance passed.`.

- [ ] **Step 6: Tag**

```bash
git add -A
git commit -m "chore: bump to v0.3.0 + CHANGELOG + FINDINGS update"
git tag v0.3.0
```

---

## Phase 3 acceptance criteria (mapped from anchors)

| Anchor | Tasks | Acceptance |
|---|---|---|
| `contractqa init` / `scan` framework detection | A1–A4, A9 | All 5 Phase 2 targets get a working scaffold from one command; SCAN_REPORT.md lists routes + suggested contracts |
| `contractqa doctor --fix` | A5–A8, A9 | `--fix=all` against 5-4-codex remediates `better-sqlite3` ABI + any missing `.env.local` + reallocates colliding ports |
| `SupabaseAuthAdapter v2` | B1–B7 | 5-4-claude logs in via real Supabase; stub-env fallback still PASS; CI lane gated behind `--real-cloud` |
| Public adapter API | C1–C6 | `@contractqa/adapters/public` exports documented stable surface; out-of-tree adapter builds + installs |
| Cross-part hygiene | D1–D3 | Acceptance script no longer needs a manual `pnpm build` first; v0.3.0 tagged; CHANGELOG written |

---

## Out of Phase 3 (Phase 4 candidates)

- `BackendAdapter` for HTTP-API-only repos (the one dropped from Phase 3's anchor vote).
- Dashboard §15.3–§15.6 (still hasn't shipped from any phase).
- Persona dogfood agents.
- Property/model-based test generation.
- TypeScript project references via `tsc -b` (`scripts/phase3-acceptance.sh` reordering is the accepted cheap mitigation; project references is the real fix).
- Publish to npm (`@contractqa/adapters`, `@contractqa/core`, `contractqa`). v0.3.0 prepares the surface; the actual `pnpm publish` is user-gated.
- Hybrid-auth scanner (`contractqa scan --detect-auth`) — basic detection is in scan, but the multi-provider hybrid case (e.g. NextAuth-for-session + Supabase-for-user-store) still requires manual `composeAuth`.
- `contractqa scan --suggest-contracts` writes runnable YAML in addition to the markdown report.

---

## Risk register

- **Docker dependency in CI raises the floor.** Part B's CI lane needs Docker to be available on the runner. If GitHub Actions kills Docker support or the Supabase images break compatibility, Part B's real-cloud lane breaks. Mitigation: stub-env fallback (B7) means default test path is unaffected; real-cloud lane is opt-in.

- **`@contractqa/adapters/public` is a semver commitment.** Once shipped in v0.3.0, breaking the surface costs a major bump and a deprecation cycle. Mitigation: STABILITY.md is explicit; `@experimental` tag for not-yet-stable types (`PostgresBackendAdapter`).

- **Framework detection is heuristic.** A1's detector will get false negatives on non-mainstream framework setups (Nuxt monorepos with weird `package.json` layouts, custom Vite configs that look like Next.js). Mitigation: `--framework <name>` override flag; `scan` is read-only so wrong detection isn't destructive; init refuses to overwrite without `--force`.

- **`doctor --fix=native-deps` runs `npm rebuild` which can be slow + can fail in restricted environments.** A user with `--fix=all` might hit a 60-second pause. Mitigation: documented in `--help`; individually-flaggable so users can skip native-deps. Timeout vitest tests appropriately (`{ timeout: 60_000 }`).

- **Supabase docker image-tag drift.** Pinned tags will go stale; security patches may force updates that break the schema. Mitigation: Phase 4 should add a `fixtures/supabase-stack/UPGRADE.md` runbook; for now, the README documents which tags are pinned.

- **Three-anchor scope (vs. asked-for 1-2).** Phase 3 is ~24 tasks. If the executor runs long, the cheapest single anchor to defer is C (Public adapter API) — A and B both have direct user-visible value at the dogfood layer, C is mostly infrastructure for hypothetical third-party adopters.

---

## Self-review notes (for the executor)

This plan was self-reviewed against `dogfood/FINDINGS.md` and the Phase 2 plan's "Out of Phase 2" section. Every CEO 鸭 verdict from 2026-05-14 maps to a task above:

| Verdict | Lives in |
|---|---|
| `contractqa init/scan` anchor | Part A (A1-A4) |
| `contractqa doctor --fix` anchor | Part A (A5-A8) |
| `SupabaseAuthAdapter v2` anchor | Part B (B3) |
| Docker-compose Supabase fixture | Part B (B1-B2) |
| Public adapter API opens in Phase 3 | Part C (C1-C3) |
| Design doc §7.6.5 reversal | Part C (C6) |
| BackendAdapter dropped | "Out of Phase 3" (Phase 4 candidate) |
| Today's acceptance-script ordering bug | D1 |
| Tomorrow's `tsc -b` project references | "Out of Phase 3" (D1 is the cheap mitigation) |

Executor notes:
- Each Part has its own acceptance gate. Don't proceed to Part B until A acceptance passes; same for C. Worktrees A and C can be parallel (per Phase 2 pattern); B should wait at least until A1-A3 are merged so `contractqa init` exists for the B5 dogfood step.
- The `pnpm --filter @contractqa/core build` step in B3 is non-negotiable — today's resume-session debug shows downstream packages typecheck against stale `dist/`.
- B6's CI workflow needs the `SERVICE_ROLE_KEY` and `JWT_SECRET` from `.env`; do NOT commit `.env` to the repo. The example secrets in B1 step 2 are development-only and safe.
- C5 (out-of-tree adapter test) depends on D1's acceptance-script reorder being merged — otherwise the C5 `pack-for-host.sh` invocation will trip the same stale-dist bug.
