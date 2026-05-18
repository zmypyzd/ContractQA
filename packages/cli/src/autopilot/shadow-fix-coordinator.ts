// packages/cli/src/autopilot/shadow-fix-coordinator.ts
//
// Bridges autopilot's Phase C queue to packages/orchestrator's runShadowFix.
// One instance per `autopilot --watch --auto-pr` session. Owns base branch
// (captured at session start), worktreeRoot, llmClient, and the maps that
// tie issueId → bundlePath → failingContractPath.
import path from 'node:path';
import { runShadowFix, runClaudeFix, createFixWorktree } from '@contractqa/orchestrator';
import type { ClaudeFixResult } from '@contractqa/orchestrator';
import type { LLMClient } from '@contractqa/orchestrator/llm';
import { openFixPR, findExistingPr, type ExecFn } from './gh-pr.js';
import { buildPrTitle, buildPrBody } from './pr-body.js';

export type CoordinatorOutcome =
  | 'SUCCESS'
  | 'EXHAUSTED'
  | 'REGRESSION'
  | 'CONTRACT_REVISION_NEEDED'
  | 'PARSE_ERROR'
  | 'SKIPPED_PR_EXISTS';

export interface CoordinatorFixOutcome {
  issueId: string;
  issueJsonPath: string;
  branchSafeId: string;
  outcome: CoordinatorOutcome;
  prUrl?: string;
  branch?: string;
  regressionContract?: string;
  skippedBrowserContracts: number;
}

/** Sanitize an autopilot failure.id for use as a git branch / dir name. */
export function sanitizeIssueId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._/-]/g, '-');
}

export interface ShadowFixCoordinatorDeps {
  /** Per-issue path to write the autopilot-flavoured prompt. */
  writePromptFile: (bundlePath: string, dest: string) => Promise<string>;
  /** Run a single contract by YAML path. Returns 'pass'|'fail'|'skipped' (skipped = browser, see spec §5.1). */
  runContract: (contractPath: string) => Promise<{
    contractPath: string;
    status: 'pass' | 'fail' | 'skipped';
  }>;
  /** Injected for tests; defaults to runShadowFix from orchestrator. */
  runShadowFixImpl?: typeof runShadowFix;
  /** Injected for tests; defaults to createFixWorktree from orchestrator. */
  createWorktreeImpl?: typeof createFixWorktree;
  /** Injected for tests; defaults to defaultExec from gh-pr. */
  exec?: ExecFn;
}

export interface ShadowFixCoordinatorOptions {
  worktreeRoot: string;
  repoRoot: string;
  baseBranch: string;
  contractsDir: string;
  llmClient: LLMClient;
  regressionScope: 'one' | 'touched-files' | 'all';
  ghBin?: string;
  gitBin?: string;
  dashboardUrl?: string;
  dashboardRunId?: string;
}

export interface FixRequest {
  /** Autopilot's failure.id (un-sanitized). */
  issueId: string;
  /** Absolute path to the per-issue issue.json. */
  issueJsonPath: string;
  /** Absolute path to the contract YAML that failed. */
  failingContractPath: string;
  /** Directory containing issue.json (passed to shadow-pipeline as bundlePath). */
  bundlePath: string;
}

export class ShadowFixCoordinator {
  /** Set inside the openFixPR callback so mapResult can detect push/gh failures. */
  private lastOpenFixResult: { status: string; prUrl?: string; errorDetail?: string } | null = null;

  constructor(
    private readonly opts: ShadowFixCoordinatorOptions,
    private readonly deps: ShadowFixCoordinatorDeps,
  ) {}

