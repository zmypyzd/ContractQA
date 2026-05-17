import { mkdir, writeFile as fsWriteFile, readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackendAdapter, ContractDoc, NoiseProfile, VerdictResult } from '@contractqa/core';
import type { StateSlice } from '@contractqa/oracle';
import { writeEvidenceBundle } from '@contractqa/evidence';
import { snapshotBrowser } from '@contractqa/probes';
import { compileContract, type CompiledPage } from './compile.js';
import { runOracle } from './fixtures.js';
import { evaluateBackendState } from './backend-evaluator.js';

export interface RunContractAttachment {
  name: string;
  path: string;
  contentType: string;
}

export interface RunContractInput {
  contract: ContractDoc;
  page: Parameters<typeof snapshotBrowser>[0] & CompiledPage;
  backend?: BackendAdapter;
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

  // Evaluate backend_state if present in the contract.
  // Severity: FAIL > INCONCLUSIVE > PASS — a backend FAIL always wins;
  // backend INCONCLUSIVE only downgrades a front-end PASS.
  if (input.contract.expected.backend_state) {
    const bs = input.contract.expected.backend_state;
    const backendResult = await evaluateBackendState(bs, input.backend);
    if (backendResult.verdict === 'FAIL') {
      verdict.verdict = 'FAIL';
      verdict.violations = [
        ...verdict.violations,
        {
          invariantId: 'backend_state',
          message: backendResult.reason ?? 'backend_state assertion failed',
          expected: bs.assert,
          actual: backendResult.reason,
        },
      ];
    } else if (backendResult.verdict === 'INCONCLUSIVE' && verdict.verdict === 'PASS') {
      verdict.verdict = 'INCONCLUSIVE';
      if (backendResult.missingCapability) {
        verdict.missingCapabilities = [
          ...verdict.missingCapabilities,
          backendResult.missingCapability,
        ];
      }
    }
  }

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

// ---------------------------------------------------------------------------
// HTTP-contract runner (no Playwright)
// ---------------------------------------------------------------------------

export interface RunHttpContractInput {
  contract: ContractDoc;
  backend?: BackendAdapter;
  baseUrl: string;
  /** Optional AbortSignal to cancel in-flight HTTP requests. */
  signal?: AbortSignal;
}

export interface RunHttpContractResult {
  verdict: VerdictResult;
  runId: string;
  /** Final fetch response status. */
  status: number;
  /** Final fetch response body as text (if any). */
  responseBody?: string;
}

/**
 * @experimental
 *
 * Sibling to `runContract` for HTTP-API contracts (no Playwright).
 *
 * All actions in the contract MUST be `type: 'http'`. Iterates them in order,
 * calling `fetch(baseUrl + action.path, { method, body, headers })` for each.
 * If `expected.backend_state` is set, the result of the final fetch is followed
 * by a call to `backend.query(...)` for state verification.
 *
 * Does not write an evidence bundle (HTTP has no Playwright trace/HAR/screenshot).
 *
 * **The HTTP response status is informational only.** The verdict is driven by
 * the post-call `backend_state` checks against the `BackendAdapter`. A 4xx/5xx
 * response does NOT automatically produce a FAIL; the contract author can assert
 * on the response state via `backend_state` if they care. (This is by design:
 * many contracts test that a write was rejected with a 4xx AND that no row was
 * persisted — those checks live in `backend_state`.)
 */
export async function runHttpContract(input: RunHttpContractInput): Promise<RunHttpContractResult> {
  const { contract, backend, baseUrl, signal } = input;

  // Guard: all actions must be http.
  for (const a of contract.actions) {
    if (a.type !== 'http') {
      throw new Error(
        `runHttpContract: all actions must be type 'http' — found type '${a.type}'. ` +
        `Mixed action types are not supported; use runContract for Playwright contracts.`,
      );
    }
  }

  let lastStatus = 0;
  let lastBody = '';
  for (const a of contract.actions) {
    if (a.type !== 'http') continue; // satisfies TS narrowing
    // Normalize incoming header names to lowercase so the default Content-Type
    // check below is case-insensitive (HTTP headers are case-insensitive by RFC).
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.headers ?? {})) {
      headers[k.toLowerCase()] = v;
    }
    if (a.body !== undefined && headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json';
    }
    const init: RequestInit = {
      method: a.method,
      headers,
      ...(a.body !== undefined ? { body: JSON.stringify(a.body) } : {}),
      ...(signal !== undefined ? { signal } : {}),
    };
    const res = await fetch(`${baseUrl}${a.path}`, init);
    lastStatus = res.status;
    lastBody = await res.text();
  }

  // Backend state evaluation (reuses Phase 4 evaluator).
  const expectedBackend = (contract.expected as any).backend_state as
    | { named_query: string; params: Record<string, unknown>; assert: unknown }
    | undefined;

  let verdict: VerdictResult;
  if (expectedBackend) {
    const backendResult = await evaluateBackendState(
      expectedBackend as Parameters<typeof evaluateBackendState>[0],
      backend,
    );
    if (backendResult.verdict === 'PASS') {
      verdict = {
        verdict: 'PASS',
        violations: [],
        confidence: 1,
        reproductionRate: 1,
        flakeScore: 0,
        evidenceCompleteness: 1,
        missingCapabilities: [],
      };
    } else if (backendResult.verdict === 'FAIL') {
      verdict = {
        verdict: 'FAIL',
        violations: [
          {
            invariantId: 'backend_state',
            message: backendResult.reason ?? 'backend_state assertion failed',
            expected: expectedBackend.assert,
            actual: backendResult.reason,
          },
        ],
        confidence: 1,
        reproductionRate: 1,
        flakeScore: 0,
        evidenceCompleteness: 1,
        missingCapabilities: [],
      };
    } else {
      // INCONCLUSIVE (no backend adapter or unsupported assert)
      verdict = {
        verdict: 'INCONCLUSIVE',
        violations: [],
        confidence: 0,
        reproductionRate: 0,
        flakeScore: 0,
        evidenceCompleteness: 0,
        missingCapabilities: backendResult.missingCapability ? [backendResult.missingCapability] : ['backend_probe'],
      };
    }
  } else {
    // No backend assertion — HTTP returned without error → PASS.
    verdict = {
      verdict: 'PASS',
      violations: [],
      confidence: 1,
      reproductionRate: 1,
      flakeScore: 0,
      evidenceCompleteness: 1,
      missingCapabilities: [],
    };
  }

  return {
    verdict,
    runId: contract.id,
    status: lastStatus,
    responseBody: lastBody,
  };
}
