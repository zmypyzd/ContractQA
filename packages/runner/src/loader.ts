import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { ContractSchema, type ContractDoc } from '@contractqa/core';

// Autopilot writes contracts into nested module dirs
// (qa/contracts/{auth,core,_smoke,...}/*.yml), so the loader recurses.
// Subdirectories are walked depth-first; non-`.yml` files are skipped.
export async function loadContractsFromDir(dir: string): Promise<ContractDoc[]> {
  const out: ContractDoc[] = [];
  await walk(dir, out);
  return out;
}

async function walk(dir: string, out: ContractDoc[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (!e.isFile() || !e.name.endsWith('.yml')) continue;
    const raw = await readFile(full, 'utf8');
    const parsed = parse(raw);
    out.push(ContractSchema.parse(parsed));
  }
}
