import { describe, it, expect, vi, afterEach } from 'vitest';
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

  describe('lenient mode', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns valid contracts when one yaml is schema-invalid (skip-and-warn)', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-lenient-'));
      await writeFile(path.join(dir, 'good.yml'), contractYaml('INV-OK-1'));
      await writeFile(path.join(dir, 'bad.yml'), `id: NO-PREFIX\nseverity: P9`);
      await writeFile(path.join(dir, 'good2.yml'), contractYaml('INV-OK-2'));

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const contracts = await loadContractsFromDir(dir, { lenient: true });

      const ids = contracts.map((c) => c.id).sort();
      expect(ids).toEqual(['INV-OK-1', 'INV-OK-2']);
      const warnCalls = warn.mock.calls.map((args) => String(args[0]));
      expect(warnCalls.some((m) => m.includes('bad.yml'))).toBe(true);
    });

    it('emits a "loaded N, skipped M" summary after the walk', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-summary-'));
      await writeFile(path.join(dir, 'good.yml'), contractYaml('INV-S1'));
      await writeFile(path.join(dir, 'bad1.yml'), `id: NO-PREFIX\nseverity: P9`);
      await writeFile(path.join(dir, 'bad2.yml'), `not even: valid: yaml: :::`);

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await loadContractsFromDir(dir, { lenient: true });

      const warnCalls = warn.mock.calls.map((args) => String(args[0]));
      expect(warnCalls.some((m) => /loaded\s+1.*skipped\s+2/i.test(m))).toBe(true);
    });

    it('does not warn when all contracts are valid (no summary noise)', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-quiet-'));
      await writeFile(path.join(dir, 'good.yml'), contractYaml('INV-Q1'));

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const contracts = await loadContractsFromDir(dir, { lenient: true });

      expect(contracts).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('still throws when lenient is omitted/false (default behavior unchanged)', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-strict-'));
      await writeFile(path.join(dir, 'good.yml'), contractYaml('INV-OK-S'));
      await writeFile(path.join(dir, 'bad.yml'), `id: NO-PREFIX\nseverity: P9`);
      await expect(loadContractsFromDir(dir)).rejects.toThrow();
      await expect(loadContractsFromDir(dir, { lenient: false })).rejects.toThrow();
    });
  });
});
