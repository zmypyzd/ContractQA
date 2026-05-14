#!/usr/bin/env node
import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadContractsFromDir } from '@contractqa/runner';
import { renderInvariantsMd } from '../src/commands/invariants-gen.js';
import { runContracts } from '../src/commands/run.js';
import { initProject } from '../src/commands/init.js';
import { scanProject } from '../src/commands/scan.js';
import { doctor, renderDoctorReport, type FixName } from '../src/commands/doctor.js';
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
  .description('Scaffold qa/ directory for the current project (auto-detects framework)')
  .option('-y, --yes', 'skip confirmation prompts')
  .option('-f, --force', 'overwrite existing files')
  .option('--framework <name>', 'force a specific framework (next-app, next-pages, vite-react, vite-vue, astro, unknown)')
  .action(async (opts: { yes?: boolean; force?: boolean; framework?: string }) => {
    const report = await initProject({
      cwd: process.cwd(),
      yes: opts.yes,
      force: opts.force,
      framework: opts.framework as never,
    });
    console.log(`Detected: ${report.detected.framework} (confidence ${report.detected.confidence.toFixed(2)})`);
    console.log(`Auth signals: ${report.detected.authSignals.join(', ') || '(none)'}`);
    console.log(`Wrote ${report.filesWritten.length} files:`);
    for (const f of report.filesWritten) console.log(`  ${f}`);
  });

program
  .command('scan')
  .description('Scan project and write qa/SCAN_REPORT.md with detected framework + suggested contracts')
  .option('-o, --out <path>', 'output path', 'qa/SCAN_REPORT.md')
  .action(async (opts: { out: string }) => {
    const r = await scanProject({ cwd: process.cwd() });
    await mkdir(path.dirname(opts.out), { recursive: true });
    await writeFile(opts.out, r.markdown);
    console.log(`Wrote ${opts.out}`);
    console.log(`Framework: ${r.framework}, routes: ${r.routes.length}, auth signals: ${r.authSignals.length}`);
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

program
  .command('doctor <target>')
  .description('preflight: env vars, ports, native deps, boot probe for a host project')
  .option('--port <p...>', 'port(s) to allocate', [])
  .option('--no-boot', 'skip boot probe (default: skip — wire bootCommand programmatically)')
  .option('--fix [names]', 'comma-separated: native-deps,env-stub,port-collision (or "all")', '')
  .action(async (target: string, opts: { port: string[]; boot: boolean; fix?: string }) => {
    const requestedPorts = (opts.port ?? []).map((p) => Number(p)).filter((n) => Number.isFinite(n));
    const ALL_FIX_NAMES: FixName[] = ['native-deps', 'env-stub', 'port-collision'];
    const fixList: FixName[] | undefined = !opts.fix
      ? undefined
      : opts.fix === 'all'
        ? ALL_FIX_NAMES
        : (opts.fix.split(',').filter((s): s is FixName =>
            s === 'native-deps' || s === 'env-stub' || s === 'port-collision'
          ));
    const report = await doctor({
      targetRoot: target,
      requestedPorts,
      skipBootProbe: !opts.boot,
      fix: fixList,
    });
    console.log(renderDoctorReport(report));
    process.exit(report.summary === 'READY' ? 0 : 1);
  });

program.parseAsync().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
