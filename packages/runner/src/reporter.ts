import { readFile } from 'node:fs/promises';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { writeEvidenceBundle, type WriteBundleInput } from '@contractqa/evidence';

export interface ReporterOptions {
  artifactsRoot: string;
  writer?: (i: WriteBundleInput) => Promise<unknown>;
  // When true, write an evidence bundle for PASS runs too (drift baseline /
  // dogfood proof-of-run). Default false (preserves Phase 1 behavior).
  alwaysBundle?: boolean;
}

const ATTACHMENT_MAP: Record<string, string> = {
  'evidence:state-diff': 'diffs/state-diff.json',
  'evidence:trace': 'trace.zip',
  'evidence:screenshot': 'screenshots/0001.png',
  'evidence:console': 'console/console.log',
  'evidence:network': 'network/network.har',
  'evidence:snapshot-before': 'snapshots/before.json',
  'evidence:snapshot-after': 'snapshots/after.json',
  'evidence:repro': 'repro.spec.ts',
  'evidence:issue-json': 'issue.json',
};

export class ContractQAReporter implements Reporter {
  private writer: NonNullable<ReporterOptions['writer']>;
  private opts: ReporterOptions;
  constructor(opts: ReporterOptions) {
    this.opts = opts;
    this.writer = opts.writer ?? writeEvidenceBundle;
  }

  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    const isFail = result.status === 'failed' || result.status === 'timedOut';
    if (!isFail && !this.opts.alwaysBundle) return;
    const idMatch = test.title.match(/^(INV-[A-Z0-9-]+)/);
    const contractId = idMatch?.[1] ?? 'UNKNOWN';
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${contractId}`;

    const files: Record<string, Buffer> = {};
    for (const att of result.attachments ?? []) {
      const dest = ATTACHMENT_MAP[att.name];
      if (!dest || !att.path) continue;
      files[dest] = await readFile(att.path);
    }
    await this.writer({
      runId,
      contractId,
      artifactsRoot: this.opts.artifactsRoot,
      files,
      redactionApplied: true,
    });
  }
}

export default ContractQAReporter;
