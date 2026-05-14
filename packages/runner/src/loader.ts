import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { ContractSchema, type ContractDoc } from '@contractqa/core';

export async function loadContractsFromDir(dir: string): Promise<ContractDoc[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: ContractDoc[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.yml')) continue;
    const raw = await readFile(path.join(dir, e.name), 'utf8');
    const parsed = parse(raw);
    out.push(ContractSchema.parse(parsed));
  }
  return out;
}
