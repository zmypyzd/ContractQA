import { mkdir, writeFile as fsWriteFile, readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import type { ContractDoc, NoiseProfile, VerdictResult } from '@contractqa/core';
import type { StateSlice } from '@contractqa/oracle';
import { writeEvidenceBundle } from '@contractqa/evidence';
import { snapshotBrowser } from '@contractqa/probes';
import { compileContract, type CompiledPage } from './compile.js';
import { runOracle } from './fixtures.js';

export interface RunContractAttachment {
  name: string;
  path: string;
  contentType: string;
}

export interface RunContractInput {
  contract: ContractDoc;
  page: Parameters<typeof snapshotBrowser>[0] & CompiledPage;
  stripBaseUrl: string;
  noise: NoiseProfile;
  artifactsRoot: string;
  tracePath: string;
  harPath: string;
  screenshotPaths: { before: string; after: string };
  attachments: RunContractAttachment[];
  alwaysBundle?: boolean;
  // Called after the after-snapshot but before the bundle is written.
  // Playwright trace.zip + network.har are only flushed once
  // `context.tracing.stop({ path })` and `context.close()` complete — and
  // those must happen AFTER the page-driven snapshots. Hook lets the
  // caller close those resources in the right order without losing the
  // one-shot ergonomics.
  flushObservability?: () => Promise<void>;
  writeFile?: typeof fsWriteFile;
  readFile?: typeof fsReadFile;
}

export interface RunContractResult {
  verdict: VerdictResult;
  runId: string;
  bundleDir: string | null;
  before: StateSlice;
  after: StateSlice;
}

const ATTACHMENT_TO_REL: Record<string, string> = {
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

export async function runContract(input: RunContractInput): Promise<RunContractResult> {
  const writeFile = input.writeFile ?? fsWriteFile;
  const readFile = input.readFile ?? fsReadFile;

  const stripBase = (u: string): string => {
    if (input.stripBaseUrl && u.startsWith(input.stripBaseUrl)) {
      return u.slice(input.stripBaseUrl.length) || '/';
    }
    return u;
  };

  const beforeSnap = await snapshotBrowser(input.page, {
    screenshotPath: input.screenshotPaths.before,
  });
  const beforeState: StateSlice = {
    url: stripBase(beforeSnap.url),
    localStorageKeys: Object.keys(beforeSnap.localStorage),
    cookies: beforeSnap.cookies.map((c) => c.name),
  };

  const compiled = compileContract(input.contract);
  await compiled({
    page: input.page,
    snapshot: async () => ({
      url: stripBase(input.page.url()),
      localStorageKeys: await input.page.evaluate(() => Object.keys(localStorage)),
      cookies: [],
    }),
  });

  const afterSnap = await snapshotBrowser(input.page, {
    screenshotPath: input.screenshotPaths.after,
  });
  const afterState: StateSlice = {
    url: stripBase(afterSnap.url),
    localStorageKeys: Object.keys(afterSnap.localStorage),
    cookies: afterSnap.cookies.map((c) => c.name),
  };

  if (input.flushObservability) {
    await input.flushObservability();
  }

  const oracleAttached: RunContractAttachment[] = [];
  const scratchDir = path.dirname(input.tracePath);
  const verdict = await runOracle({
    contract: input.contract,
    before: beforeState,
    after: afterState,
    noise: input.noise,
    missingCapabilities: [],
    attach: (a) => oracleAttached.push(a),
    tmpDir: scratchDir,
  });

  let bundleDir: string | null = null;
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${input.contract.id}`;

  const shouldBundle =
    verdict.verdict === 'FAIL' || verdict.verdict === 'FLAKY' || !!input.alwaysBundle;

  if (shouldBundle) {
    const beforeSnapPath = path.join(scratchDir, 'snapshot-before.json');
    const afterSnapPath = path.join(scratchDir, 'snapshot-after.json');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(beforeSnapPath, JSON.stringify(beforeSnap, null, 2));
    await writeFile(afterSnapPath, JSON.stringify(afterSnap, null, 2));

    const allAttachments = [
      ...oracleAttached,
      ...input.attachments,
      { name: 'evidence:snapshot-before', path: beforeSnapPath, contentType: 'application/json' },
      { name: 'evidence:snapshot-after', path: afterSnapPath, contentType: 'application/json' },
    ];

    const files: Record<string, Buffer> = {};
    for (const att of allAttachments) {
      const rel = ATTACHMENT_TO_REL[att.name];
      if (!rel) continue;
      files[rel] = await readFile(att.path);
    }

    await writeEvidenceBundle({
      runId,
      contractId: input.contract.id,
      artifactsRoot: input.artifactsRoot,
      files,
      redactionApplied: true,
    });
    bundleDir = path.join(input.artifactsRoot, 'runs', runId);
  }

  return { verdict, runId, bundleDir, before: beforeState, after: afterState };
}
