import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { ContractSchema, type ContractDoc } from '@contractqa/core';

export interface LoadContractsOptions {
  // When true, files that fail YAML parsing or ContractSchema validation
  // are logged via console.warn and skipped instead of throwing.
  // Designed for autopilot output, where a known fraction of LLM-generated
  // contracts use `expected.*` shapes the schema doesn't model yet.
  lenient?: boolean;
}

// Autopilot writes contracts into nested module dirs
// (qa/contracts/{auth,core,_smoke,...}/*.yml), so the loader recurses.
// Subdirectories are walked depth-first; non-`.yml` files are skipped.
export async function loadContractsFromDir(
  dir: string,
  options: LoadContractsOptions = {},
): Promise<ContractDoc[]> {
  const out: ContractDoc[] = [];
  const skipped: string[] = [];
  await walk(dir, out, skipped, options.lenient === true);
  if (options.lenient === true && skipped.length > 0) {
    console.warn(
      `[contractqa] loader: loaded ${out.length}, skipped ${skipped.length} schema-invalid file(s)`,
    );
  }
  return out;
}

async function walk(
  dir: string,
  out: ContractDoc[],
  skipped: string[],
  lenient: boolean,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out, skipped, lenient);
      continue;
    }
    if (!e.isFile() || !e.name.endsWith('.yml')) continue;
    const raw = await readFile(full, 'utf8');
    if (lenient) {
      try {
        const parsed = parse(raw);
        out.push(ContractSchema.parse(parsed));
      } catch (err) {
        skipped.push(full);
        console.warn(`[contractqa] loader: skipping ${full}: ${summarizeError(err)}`);
      }
    } else {
      const parsed = parse(raw);
      out.push(ContractSchema.parse(parsed));
    }
  }
}

interface ZodIssueLike {
  path: ReadonlyArray<string | number>;
  message: string;
}
interface ZodErrorLike {
  issues: ReadonlyArray<ZodIssueLike>;
}
function isZodErrorLike(err: unknown): err is ZodErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}
function summarizeError(err: unknown): string {
  if (isZodErrorLike(err)) {
    const n = err.issues.length;
    const first = err.issues[0];
    if (!first) return 'schema validation failed';
    const at = first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
    return `schema validation failed (${n} issue${n === 1 ? '' : 's'}; first: "${first.message}"${at})`;
  }
  if (err instanceof Error) return err.message.split('\n')[0]!;
  return String(err);
}
