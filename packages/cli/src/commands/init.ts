import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, type DetectResult, type Framework } from '../init/detect-framework.js';
import { renderTemplate } from '../init/templates/index.js';

export interface InitOptions {
  cwd: string;
  yes?: boolean;
  force?: boolean;
  framework?: Framework;
}

export interface InitReport {
  detected: DetectResult;
  framework: Framework;
  filesWritten: string[];
}

async function scanFiles(dir: string, depth = 2, prefix = ''): Promise<string[]> {
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

async function readPackageJson(cwd: string): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}> {
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
  const framework: Framework = opts.framework ?? detected.framework;

  const projectName = path.basename(opts.cwd);
  const template = renderTemplate({
    framework,
    authSignals: detected.authSignals,
    projectName,
  });

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
