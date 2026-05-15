import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, detectFrameworkInRepo, type DetectResult, type AuthSignal } from '../init/detect-framework.js';
import { inspectAuthWiring, type AuthDiagnostic } from '../init/inspect-auth.js';

export interface ScanReport {
  framework: DetectResult['framework'];
  confidence: number;
  authSignals: readonly string[];
  routes: string[];
  evidence: readonly string[];
  markdown: string;
  scanRoot: string;
  candidates?: ReadonlyArray<{ subdir: string; framework: DetectResult['framework']; confidence: number }>;
  authDiagnostics?: readonly AuthDiagnostic[];
}

async function walk(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, rel)));
    else out.push(rel);
  }
  return out;
}

const SESSION_OWNER_PRIORITY: readonly AuthSignal[] = [
  'next-auth', 'clerk', 'supabase', 'auth0', 'custom-cookie',
];

function pickSessionOwner(diagnostics: readonly AuthDiagnostic[]): AuthSignal {
  const withMw = diagnostics.filter((d) => d.hasMiddleware);
  if (withMw.length === 1) return withMw[0]!.provider;
  const pool = withMw.length > 0 ? withMw : diagnostics;
  for (const p of SESSION_OWNER_PRIORITY) {
    const hit = pool.find((d) => d.provider === p);
    if (hit) return hit.provider;
  }
  return pool[0]!.provider;
}

function deriveRoutes(framework: DetectResult['framework'], files: readonly string[]): string[] {
  if (framework === 'next-app') {
    return files
      .filter((f) => /^(src\/)?app\/.*page\.(tsx|ts|jsx|js)$/.test(f))
      .map((f) => {
        // Strip leading 'app/' or 'src/app/' and trailing '/page.ext' (or 'page.ext' for root)
        const seg = f.replace(/^(src\/)?app\//, '').replace(/(\/)?page\.[^.]+$/, '');
        return seg === '' ? '/' : `/${seg}`;
      })
      .sort();
  }
  if (framework === 'next-pages') {
    return files
      .filter((f) => /^(src\/)?pages\/.*\.(tsx|ts|jsx|js)$/.test(f) && !/_app|_document|api\//.test(f))
      .map((f) => '/' + f.replace(/^(src\/)?pages\//, '').replace(/\.[^.]+$/, '').replace(/index$/, ''))
      .map((r) => (r === '/' ? '/' : r.replace(/\/$/, '')))
      .sort();
  }
  return ['/'];
}

export async function scanProject(opts: { cwd: string; target?: string; detectAuth?: boolean }): Promise<ScanReport> {
  let scanRoot = opts.cwd;
  let candidates: ScanReport['candidates'];

  if (opts.target) {
    scanRoot = path.join(opts.cwd, opts.target);
  } else {
    const repo = await detectFrameworkInRepo(opts.cwd);
    if (repo.candidates.length > 0) {
      const top = repo.candidates[0]!;
      if (top.subdir !== '.') scanRoot = path.join(opts.cwd, top.subdir);
      candidates = repo.candidates.map((c) => ({
        subdir: c.subdir, framework: c.framework, confidence: c.confidence,
      }));
    }
  }

  const pkg = await readFile(path.join(scanRoot, 'package.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> })
    .catch(() => ({} as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }));
  const files = await walk(scanRoot);
  const detected = await detectFramework({ packageJson: pkg, files });
  const routes = deriveRoutes(detected.framework, files);

  let authDiagnostics: readonly AuthDiagnostic[] | undefined;
  if (opts.detectAuth && detected.authSignals.length > 0) {
    authDiagnostics = inspectAuthWiring({
      files,
      signals: detected.authSignals,
    });
  }

  const lines: string[] = [
    '# ContractQA scan report',
    '',
    `**Scan root:** ${path.relative(opts.cwd, scanRoot) || '.'}`,
    `**Framework:** ${detected.framework} (confidence ${detected.confidence.toFixed(2)})`,
    `**Auth signals:** ${detected.authSignals.join(', ') || '(none)'}`,
    '',
  ];
  if (candidates && candidates.length > 1) {
    lines.push('## Other detected candidates');
    for (const c of candidates.slice(1)) {
      lines.push(`- \`${c.subdir}\`: ${c.framework} (confidence ${c.confidence.toFixed(2)})`);
    }
    lines.push('');
  }
  lines.push(
    '## Routes',
    ...routes.map((r) => `- \`${r}\``),
    '',
    '## Suggested contracts',
    ...routes.map((r) => `- smoke: \`${r}\` renders without console errors`),
    '',
    '## Evidence',
    ...detected.evidence.map((e) => `- ${e}`),
  );

  // Hybrid auth section (Phase 6)
  if (authDiagnostics && authDiagnostics.length >= 2) {
    const owner = pickSessionOwner(authDiagnostics);
    lines.push(
      '',
      '## Hybrid auth',
      '',
      'Two or more auth providers detected. Use `composeAuth` from `@contractqa/adapters` to route per-responsibility.',
      '',
    );
    for (const d of authDiagnostics) {
      lines.push(
        `### ${d.provider}`,
        '',
        `**Wiring files:** ${d.wiringFiles.length ? d.wiringFiles.map((f) => `\`${f}\``).join(', ') : '(none found via path-presence)'}`,
        `**Has middleware:** ${d.hasMiddleware ? 'yes' : 'no'}`,
        '',
      );
    }
    lines.push(
      `**Suggested session owner:** ${owner}`,
      '',
      '**Suggested `composeAuth` config:**',
      '',
      '```ts',
      `import { composeAuth } from '@contractqa/adapters';`,
      `// Each adapter declares its own responsibilities. The adapter you give`,
      `// responsibilities: ['session'] (currently suggested: ${owner}) becomes the session owner.`,
      `const auth = composeAuth([`,
      ...authDiagnostics.map((d) => `  /* ${d.provider}Adapter — responsibilities: [${d.provider === owner ? "'session', " : ""}'user-store'] */`),
      `]);`,
      '```',
      '',
    );
  }

  return {
    framework: detected.framework,
    confidence: detected.confidence,
    authSignals: detected.authSignals,
    routes,
    evidence: detected.evidence,
    markdown: lines.join('\n'),
    scanRoot,
    candidates,
    authDiagnostics,
  };
}
