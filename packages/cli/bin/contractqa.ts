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
import { runAutopilot, type AutopilotProgressEvent } from '../src/commands/autopilot.js';
import { runDashboard, DASHBOARD_DEFAULTS } from '../src/commands/dashboard.js';
import { AutoPrPreflightError } from '../src/commands/autopilot-watch.js';
import { formatProgressEvent } from '../src/autopilot/format-progress.js';
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
  .command('init [path]')
  .description('Scaffold qa/ directory for the current project (auto-detects framework)')
  .option('-y, --yes', 'skip confirmation prompts')
  .option('-f, --force', 'overwrite existing files')
  .option('--framework <name>', 'force a specific framework (next-app, next-pages, vite-react, vite-vue, astro, unknown)')
  .option('--target <subdir>', 'monorepo subdir to scaffold into (e.g. apps/web)')
  .action(async (cwdArg: string | undefined, opts: { yes?: boolean; force?: boolean; framework?: string; target?: string }) => {
    const report = await initProject({
      cwd: cwdArg ?? process.cwd(),
      yes: opts.yes,
      force: opts.force,
      framework: opts.framework as never,
      target: opts.target,
    });
    console.log(`Detected: ${report.detected.framework} (confidence ${report.detected.confidence.toFixed(2)})`);
    console.log(`Auth signals: ${report.detected.authSignals.join(', ') || '(none)'}`);
    console.log(`Wrote ${report.filesWritten.length} files:`);
    for (const f of report.filesWritten) console.log(`  ${f}`);
  });

