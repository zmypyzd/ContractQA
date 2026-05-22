import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadContractsFromDir } from '../src/loader.js';

function contractYaml(id: string): string {
  return `id: ${id}
title: t
area: core
severity: P0
actions:
  - { type: goto, path: / }
expected:
  url: { matches: "^/" }
`;
}

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

  it('recursively walks subdirectories (autopilot writes contracts into qa/contracts/<area>/)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-nested-'));
    await mkdir(path.join(dir, 'core'));
    await mkdir(path.join(dir, 'auth'));
    await mkdir(path.join(dir, 'core', 'deep'));
    await writeFile(path.join(dir, 'top.yml'), contractYaml('INV-TOP'));
    await writeFile(path.join(dir, 'core', 'one.yml'), contractYaml('INV-CORE-1'));
    await writeFile(path.join(dir, 'auth', 'two.yml'), contractYaml('INV-AUTH-1'));
    await writeFile(path.join(dir, 'core', 'deep', 'three.yml'), contractYaml('INV-CORE-DEEP-1'));

    const contracts = await loadContractsFromDir(dir);
    const ids = contracts.map((c) => c.id).sort();
    expect(ids).toEqual(['INV-AUTH-1', 'INV-CORE-1', 'INV-CORE-DEEP-1', 'INV-TOP']);
  });

  it('throws when YAML violates schema', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-'));
    await writeFile(path.join(dir, 'bad.yml'), `id: NO-PREFIX\nseverity: P9`);
    await expect(loadContractsFromDir(dir)).rejects.toThrow();
  });
});