  async fix(req: FixRequest): Promise<CoordinatorFixOutcome> {
    const branchSafeId = sanitizeIssueId(req.issueId);
    const branch = `contractqa-fix/${branchSafeId}`;
    const worktreePath = path.join(this.opts.worktreeRoot, branchSafeId);

    // §5.2 idempotency probe #1: open PR already exists?
    const existing = await findExistingPr({
      branch,
      cwd: this.opts.repoRoot,
      exec: this.deps.exec,
      ghBin: this.opts.ghBin,
    });
    if (existing.url) {
      return {
        issueId: req.issueId,
        issueJsonPath: req.issueJsonPath,
        branchSafeId,
        outcome: 'SKIPPED_PR_EXISTS',
        prUrl: existing.url,
        branch,
        skippedBrowserContracts: 0,
      };
    }

    const runShadowFixImpl = this.deps.runShadowFixImpl ?? runShadowFix;
    const createWorktreeImpl = this.deps.createWorktreeImpl ?? createFixWorktree;

    // Track Claude's last result so openFixPR can build PR title/body from root_cause.
    let lastClaudeResult: ClaudeFixResult | null = null;
    let skippedBrowserContracts = 0;
    let httpPassedCount = 0;

    // Wrap runContract to surface skipped browser contracts in the per-issue summary,
    // and translate 'skipped' → 'pass' so shadow-pipeline doesn't trigger REGRESSION.
    const wrappedRunContract = async (contractPath: string) => {
      const r = await this.deps.runContract(contractPath);
      if (r.status === 'skipped') {
        skippedBrowserContracts++;
        return { contractPath: r.contractPath, status: 'pass' as const };
      }
      if (r.status === 'pass') httpPassedCount++;
      return { contractPath: r.contractPath, status: r.status };
    };

    const result = await runShadowFixImpl({
      issueId: branchSafeId,
      bundlePath: req.bundlePath,
      baseBranch: this.opts.baseBranch,
      repoRoot: this.opts.repoRoot,
      worktreeRoot: this.opts.worktreeRoot,
      maxAttempts: 3,
      createWorktree: createWorktreeImpl,
      writePromptFile: this.deps.writePromptFile,
      runClaude: async (input) => {
        const r = await runClaudeFix({
          promptPath: input.promptPath,
          cwd: input.cwd,
          allowedTools: input.allowedTools,
          llmClient: this.opts.llmClient,
        });
        lastClaudeResult = r;
        return r;
      },
      openFixPR: async ({ branch: br, baseBranch, filesChanged }) => {
        const rootCause = lastClaudeResult?.root_cause;
        const prTitle = buildPrTitle({ issueId: req.issueId, rootCause });
        const prBody = buildPrBody({
          issueId: req.issueId,
          rootCause,
          filesChanged,
          testsRun: lastClaudeResult?.tests_run,
          regressionSummary: {
            httpPassed: httpPassedCount,
            skippedBrowserContracts,
          },
          dashboardUrl: this.opts.dashboardUrl,
          runId: this.opts.dashboardRunId,
        });
        const r = await openFixPR({
          worktreePath,
          branch: br,
          baseBranch,
          filesChanged,
          prTitle,
          prBody,
          exec: this.deps.exec,
          ghBin: this.opts.ghBin,
          gitBin: this.opts.gitBin,
        });
        // shadow-pipeline expects {url}. On non-success, surface the error
        // by throwing — shadow-pipeline currently has no failure path for
        // openFixPR, so we coerce status into a URL or an empty string and
        // record the real status via lastOpenFixResult.
        this.lastOpenFixResult = r;
        return { url: r.prUrl ?? '' };
      },
      verifyScope: this.opts.regressionScope,
      contractsDir: this.opts.contractsDir,
      failingContractPath: req.failingContractPath,
      runContract: wrappedRunContract,
    });

    return this.mapResult({
      req,
      branchSafeId,
      branch,
      result,
      skippedBrowserContracts,
    });
  }

  private mapResult(args: {
    req: FixRequest;
    branchSafeId: string;
    branch: string;
    result: { outcome: string; prUrl?: string; attempts: number; regressionContract?: string };
    skippedBrowserContracts: number;
  }): CoordinatorFixOutcome {
    const base = {
      issueId: args.req.issueId,
      issueJsonPath: args.req.issueJsonPath,
      branchSafeId: args.branchSafeId,
      branch: args.branch,
      skippedBrowserContracts: args.skippedBrowserContracts,
    };
    const openRes = this.lastOpenFixResult;
    this.lastOpenFixResult = null;

    if (args.result.outcome === 'SUCCESS') {
      if (openRes && (openRes.status === 'success' || openRes.status === 'already-exists')) {
        return { ...base, outcome: 'SUCCESS', prUrl: openRes.prUrl };
      }
      // Push / gh failed inside the callback.
      return { ...base, outcome: 'EXHAUSTED' };
    }
    if (args.result.outcome === 'REGRESSION') {
      return { ...base, outcome: 'REGRESSION', regressionContract: args.result.regressionContract };
    }
    if (args.result.outcome === 'CONTRACT_REVISION_NEEDED') {
      return { ...base, outcome: 'CONTRACT_REVISION_NEEDED' };
    }
    if (args.result.outcome === 'PARSE_ERROR') {
      return { ...base, outcome: 'PARSE_ERROR' };
    }
    return { ...base, outcome: 'EXHAUSTED' };
  }
}
