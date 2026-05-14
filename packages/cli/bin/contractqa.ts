#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { loadContractsFromDir } from '@contractqa/runner';
import { renderInvariantsMd } from '../src/commands/invariants-gen.js';
import { runContracts } from '../src/commands/run.js';
import { initProject } from '../src/commands/init.js';
import type { AuthProviderName } from '@contractqa/core';

const program = new Command('contractqa');

program
  .command('invariants:gen')
  .option('--contracts <dir>', 'YAML contracts dir', 'qa/contracts')
  .option('--out <path>', 'Output path', 'qa/INVARIANTS.md')
  .action(async (opts: { contracts: string; out: string }) => {
    const contracts = await loadContractsFromDir(opts.contracts);
    await writeFile(opts.out, renderInvariantsMd(contracts));
    console.log(`Wrote ${opts.out} from ${contracts.length} contracts`);
  });

program
  .command('init')
  .option('--provider <name>', 'Auth provider', 'supabase')
  .action(async (opts: { provider: AuthProviderName }) => {
    await initProject({ cwd: process.cwd(), provider: opts.provider });
    console.log(`Initialized qa/ scaffold for provider=${opts.provider}`);
  });

program
  .command('run')
  .option('--changed', 'Only contracts impacted by git diff', false)
  .option('--contracts <dir>', 'YAML contracts dir', 'qa/contracts')
  .option('--artifacts <dir>', 'Artifacts root', 'artifacts')
  .action(async (opts: { changed: boolean; contracts: string; artifacts: string }) => {
    const changed = opts.changed
      ? execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' })
          .split('\n')
          .filter(Boolean)
      : [];
    const r = await runContracts({
      contractsDir: opts.contracts,
      artifactsRoot: opts.artifacts,
      changedFiles: changed,
    });
    process.exit(r.exitCode);
  });

program.parseAsync().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
