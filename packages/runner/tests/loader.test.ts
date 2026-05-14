import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadContractsFromDir } from '../src/loader.js';

describe('loadContractsFromDir', () => {
  it('parses all *.yml files into ContractDoc array', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-'));
    await writeFile(
      path.join(dir, 'auth.yml'),
      `id: INV-A2
title: logout
area: auth
severity: P0
actions:
  - { type: goto, path: /lobby }
expected:
  url: { matches: "^/login" }
`,
    );
    const contracts = await loadContractsFromDir(dir);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]!.id).toBe('INV-A2');
  });

  it('throws when YAML violates schema', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-'));
    await writeFile(path.join(dir, 'bad.yml'), `id: NO-PREFIX\nseverity: P9`);
    await expect(loadContractsFromDir(dir)).rejects.toThrow();
  });
});
