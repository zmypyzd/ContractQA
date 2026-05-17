import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type VerifyScope = 'one' | 'touched-files' | 'all';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) out.push(p);
  }
  return out;
}

/**
 * Walk all .yml/.yaml files under `contractsDir` and return paths of those
 * whose text content mentions any of the given file paths.
 *
 * Used by verifyScope: 'touched-files' to scope regression checks to the
 * contracts that are likely affected by a fix patch.
 */
export function findContractsTouchingFiles(contractsDir: string, files: readonly string[]): string[] {
  const yamls = walk(contractsDir);
  const matches: string[] = [];
  for (const yaml of yamls) {
    const content = readFileSync(yaml, 'utf8');
    if (files.some((f) => content.includes(f))) matches.push(yaml);
  }
  return matches;
}

/**
 * Walk all .yml/.yaml files under `contractsDir`.
 * Used by verifyScope: 'all'.
 */
export function walkAllContracts(contractsDir: string): string[] {
  return walk(contractsDir);
}

/**
 * Given a unified diff (output of `git diff`), extract the set of touched
 * file paths by parsing `+++ b/<path>` and `--- a/<path>` lines.
 *
 * Handles both plain paths and git's quoted paths (core.quotePath=true, the
 * default), which wrap paths containing spaces or non-ASCII in double-quotes:
 *   +++ "b/src/My Component.tsx"
 */
export function extractTouchedFiles(diff: string): string[] {
  const out = new Set<string>();
  for (const line of diff.split('\n')) {
    // Handle: +++ b/path, +++ "b/path with space", --- a/path, --- "a/path"
    const match = /^[+\-]{3} (?:"([ab])\/(.+?)"|([ab])\/(.+))$/.exec(line);
    if (match) {
      const path = match[2] ?? match[4];
      if (path && path !== '/dev/null') out.add(path);
    }
  }
  return Array.from(out);
}
