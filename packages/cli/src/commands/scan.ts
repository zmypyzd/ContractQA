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
    if (e.isDirectory()) out.push(...(await walk(root, rel)));
    else out.push(rel);
  }
  return out;
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

export async function scanProject(opts: { cwd: string }): Promise<ScanReport> {
  const pkg = await readFile(path.join(opts.cwd, 'package.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> })
    .catch(() => ({} as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }));
  const files = await walk(opts.cwd);
  const detected = await detectFramework({ packageJson: pkg, files });
  const routes = deriveRoutes(detected.framework, files);

  const lines: string[] = [
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
  ];

  return {
    framework: detected.framework,
    confidence: detected.confidence,
    authSignals: detected.authSignals,
    routes,
    evidence: detected.evidence,
    markdown: lines.join('\n'),
  };
}
