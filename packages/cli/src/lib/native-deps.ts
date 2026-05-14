import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface NativeMismatch {
  binding: string;
  packagePath: string;
  builtAbi: string | null;
  runtimeAbi: string;
  suggestion: string;
}

interface DetectOpts {
  _stubFiles?: Array<{ path: string; abi: string }>;
  _runtimeAbi?: string;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (e.isFile() && e.name.endsWith('.node')) out.push(full);
    }
  } catch {
    // unreadable dir, skip
  }
  return out;
}

export async function detectNativeDepMismatch(
  repoRoot: string,
  opts: DetectOpts = {},
): Promise<NativeMismatch[]> {
  const runtimeAbi = opts._runtimeAbi ?? process.versions.modules;

  if (opts._stubFiles) {
    return opts._stubFiles
      .filter((s) => s.abi !== runtimeAbi)
      .map((s) => ({
        binding: path.basename(s.path),
        packagePath: path.dirname(s.path),
        builtAbi: s.abi,
        runtimeAbi,
        suggestion: `built for ABI ${s.abi}, current is ${runtimeAbi}. run: npm --prefix ${path.dirname(s.path)} rebuild`,
      }));
  }

  const nodeModules = path.join(repoRoot, 'node_modules');
  try {
    await stat(nodeModules);
  } catch {
    return [];
  }
  const bindings = await walk(nodeModules);
  // We can't reliably read NODE_MODULE_VERSION from a .node file without
  // parsing Mach-O/ELF. Phase 2 surfaces every .node binary as a candidate
  // and lets the operator decide. False-positive-leaning, acceptable.
  return bindings.map((b) => ({
    binding: path.basename(b),
    packagePath: path.dirname(b),
    builtAbi: null,
    runtimeAbi,
    suggestion: `native binding present. if dev-server boot fails with "bindings not found", run: npm --prefix ${path.dirname(b)} rebuild`,
  }));
}