program
  .command('scan [path]')
  .description('Scan project and write qa/SCAN_REPORT.md with detected framework + suggested contracts')
  .option('-o, --out <path>', 'output path', 'qa/SCAN_REPORT.md')
  .option('--target <subdir>', 'monorepo subdir to scan into (e.g. apps/web)')
  .option('--detect-auth', 'inspect auth wiring; outputs a Hybrid auth section when ≥2 providers')
  .action(async (cwdArg: string | undefined, opts: { out: string; target?: string; detectAuth?: boolean }) => {
    const r = await scanProject({ cwd: cwdArg ?? process.cwd(), target: opts.target, detectAuth: !!opts.detectAuth });
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

program
  .command('autopilot')
  .description('Zero-YAML onboarding: generate, run, and auto-fix contracts for a project')
  .option('--time-budget <ms>', 'Time budget in milliseconds', String(30 * 60 * 1000))
  .option('--no-fix', 'Report-only mode; skip Phase C auto-fix')
  .option('--yes', 'Accept LLM defaults for uncertain proposals; no interactive prompts')
  .option('--regenerate', 'Force re-run of LLM discovery, ignoring existing qa/contracts/')
  .option('--regression-scope <scope>', 'one|touched-files|all (default touched-files)', 'touched-files')
  .option('--auto-pr', 'Night-shift mode: route Phase C through git worktree + gh pr create')
  .option('--watch', 'Watch the project directory and re-run autopilot on every file change')
  .option('--watch-debounce <ms>', 'Debounce window for --watch (default 2000ms)', '2000')
  .option('--dashboard-url <url>', 'Report each --watch iteration to a running ContractQA dashboard (or set DASHBOARD_URL env)')
  .option('--discovery-mode <mode>', 'Phase B discovery: deep (default, 1 contract per interaction) or modules', 'deep')
  .option('--deep-concurrency <n>', 'Concurrent LLM calls in deep Stage 2 (default 4)', '4')
  .option('--deep-max-contracts <n>', 'Hard cap on contracts generated per deep run (default 500)', '500')
  .action(async (opts: {
    timeBudget: string;
    fix: boolean;
    yes?: boolean;
    regenerate?: boolean;
    regressionScope?: string;
    watch?: boolean;
    watchDebounce?: string;
    dashboardUrl?: string;
    autoPr?: boolean;
    discoveryMode?: string;
    deepConcurrency?: string;
    deepMaxContracts?: string;
  }) => {
    const baseOpts = {
      cwd: process.cwd(),
      timeBudgetMs: Number(opts.timeBudget),
      fix: opts.fix,
      yes: opts.yes,
      regenerate: opts.regenerate,
      regressionScope: opts.regressionScope as ('one' | 'touched-files' | 'all' | undefined),
      // Default flipped to 'deep' 2026-05-28 per WebTestBench experience —
      // modules mode misses interaction-level invariants the agent can find
      // by walking source. Pass --discovery-mode modules to opt out.
      discoveryMode: (opts.discoveryMode === 'modules' ? 'modules' : 'deep') as 'modules' | 'deep',
      deepConcurrency: Number(opts.deepConcurrency ?? '4'),
      deepMaxContracts: Number(opts.deepMaxContracts ?? '500'),
      // Wire phase/log events to the terminal. Without this, non-watch
      // autopilot runs are silent until completion — masking deep-discovery
      // diagnostics (`[deep] ...` lines), the non-git-cwd warn, etc.
      // info/phase → stdout, warn/error → stderr so pipes can separate them.
      onProgress: (event: AutopilotProgressEvent): void => {
        const line = formatProgressEvent(event);
        if (event.type === 'log' && (event.level === 'warn' || event.level === 'error')) {
          process.stderr.write(line + '\n');
        } else {
          process.stdout.write(line + '\n');
        }
      },
    };

    if (opts.discoveryMode && opts.discoveryMode !== 'modules' && opts.discoveryMode !== 'deep') {
      console.error(`Invalid --discovery-mode: ${opts.discoveryMode}. Must be 'modules' or 'deep'.`);
      process.exit(2);
    }

    if (opts.autoPr && !opts.watch) {
      console.error('--auto-pr requires --watch (use: contractqa autopilot --watch --auto-pr)');
      process.exit(2);
    }

    if (!opts.watch) {
      const report = await runAutopilot(baseOpts);
      // I4: exit code includes Phase B failures and Phase C give-ups.
      const failTotal = report.phaseA.failed + (report.phaseB?.failed ?? 0) + (report.phaseC?.givenUp ?? 0);
      process.exit(failTotal === 0 ? 0 : 1);
    }

    // --watch mode: run once, then re-run on debounced filesystem change events.
    const { watchAndRerun } = await import('../src/commands/autopilot-watch.js');
    try {
      await watchAndRerun(baseOpts, {
        debounceMs: Number(opts.watchDebounce ?? '2000'),
        onLog: (line) => console.log(line),
        dashboardUrl: opts.dashboardUrl,
        autoPr: opts.autoPr,
        regressionScope: baseOpts.regressionScope,
      });
    } catch (err) {
      if (err instanceof AutoPrPreflightError) {
        console.error(`✖ ${err.reason}`);
        process.exit(3);
      }
      throw err;
    }
  });

program
  .command('dashboard')
  .description('Launch the local dashboard: docker compose up + Postgres migrations + next dev')
  .option('--port <p>', 'port for next dev', String(DASHBOARD_DEFAULTS.port))
  .option('--no-docker', 'skip docker compose (bring your own Postgres)')
  .option('--no-migrate', 'skip applying drizzle migrations')
  .option('--db-url <url>', 'Postgres connection string', DASHBOARD_DEFAULTS.dbUrl)
  .option('--wait <ms>', 'how long to wait for Postgres to accept connections', String(DASHBOARD_DEFAULTS.waitForPostgresMs))
  .action(async (opts: { port: string; docker: boolean; migrate: boolean; dbUrl: string; wait: string }) => {
    const code = await runDashboard({
      cwd: process.cwd(),
      port: Number(opts.port),
      startDocker: opts.docker,
      applyMigrations: opts.migrate,
      dbUrl: opts.dbUrl,
      waitForPostgresMs: Number(opts.wait),
    });
    process.exit(code);
  });

program.parseAsync().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
