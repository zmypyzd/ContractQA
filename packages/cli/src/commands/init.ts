import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, detectFrameworkInRepo, type DetectResult, type Framework } from '../init/detect-framework.js';
import { renderTemplate } from '../init/templates/index.js';

export interface InitOptions {
  cwd: string;
  yes?: boolean;
  force?: boolean;
  framework?: Framework;
  target?: string; // new — relative subdir for monorepo
}

export interface InitReport {
  detected: DetectResult;
  framework: Framework;
  filesWritten: string[];
  scaffoldRoot: string; // new — absolute path where qa/ was written
}

// Kept for backwards compatibility — no longer called by initProject but kept as dead code per C2 constraints.
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

// Kept for backwards compatibility — no longer called by initProject but kept as dead code per C2 constraints.
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
  let scaffoldRoot = opts.cwd;
  let detected: DetectResult;
  let framework: Framework;

  if (opts.framework) {
    // Explicit override — run detection for reporting, but use the override framework.
    // We still detect at cwd for backwards compatibility with existing tests.
    const repo = await detectFrameworkInRepo(opts.cwd);
    const topCandidate = repo.candidates[0];
    if (topCandidate) {
      detected = {
        framework: topCandidate.framework,
        confidence: topCandidate.confidence,
        evidence: topCandidate.evidence,
        authSignals: topCandidate.authSignals,
      };
      // scaffoldRoot stays as opts.cwd for framework override path (backwards compat)
    } else {
      detected = { framework: 'unknown', confidence: 0, evidence: [], authSignals: [] };
    }
    framework = opts.framework;
  } else {
    const repo = await detectFrameworkInRepo(opts.cwd);

    if (opts.target) {
      // Explicit target: find the matching candidate or error
      const c = repo.candidates.find((candidate) => candidate.subdir === opts.target);
      if (!c) throw new Error(`no framework detected at --target ${opts.target}`);
      scaffoldRoot = c.subdir === '.' ? opts.cwd : path.join(opts.cwd, c.subdir);
      framework = c.framework;
      detected = { framework: c.framework, confidence: c.confidence, evidence: c.evidence, authSignals: c.authSignals };
    } else if (repo.candidates.length === 0) {
      throw new Error('no framework detected — pass --framework explicitly');
    } else if (repo.candidates.length > 1 && repo.candidates[0]!.confidence === repo.candidates[1]!.confidence) {
      const subdirs = repo.candidates.map((c) => c.subdir).join(', ');
      throw new Error(`AmbiguousTarget: multiple candidates (${subdirs}) — pass --target <subdir>`);
    } else {
      // Auto-select the top candidate (highest confidence; ties resolved: non-root before root by detectFrameworkInRepo sort)
      const c = repo.candidates[0]!;
      scaffoldRoot = c.subdir === '.' ? opts.cwd : path.join(opts.cwd, c.subdir);
      framework = c.framework;
      detected = { framework: c.framework, confidence: c.confidence, evidence: c.evidence, authSignals: c.authSignals };
    }
  }

  const projectName = path.basename(scaffoldRoot);
  const template = renderTemplate({ framework, authSignals: detected.authSignals, projectName });

  if (!opts.force) {
    for (const rel of Object.keys(template.files)) {
      if (await pathExists(path.join(scaffoldRoot, rel))) {
        throw new Error(`${rel} already exists. Re-run with --force to overwrite.`);
      }
    }
  }

  const written: string[] = [];
  for (const [rel, content] of Object.entries(template.files)) {
    const abs = path.join(scaffoldRoot, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
    written.push(rel);
  }

  return { detected, framework, filesWritten: written, scaffoldRoot };
}
