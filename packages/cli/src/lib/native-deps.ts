import { open, readdir, stat } from 'node:fs/promises';
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
      .map((s) => {
        const pkgDir = derivePnpmPkgDir(s.path);
        return {
          binding: path.basename(s.path),
          packagePath: path.dirname(s.path),
          builtAbi: s.abi,
          runtimeAbi,
          suggestion: `built for ABI ${s.abi}, current is ${runtimeAbi}. run: cd ${pkgDir} && npm run install`,
        };
      });
  }

  const nodeModules = path.join(repoRoot, 'node_modules');
  try { await stat(nodeModules); } catch { return []; }
  const bindings = await walk(nodeModules);
  const out: NativeMismatch[] = [];
  for (const b of bindings) {
    const builtAbi = await sniffAbiFromBinary(b);
    if (builtAbi !== null && builtAbi === runtimeAbi) continue;
    out.push({
      binding: path.basename(b),
      packagePath: path.dirname(b),
      builtAbi,
      runtimeAbi,
      suggestion: builtAbi
        ? `built for ABI ${builtAbi}, current is ${runtimeAbi}. run: cd ${derivePnpmPkgDir(b)} && npm run install`
        : `native binding present (ABI unknown). if dev-server boot fails, run: cd ${derivePnpmPkgDir(b)} && npm run install`,
    });
  }
  return out;
}

// node-gyp embeds "NODE_MODULE_VERSION" as a symbol in the binary's data section.
// Grepping for it and the numeric literal that follows is best-effort but
// avoids a full Mach-O/ELF parser dependency. Returns null when not found.
// Only the first 64 KB is read so multi-MB binaries are never fully loaded.
async function sniffAbiFromBinary(file: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, 'r');
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buf, 0, 65536, 0);
    const slice = buf.slice(0, bytesRead);
    const idx = slice.indexOf('NODE_MODULE_VERSION');
    if (idx < 0) return null;
    // The version literal appears within ~256 bytes after the symbol;
    // grep for the first 3-digit ABI number (current ABIs are 108–127).
    const region = slice.slice(idx, idx + 256).toString('binary');
    const m = region.match(/\b(1\d{2})\b/);
    return m ? m[1]! : null;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

// Given /…/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/build/Release/foo.node,
// return /…/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>.
// pnpm rebuild is silently a no-op for transitive workspace deps; only
// `npm run install` from inside the .pnpm package dir triggers prebuild-install.
function derivePnpmPkgDir(nodePath: string): string {
  const m = nodePath.match(/^(.*\/node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (m) return m[1]!;
  // Fallback: walk up two dirs from build/Release/foo.node → build/ → <pkg>
  return path.dirname(path.dirname(path.dirname(nodePath)));
}
