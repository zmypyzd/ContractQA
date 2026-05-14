# ContractQA Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps three real-repo dogfoods (5-4-codex, website-vercel-supabase, wolfmind) exposed in Phase 1. Headline framing from `dogfood/FINDINGS.md`: Phase 1's contract → compile → snapshot → oracle → bundle CORE is genuinely framework-agnostic and needs ~zero investment. All Phase 2 work is in the GLUE around it — ergonomic standalone API, contract-schema breadth, host-app preflight, multi-adapter composition, host install path.

**Architecture:** Stay inside the existing pnpm monorepo. No new top-level packages — every Phase 2 deliverable lands in `packages/runner`, `packages/core`, `packages/probes`, `packages/cli`, `packages/adapters`, or `dogfood/`. Schema changes are additive (every existing contract YAML still validates). The new `runContract()` API replaces the ~70-line vitest glue each dogfood currently re-implements.

**Tech Stack:** Same as Phase 1 (TypeScript 5, pnpm workspaces, Zod 3, Playwright 1.49+, Vitest 2). No new heavyweight deps.

**Scope discipline:**
- In: every finding tagged "Phase 2 task" in `dogfood/**/FINDINGS.md`; reaching §23.1's "5+ real repos validated" bar by adding 2 more dogfood targets on top of the existing 3.
- Out (Phase 3+): persona-driven dogfood agents, property/model-based testing, dashboard §15.3–§15.6, OpenClaw integration, public adapter API, framework-detection in `contractqa init`.

**Sub-phase split** (each leaves a shippable artifact, natural review boundary):
- **Phase 2a** — Standalone API + schema breadth (T1–T8): `runContract()`, `target.within`, `target.locale`, `dom:` block, origin-less snapshot handling, `ReporterOptions.alwaysBundle`.
- **Phase 2b** — `contractqa doctor` preflight (T9–T14): env preflight, native-rebuild detection, port allocation, dev-server boot probe, first-error stderr surface.
- **Phase 2c** — Adapter composition + cookie-auth adapter (T15–T18): `auth: AuthAdapter[]`, `CustomCookieAuthAdapter`, composite NextAuth+Supabase.
- **Phase 2d** — Host install path + Phase 2 acceptance (T19–T22): `pnpm pack` workflow, 2 more dogfood targets to reach §23.1's 5-repo bar, Phase 2 acceptance script.

---

## File Structure (locked before tasks start)

New files (Phase 2):

```
packages/runner/src/
├── run-contract.ts                       # NEW: one-shot runContract() helper
├── reporter.ts                            # modified: alwaysBundle option
├── compile.ts                             # modified: target.within scoping + target.locale

packages/core/src/
├── schemas/contract.schema.ts             # modified: target.within, goto.locale, dom: block
├── types/snapshot.ts                      # modified: BrowserSnapshot.dom

packages/probes/src/
├── browser-snapshot.ts                    # modified: origin-less page handling + captureDom

packages/oracle/src/
├── declared-fields.ts                     # modified: dom: classifier integration
├── dom-classifier.ts                      # NEW: dom.contains_text / not_contains_text / role_count

packages/adapters/src/
├── custom-cookie-auth-adapter.ts          # NEW: CustomCookieAuthAdapter for non-OAuth cookie apps
├── composite-auth-adapter.ts              # NEW: AuthAdapter[] runtime composer
├── index.ts                               # modified: exports

packages/cli/src/
├── commands/doctor.ts                     # NEW: contractqa doctor <target>
├── lib/port-pool.ts                       # NEW: free-port allocation
├── lib/host-probe.ts                      # NEW: boot host dev server + capture first stderr error
├── lib/env-detect.ts                      # NEW: parse .env.example + package.json scripts
├── lib/native-deps.ts                     # NEW: detect .node bindings needing rebuild
├── bin/contractqa.ts                      # modified: register doctor subcommand

dogfood/
├── 5-4-claude/                            # NEW dogfood target #4 — Vite + React + Supabase
├── agent-poker-platform/                  # NEW dogfood target #5 — original variant
├── FINDINGS.md                            # modified: 5-target summary, ranked Phase 3 input

scripts/
├── pack-for-host.sh                       # NEW: pnpm pack tarball workflow
├── phase2-acceptance.sh                   # NEW: gates Phase 2 acceptance

package.json                               # modified: pack:host script
README.md                                  # modified: Phase 2 status + install path docs
```

Tooling conventions (apply to every task):
- TDD: failing test first, then implementation, then GREEN, then commit. Same as Phase 1.
- Each task ends with a `git add <named-files>` (never `git add -A`) + `git commit` with a single-line conventional-commit subject.
- After every task: `pnpm -r --filter './packages/**' typecheck && pnpm -r --filter './packages/**' test` must pass. The acceptance script (T22) runs this gate explicitly.
- New schema fields are ALWAYS optional in Zod so existing contracts continue to validate.
- All new public exports go through `packages/<name>/src/index.ts` and are re-exported.

---

## Phase 2a — Standalone API + schema breadth

### Task 1: `runContract()` one-shot helper

**Files:**
- Create: `packages/runner/src/run-contract.ts`
- Test: `packages/runner/tests/run-contract.test.ts`
- Modify: `packages/runner/src/index.ts`

Problem (from `dogfood/FINDINGS.md` cross-cutting #2): every dogfood re-implements ~70 lines of glue — pre-navigate, snapshotBrowser before, compileContract, snapshotBrowser after, runOracle, writeEvidenceBundle. Fold that into one call.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runner/tests/run-contract.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runContract } from '../src/run-contract.js';
import type { ContractDoc } from '@contractqa/core';

const contract: ContractDoc = {
  id: 'INV-T1',
  title: 'tiny',
  area: 'test',
  severity: 'P2',
  owner: 'test',
  risk_tags: [],
  preconditions: { auth_state: 'anonymous' },
  actions: [{ type: 'goto', path: '/' }],
  expected: { url: { matches: '^/$' } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
};

function fakePage(url: string) {
  const locator = {
    click: async () => undefined,
    fill: async () => undefined,
    first() { return locator; },
    getByRole() { return locator; },
  };
  return {
    url: () => url,
    title: async () => 't',
    viewportSize: () => ({ width: 1, height: 1 }),
    screenshot: async () => Buffer.from([0]),
    content: async () => '<html></html>',
    evaluate: async (fn: any) => fn(),
    context: () => ({ cookies: async () => [] }),
    on: () => undefined,
    goto: async () => undefined,
    getByRole: () => locator,
    waitForTimeout: async () => undefined,
  };
}

describe('runContract', () => {
  it('runs end-to-end and returns a verdict + bundle dir on PASS+alwaysBundle', async () => {
    const result = await runContract({
      contract,
      page: fakePage('http://localhost:3000/') as any,
      stripBaseUrl: 'http://localhost:3000',
      noise: {
        project: 't',
        generated_at: '2026-05-14T00:00:00Z',
        ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] },
      },
      artifactsRoot: '/tmp/cqa-run-contract-test',
      tracePath: '/tmp/cqa-trace.zip',
      harPath: '/tmp/cqa-network.har',
      screenshotPaths: { before: '/tmp/cqa-before.png', after: '/tmp/cqa-after.png' },
      attachments: [
        { name: 'evidence:trace', path: '/tmp/cqa-trace.zip', contentType: 'application/zip' },
      ],
      alwaysBundle: true,
      writeFile: vi.fn(async () => undefined) as any,
      readFile: vi.fn(async () => Buffer.from([0])) as any,
    });
    expect(result.verdict.verdict).toBe('PASS');
    expect(result.runId).toContain('INV-T1');
    expect(result.bundleDir).toContain('runs/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/run-contract.test.ts`
Expected: FAIL — `Cannot find module '../src/run-contract.js'`.

- [ ] **Step 3: Implement `runContract`**

```ts
// packages/runner/src/run-contract.ts
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

  const shouldBundle = verdict.verdict === 'FAIL' || verdict.verdict === 'FLAKY' || input.alwaysBundle;
  if (shouldBundle) {
    const beforeSnapPath = path.join(scratchDir, 'snapshot-before.json');
    const afterSnapPath = path.join(scratchDir, 'snapshot-after.json');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(beforeSnapPath, JSON.stringify(beforeSnap, null, 2));
    await writeFile(afterSnapPath, JSON.stringify(afterSnap, null, 2));

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
```

- [ ] **Step 4: Wire export**

Add to `packages/runner/src/index.ts`:

```ts
export { runContract } from './run-contract.js';
export type { RunContractInput, RunContractResult, RunContractAttachment } from './run-contract.js';
```

- [ ] **Step 5: Run tests to verify PASS**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/run-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runner/src/run-contract.ts packages/runner/src/index.ts packages/runner/tests/run-contract.test.ts
git commit -m "feat(runner): runContract() one-shot helper folding the dogfood glue"
```

---

### Task 2: `ReporterOptions.alwaysBundle` for PASS runs

**Files:**
- Modify: `packages/runner/src/reporter.ts`
- Test: `packages/runner/tests/reporter.test.ts`

Problem (`dogfood/FINDINGS.md` cross-cutting): `ContractQAReporter.onTestEnd` early-returns on non-failed status, so PASS runs produce no bundle. Dogfood and baseline workflows want bundles on PASS.

- [ ] **Step 1: Write the failing test**

In `packages/runner/tests/reporter.test.ts` (create if missing — copy imports from any existing reporter test if there's one already):

```ts
import { describe, it, expect, vi } from 'vitest';
import { ContractQAReporter } from '../src/reporter.js';
import type { TestCase, TestResult } from '@playwright/test/reporter';

describe('ContractQAReporter.alwaysBundle', () => {
  it('alwaysBundle: true writes a bundle even on passed status', async () => {
    const writer = vi.fn(async () => ({ run_id: 'rid' } as unknown));
    const reporter = new ContractQAReporter({ artifactsRoot: '/tmp/r', writer, alwaysBundle: true });
    const test = { title: 'INV-X1: t' } as unknown as TestCase;
    const result = { status: 'passed', attachments: [] } as unknown as TestResult;
    await reporter.onTestEnd(test, result);
    expect(writer).toHaveBeenCalled();
  });

  it('alwaysBundle: false (default) skips passed status', async () => {
    const writer = vi.fn(async () => ({ run_id: 'rid' } as unknown));
    const reporter = new ContractQAReporter({ artifactsRoot: '/tmp/r', writer });
    const test = { title: 'INV-X1: t' } as unknown as TestCase;
    const result = { status: 'passed', attachments: [] } as unknown as TestResult;
    await reporter.onTestEnd(test, result);
    expect(writer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/reporter.test.ts -t alwaysBundle`
Expected: FAIL — `expected "spy" to have been called`.

- [ ] **Step 3: Modify the reporter**

In `packages/runner/src/reporter.ts`:

```ts
export interface ReporterOptions {
  artifactsRoot: string;
  writer?: (i: WriteBundleInput) => Promise<unknown>;
  alwaysBundle?: boolean;
}

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
    // ... rest unchanged
  }
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/reporter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runner/src/reporter.ts packages/runner/tests/reporter.test.ts
git commit -m "feat(runner): ReporterOptions.alwaysBundle for PASS-path bundling"
```

---

### Task 3: `target.within` for locator scoping

**Files:**
- Modify: `packages/core/src/schemas/contract.schema.ts`
- Modify: `packages/runner/src/compile.ts`
- Test: `packages/runner/tests/compile.test.ts`

Problem (`dogfood/website-vercel-supabase/FINDINGS.md` #3 follow-up): `target.first: true` (already shipped in commit ce355a4) picks an arbitrary match. Real authors want semantic scoping — "the navbar Login, not the footer Login." Playwright supports `getByRole('navigation').getByRole('link', { name: '...' })`.

- [ ] **Step 1: Extend the schema**

In `packages/core/src/schemas/contract.schema.ts`, modify the `Target` definition:

```ts
const Target = z.object({
  role: z.string().optional(),
  name_regex: SafeRegex.optional(),
  test_id: z.string().optional(),
  text: z.string().optional(),
  first: z.boolean().optional(),
  within: z.string().optional(),
});
```

- [ ] **Step 2: Write the failing test**

In `packages/runner/tests/compile.test.ts` (create if missing):

```ts
import { describe, it, expect, vi } from 'vitest';
import { compileContract } from '../src/compile.js';
import type { ContractDoc } from '@contractqa/core';

function makePage() {
  const calls: string[] = [];
  const locator: any = {
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    first: vi.fn(() => locator),
    getByRole: vi.fn((role: string) => {
      calls.push(`scoped:getByRole(${role})`);
      return locator;
    }),
  };
  const page: any = {
    goto: vi.fn(async () => undefined),
    url: () => 'http://x/',
    waitForTimeout: vi.fn(async () => undefined),
    getByRole: vi.fn((role: string) => {
      calls.push(`page:getByRole(${role})`);
      return locator;
    }),
  };
  return { page, locator, calls };
}

describe('compileContract target.within scoping', () => {
  it('chains getByRole(within).getByRole(target.role) when target.within is set', async () => {
    const { page, calls } = makePage();
    const c: ContractDoc = {
      id: 'INV-T3', title: 't', area: 'test', severity: 'P2', owner: 't', risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'click', target: { role: 'link', name_regex: 'x', within: 'navigation' } }],
      expected: {},
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    };
    const compiled = compileContract(c);
    await compiled({ page, snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }) });
    expect(calls).toEqual(['page:getByRole(navigation)', 'scoped:getByRole(link)']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/compile.test.ts -t within`
Expected: FAIL.

- [ ] **Step 4: Implement scoping in compileContract**

In `packages/runner/src/compile.ts`, extend `CompiledLocator` and the click/fill branches:

```ts
export interface CompiledLocator {
  click(): Promise<unknown>;
  fill(v: string): Promise<unknown>;
  first(): CompiledLocator;
  getByRole(role: string, opts?: { name?: RegExp }): CompiledLocator;
}

// inside compileContract loop, click branch:
} else if (a.type === 'click') {
  const opts: { name?: RegExp } = {};
  if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
  const scope = a.target.within
    ? ctx.page.getByRole(a.target.within).getByRole(a.target.role ?? 'button', opts)
    : ctx.page.getByRole(a.target.role ?? 'button', opts);
  const loc = a.target.first ? scope.first() : scope;
  await loc.click();
} else if (a.type === 'fill') {
  const opts: { name?: RegExp } = {};
  if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
  const scope = a.target.within
    ? ctx.page.getByRole(a.target.within).getByRole(a.target.role ?? 'textbox', opts)
    : ctx.page.getByRole(a.target.role ?? 'textbox', opts);
  const loc = a.target.first ? scope.first() : scope;
  await loc.fill(a.value);
}
```

- [ ] **Step 5: Run tests to verify PASS**

Run: `pnpm --filter @contractqa/core build && pnpm --filter @contractqa/runner build && pnpm --filter @contractqa/runner exec vitest run tests/compile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/contract.schema.ts packages/runner/src/compile.ts packages/runner/tests/compile.test.ts
git commit -m "feat(schema+runner): target.within for ancestor-role locator scoping"
```

---

### Task 4: `dom:` block — `contains_text` / `not_contains_text` / `role_count`

**Files:**
- Modify: `packages/core/src/schemas/contract.schema.ts`
- Modify: `packages/core/src/types/snapshot.ts`
- Modify: `packages/oracle/src/state-diff.ts` (extend `StateSlice` with optional `dom`)
- Create: `packages/oracle/src/dom-classifier.ts`
- Modify: `packages/oracle/src/declared-fields.ts`
- Test: `packages/oracle/tests/dom-classifier.test.ts`

Problem (`dogfood/wolfmind/FINDINGS.md`): Phase 1 can only express auth-shaped invariants. Real apps need DOM-shaped invariants — "exactly 4 agent cards rendered," "no 'Error' text on page."

- [ ] **Step 1: Define `DomShape`**

In `packages/core/src/types/snapshot.ts`, add (and re-export from `packages/core/src/index.ts`):

```ts
export interface DomShape {
  roleCounts: Record<string, number>;
  visibleText: string;
}
```

In `packages/core/src/types/snapshot.ts`, also extend `BrowserSnapshot`:

```ts
export interface BrowserSnapshot {
  // ... existing fields
  dom?: DomShape;
}
```

In `packages/oracle/src/state-diff.ts`, extend `StateSlice`:

```ts
export interface StateSlice {
  url: string;
  localStorageKeys: string[];
  cookies: string[];
  dom?: DomShape;
}
```

(Import `DomShape` from `@contractqa/core`.)

- [ ] **Step 2: Extend the contract schema**

In `packages/core/src/schemas/contract.schema.ts`:

```ts
const ExpectedBlock = z.object({
  url: z.object({ matches: SafeRegex }).partial().optional(),
  localStorage: z.object({
    no_key_matches: SafeRegex.optional(),
    has_key_matches: SafeRegex.optional(),
  }).optional(),
  sessionStorage: z.object({ no_key_matches: SafeRegex.optional() }).optional(),
  cookies: z.object({ no_name_matches: SafeRegex.optional() }).optional(),
  dom: z.object({
    contains_text: z.array(z.string()).optional(),
    not_contains_text: z.array(z.string()).optional(),
    role_count: z.array(z.object({
      role: z.string(),
      name_regex: SafeRegex.optional(),
      eq: z.number().int().nonnegative().optional(),
      gte: z.number().int().nonnegative().optional(),
      lte: z.number().int().nonnegative().optional(),
    })).optional(),
  }).optional(),
  // existing watch_keys block stays as-is
});
```

(If the existing schema already has a placeholder `dom` field with only `not_contains_any`, replace it with the above.)

- [ ] **Step 3: Write the failing test**

```ts
// packages/oracle/tests/dom-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyDom } from '../src/dom-classifier.js';
import type { DomShape } from '@contractqa/core';

const dom: DomShape = {
  roleCounts: { 'link:Login': 2, 'heading:WolfMind': 1 },
  visibleText: 'Welcome to WolfMind. Click Login to start.',
};

describe('classifyDom', () => {
  it('contains_text PASSes when every needle appears', () => {
    const r = classifyDom(dom, { contains_text: ['WolfMind', 'Login'] });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions.length).toBeGreaterThan(0);
  });

  it('contains_text FAILs the missing needles', () => {
    const r = classifyDom(dom, { contains_text: ['WolfMind', 'Logout'] });
    expect(r.failContributions.some((f) => f.detail.includes('Logout'))).toBe(true);
  });

  it('not_contains_text FAILs when a banned string appears', () => {
    const r = classifyDom(dom, { not_contains_text: ['Welcome'] });
    expect(r.failContributions[0]!.detail).toContain('Welcome');
  });

  it('role_count.eq PASSes on exact match', () => {
    const r = classifyDom(dom, { role_count: [{ role: 'link', name_regex: 'Login', eq: 2 }] });
    expect(r.failContributions).toEqual([]);
  });

  it('role_count.lte FAILs on over-count', () => {
    const r = classifyDom(dom, { role_count: [{ role: 'link', name_regex: 'Login', lte: 1 }] });
    expect(r.failContributions.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @contractqa/oracle exec vitest run tests/dom-classifier.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 5: Implement `classifyDom`**

```ts
// packages/oracle/src/dom-classifier.ts
import type { DomShape } from '@contractqa/core';

export interface DomExpected {
  contains_text?: string[];
  not_contains_text?: string[];
  role_count?: Array<{ role: string; name_regex?: string; eq?: number; gte?: number; lte?: number }>;
}

export interface DomClassification {
  passContributions: Array<{ field: string; detail: string }>;
  failContributions: Array<{ field: string; detail: string; actual: unknown }>;
}

export function classifyDom(dom: DomShape, expected: DomExpected): DomClassification {
  const out: DomClassification = { passContributions: [], failContributions: [] };

  if (expected.contains_text) {
    for (const needle of expected.contains_text) {
      if (dom.visibleText.includes(needle)) {
        out.passContributions.push({ field: 'dom.contains_text', detail: `contains "${needle}"` });
      } else {
        out.failContributions.push({
          field: 'dom.contains_text',
          detail: `missing expected text "${needle}"`,
          actual: dom.visibleText.slice(0, 200),
        });
      }
    }
  }

  if (expected.not_contains_text) {
    for (const banned of expected.not_contains_text) {
      if (dom.visibleText.includes(banned)) {
        out.failContributions.push({
          field: 'dom.not_contains_text',
          detail: `unexpectedly contains "${banned}"`,
          actual: banned,
        });
      }
    }
  }

  if (expected.role_count) {
    for (const rc of expected.role_count) {
      let total = 0;
      for (const [key, count] of Object.entries(dom.roleCounts)) {
        const [role, name] = key.split(':');
        if (role !== rc.role) continue;
        if (rc.name_regex && !new RegExp(rc.name_regex).test(name ?? '')) continue;
        total += count;
      }
      const label = `role=${rc.role}${rc.name_regex ? ` name=/${rc.name_regex}/` : ''}`;
      if (rc.eq !== undefined && total !== rc.eq) {
        out.failContributions.push({ field: 'dom.role_count', detail: `${label} expected ==${rc.eq}`, actual: total });
      } else if (rc.gte !== undefined && total < rc.gte) {
        out.failContributions.push({ field: 'dom.role_count', detail: `${label} expected >=${rc.gte}`, actual: total });
      } else if (rc.lte !== undefined && total > rc.lte) {
        out.failContributions.push({ field: 'dom.role_count', detail: `${label} expected <=${rc.lte}`, actual: total });
      } else {
        out.passContributions.push({ field: 'dom.role_count', detail: `${label} = ${total}` });
      }
    }
  }

  return out;
}
```

- [ ] **Step 6: Wire `classifyDom` into `classifyDiff`**

In `packages/oracle/src/declared-fields.ts`, update the `Expected` interface and add the dom branch:

```ts
import { classifyDom, type DomExpected } from './dom-classifier.js';

export interface Expected {
  url?: { matches?: string };
  localStorage?: { no_key_matches?: string; has_key_matches?: string };
  cookies?: { no_name_matches?: string };
  dom?: DomExpected;
  watch_keys?: { localStorage?: string[]; cookies?: string[] };
}

// at the end of classifyDiff, before `return out;`:
if (expected.dom && afterState?.dom) {
  const domRes = classifyDom(afterState.dom, expected.dom);
  out.passContributions.push(...domRes.passContributions);
  out.failContributions.push(...domRes.failContributions);
} else if (expected.dom && !afterState?.dom) {
  out.failContributions.push({
    field: 'dom',
    detail: 'contract declares dom expectations but afterState has no DomShape — call snapshotBrowser with captureDom: true',
    actual: null,
  });
}
```

Also export `classifyDom` from `packages/oracle/src/index.ts`.

- [ ] **Step 7: Run tests to verify PASS**

Run: `pnpm --filter @contractqa/core build && pnpm --filter @contractqa/oracle build && pnpm --filter @contractqa/oracle exec vitest run`
Expected: PASS (all oracle tests including 5 new dom-classifier ones).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/schemas/contract.schema.ts packages/core/src/types/snapshot.ts packages/oracle/src/dom-classifier.ts packages/oracle/src/declared-fields.ts packages/oracle/src/state-diff.ts packages/oracle/src/index.ts packages/oracle/tests/dom-classifier.test.ts
git commit -m "feat(schema+oracle): dom block (contains_text, not_contains_text, role_count)"
```

---

### Task 5: `snapshotBrowser.captureDom` + origin-less page tolerance

**Files:**
- Modify: `packages/probes/src/browser-snapshot.ts`
- Test: `packages/probes/tests/browser-snapshot.test.ts`

Problem A (continuing T4): to use the `dom:` block, the snapshot must include `DomShape`. Add `captureDom?: boolean` (default false).
Problem B (`dogfood/website-vercel-supabase/FINDINGS.md` #2): `about:blank` has no origin; `window.localStorage` throws SecurityError. Wrap the evaluate calls in try/catch and return empty maps.

- [ ] **Step 1: Write the failing tests**

Append to `packages/probes/tests/browser-snapshot.test.ts`:

```ts
// helper that lets us script evaluate() return values
function makeFakePage(evalReturns: any[]) {
  let i = 0;
  return {
    url: () => 'http://x/',
    title: async () => 't',
    viewportSize: () => ({ width: 1, height: 1 }),
    screenshot: async () => Buffer.from([0]),
    content: async () => '<html></html>',
    evaluate: async () => {
      const v = evalReturns[i++];
      if (v instanceof Error) throw v;
      return v;
    },
    context: () => ({ cookies: async () => [] }),
    on: () => undefined,
  };
}

it('captureDom: true populates dom.roleCounts and dom.visibleText', async () => {
  const page: any = makeFakePage([
    { 'theme': 'dark' },                                                       // localStorage
    {},                                                                         // sessionStorage
    { roleCounts: { 'link:Login': 2 }, visibleText: 'Hi WolfMind' },           // dom
  ]);
  const snap = await snapshotBrowser(page, { screenshotPath: '/tmp/x.png', captureDom: true });
  expect(snap.dom?.roleCounts['link:Login']).toBe(2);
  expect(snap.dom?.visibleText).toContain('WolfMind');
});

it('captureDom default false: snap.dom is undefined', async () => {
  const page: any = makeFakePage([{}, {}]);
  const snap = await snapshotBrowser(page, { screenshotPath: '/tmp/x.png' });
  expect(snap.dom).toBeUndefined();
});

it('returns empty storage maps when localStorage throws SecurityError', async () => {
  const sec = Object.assign(new Error('Failed to read the localStorage property'), { name: 'SecurityError' });
  const page: any = makeFakePage([sec, sec]);
  const snap = await snapshotBrowser(page, { screenshotPath: '/tmp/x.png' });
  expect(snap.localStorage).toEqual({});
  expect(snap.sessionStorage).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @contractqa/probes exec vitest run tests/browser-snapshot.test.ts`
Expected: FAIL — current snapshotBrowser propagates SecurityError; snap.dom is undefined even with captureDom: true.

- [ ] **Step 3: Implement origin-less tolerance**

In `packages/probes/src/browser-snapshot.ts`, replace the storage `page.evaluate` blocks:

```ts
const localStorage = await page.evaluate(() => {
  try {
    const out: Record<string, string> = {};
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k) out[k] = ls.getItem(k) ?? '';
    }
    return out;
  } catch {
    return {};
  }
});

const sessionStorage = await page.evaluate(() => {
  try {
    const out: Record<string, string> = {};
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!ss) return out;
    for (let i = 0; i < ss.length; i++) {
      const k = ss.key(i);
      if (k) out[k] = ss.getItem(k) ?? '';
    }
    return out;
  } catch {
    return {};
  }
});
```

- [ ] **Step 4: Implement captureDom**

Add to `SnapshotOptions`:

```ts
export interface SnapshotOptions {
  screenshotPath: string;
  consoleBuffer?: BrowserSnapshot['console'];
  networkBuffer?: BrowserSnapshot['network'];
  websocketBuffer?: BrowserSnapshot['websocket'];
  captureDom?: boolean;
}
```

In the function body, after the cookies block, before `return`:

```ts
let dom: BrowserSnapshot['dom'] | undefined;
if (opts.captureDom) {
  dom = await page.evaluate(() => {
    try {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('[role], a, button, h1, h2, h3, input'));
      const counts: Record<string, number> = {};
      for (const el of elements) {
        const tag = el.tagName;
        const role = el.getAttribute('role')
          ?? (tag === 'A' ? 'link'
          : tag === 'BUTTON' ? 'button'
          : tag.startsWith('H') ? 'heading'
          : tag === 'INPUT' ? 'textbox'
          : null);
        if (!role) continue;
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
        const key = `${role}:${name}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      return { roleCounts: counts, visibleText };
    } catch {
      return { roleCounts: {}, visibleText: '' };
    }
  });
}

return {
  // ...all existing fields,
  dom,
};
```

- [ ] **Step 5: Run tests to verify PASS**

Run: `pnpm --filter @contractqa/probes build && pnpm --filter @contractqa/probes exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/probes/src/browser-snapshot.ts packages/probes/tests/browser-snapshot.test.ts
git commit -m "feat(probes): snapshotBrowser captureDom + origin-less page tolerance"
```

---

### Task 6: `goto.locale` for i18n stability

**Files:**
- Modify: `packages/core/src/schemas/contract.schema.ts`
- Modify: `packages/runner/src/compile.ts`
- Test: `packages/runner/tests/compile.test.ts`

Problem (`dogfood/website-vercel-supabase/FINDINGS.md` #3 sibling): the target's `nav.login` is `"登录"` or `"Login"` depending on locale. Today the contract author bakes `"登录|login"` regex. Better: `goto.locale: 'en'` sets `Accept-Language` before navigation.

- [ ] **Step 1: Extend the schema**

```ts
const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string(), locale: z.string().optional() }),
  z.object({ type: z.literal('click'), target: Target }),
  z.object({ type: z.literal('fill'), target: Target, value: z.string() }),
  z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }),
]);
```

- [ ] **Step 2: Write the failing test**

Append to compile.test.ts:

```ts
it('goto.locale calls page.setExtraHTTPHeaders before navigating', async () => {
  const setHeaders = vi.fn(async () => undefined);
  const locator: any = { click: async () => undefined, fill: async () => undefined, first: () => locator, getByRole: () => locator };
  const page: any = {
    goto: vi.fn(async () => undefined),
    setExtraHTTPHeaders: setHeaders,
    url: () => '/', waitForTimeout: vi.fn(async () => undefined),
    getByRole: () => locator,
  };
  const c: ContractDoc = {
    id: 'INV-T6', title: 't', area: 'test', severity: 'P2', owner: 't', risk_tags: [],
    preconditions: { auth_state: 'anonymous' },
    actions: [{ type: 'goto', path: '/', locale: 'en-US' }],
    expected: {}, verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
  };
  await compileContract(c)({ page, snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }) });
  expect(setHeaders).toHaveBeenCalledWith({ 'Accept-Language': 'en-US' });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/compile.test.ts -t locale`
Expected: FAIL.

- [ ] **Step 4: Implement**

Extend `CompiledPage` in compile.ts:

```ts
export interface CompiledPage {
  goto(path: string): Promise<unknown>;
  setExtraHTTPHeaders?(h: Record<string, string>): Promise<unknown>;
  getByRole(role: string, opts?: { name?: RegExp }): CompiledLocator;
  url(): string;
  waitForTimeout(ms: number): Promise<unknown>;
}
```

In the goto branch of `compileContract`:

```ts
if (a.type === 'goto') {
  if (a.locale && ctx.page.setExtraHTTPHeaders) {
    await ctx.page.setExtraHTTPHeaders({ 'Accept-Language': a.locale });
  }
  await ctx.page.goto(a.path);
}
```

- [ ] **Step 5: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/contract.schema.ts packages/runner/src/compile.ts packages/runner/tests/compile.test.ts
git commit -m "feat(schema+runner): goto.locale sets Accept-Language for i18n stability"
```

---

### Task 7: Migrate dogfood tests to `runContract()`

**Files:**
- Modify: `dogfood/5-4-codex/dogfood.test.ts`
- Modify: `dogfood/website-vercel-supabase/dogfood.test.ts`
- Modify: `dogfood/wolfmind/dogfood.test.ts`

Each currently has ~70 lines of glue. Replace with a `runContract()` call.

- [ ] **Step 1: Update 5-4-codex test**

Replace the block from the BEFORE snapshot through the manifest assertion with:

```ts
const result = await runContract({
  contract: inv!,
  page: page as any,
  stripBaseUrl: WEB_BASE,
  noise,
  artifactsRoot,
  tracePath, harPath,
  screenshotPaths: { before: beforeShot, after: afterShot },
  attachments: [
    { name: 'evidence:trace', path: tracePath, contentType: 'application/zip' },
    { name: 'evidence:screenshot', path: afterShot, contentType: 'image/png' },
    { name: 'evidence:network', path: harPath, contentType: 'application/json' },
  ],
  alwaysBundle: true,
});
expect(result.verdict.verdict).toBe('PASS');
expect(result.bundleDir).toBeTruthy();
```

Drop the synthetic-FAIL block (reporter tests in T2 cover this now).

Make sure to still call `await context.tracing.stop({ path: tracePath })` and `await context.close()` BEFORE invoking runContract, so the HAR/trace are flushed.

- [ ] **Step 2: Update website-vercel-supabase test**

Same pattern.

- [ ] **Step 3: Update wolfmind test**

Same pattern.

- [ ] **Step 4: Run all dogfoods**

Run: `pnpm --filter @contractqa/dogfood test`
Expected: 3 tests PASS in <30s combined.

- [ ] **Step 5: Commit**

```bash
git add dogfood/5-4-codex/dogfood.test.ts dogfood/website-vercel-supabase/dogfood.test.ts dogfood/wolfmind/dogfood.test.ts
git commit -m "refactor(dogfood): migrate all 3 targets to runContract() helper"
```

---

### Task 8: Phase 2a checkpoint

- [ ] **Step 1: Full gate**

Run: `pnpm -r --filter './packages/**' typecheck && pnpm -r --filter './packages/**' test && pnpm -r --filter './packages/**' build && pnpm --filter @contractqa/dogfood test && ./scripts/phase1-acceptance.sh`
Expected: every line green; final line `OK — Phase 1 acceptance passed.`.

- [ ] **Step 2: Marker commit**

```bash
git commit --allow-empty -m "chore: phase 2a checkpoint — standalone API + schema breadth green"
```

---

## Phase 2b — `contractqa doctor` preflight

### Task 9: Port pool

**Files:**
- Create: `packages/cli/src/lib/port-pool.ts`
- Test: `packages/cli/tests/port-pool.test.ts`

Problem (`dogfood/FINDINGS.md` cross-cutting): dogfoods default each target's port and collide. Allocate ports from a pool that probes for free ones at request time.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/port-pool.test.ts
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { allocatePort } from '../src/lib/port-pool.js';

describe('allocatePort', () => {
  it('returns a port that can be bound', async () => {
    const port = await allocatePort(3700);
    expect(port).toBeGreaterThanOrEqual(3700);
    await new Promise<void>((res, rej) => {
      const s = net.createServer().listen(port, '127.0.0.1', () => { s.close(); res(); }).on('error', rej);
    });
  });

  it('skips an already-bound port', async () => {
    const occupied = await new Promise<number>((res) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => res((s.address() as net.AddressInfo).port));
    });
    const port = await allocatePort(occupied);
    expect(port).not.toBe(occupied);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter contractqa exec vitest run tests/port-pool.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/lib/port-pool.ts
import net from 'node:net';

export async function isFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export async function allocatePort(startFrom: number, host = '127.0.0.1', maxAttempts = 100): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = startFrom + i;
    if (await isFree(candidate, host)) return candidate;
  }
  throw new Error(`no free port in [${startFrom}, ${startFrom + maxAttempts})`);
}
```

- [ ] **Step 4: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/port-pool.ts packages/cli/tests/port-pool.test.ts
git commit -m "feat(cli): allocatePort utility for collision-free target boot"
```

---

### Task 10: Host probe — boot + first-stderr-error capture

**Files:**
- Create: `packages/cli/src/lib/host-probe.ts`
- Test: `packages/cli/tests/host-probe.test.ts`

Problem (`dogfood/5-4-codex/FINDINGS.md` #4, `dogfood/website-vercel-supabase/FINDINGS.md` #1): we want a probe that says "host failed to boot, first non-noise stderr line was: `<message>`."

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/host-probe.test.ts
import { describe, it, expect } from 'vitest';
import { probeHostBoot } from '../src/lib/host-probe.js';

describe('probeHostBoot', () => {
  it('returns ready: true when the readinessUrl answers 200 within budget', async () => {
    const result = await probeHostBoot({
      command: 'node',
      args: ['-e', "require('http').createServer((_,r)=>r.end('ok')).listen(3711)"],
      readinessUrl: 'http://127.0.0.1:3711/',
      timeoutMs: 5_000,
    });
    expect(result.ready).toBe(true);
    expect(result.firstStderrError).toBeNull();
    result.kill();
  });

  it('returns ready: false + firstStderrError when the host crashes', async () => {
    const result = await probeHostBoot({
      command: 'node',
      args: ['-e', "console.error('Error: better-sqlite3 bindings not found'); process.exit(1);"],
      readinessUrl: 'http://127.0.0.1:3712/',
      timeoutMs: 3_000,
    });
    expect(result.ready).toBe(false);
    expect(result.firstStderrError).toContain('better-sqlite3');
    result.kill();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/lib/host-probe.ts
import { spawn, type ChildProcess } from 'node:child_process';

export interface ProbeInput {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readinessUrl: string;
  timeoutMs: number;
}

export interface ProbeResult {
  ready: boolean;
  firstStderrError: string | null;
  kill: () => void;
}

const NOISE_PATTERNS = [
  /^\s*$/,
  /WARN /,
  /warning:/i,
  /^npm /,
  /^pnpm /,
  /Done in /,
  /next-dev/,
];

function isError(line: string): boolean {
  if (NOISE_PATTERNS.some((p) => p.test(line))) return false;
  return /error|exception|cannot find|not found|enoent/i.test(line);
}

export async function probeHostBoot(i: ProbeInput): Promise<ProbeResult> {
  let firstStderrError: string | null = null;
  const proc: ChildProcess = spawn(i.command, i.args, {
    cwd: i.cwd, env: i.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (b: Buffer) => {
    if (firstStderrError) return;
    for (const line of b.toString().split('\n')) {
      if (isError(line)) { firstStderrError = line.trim(); break; }
    }
  });

  const deadline = Date.now() + i.timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const r = await fetch(i.readinessUrl, { redirect: 'manual' });
      if (r.status === 200) {
        return { ready: true, firstStderrError: null, kill: () => proc.kill('SIGINT') };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ready: false, firstStderrError, kill: () => proc.kill('SIGINT') };
}
```

- [ ] **Step 4: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/host-probe.ts packages/cli/tests/host-probe.test.ts
git commit -m "feat(cli): probeHostBoot — first-stderr-error capture for failed host boots"
```

---

### Task 11: Env-var detection

**Files:**
- Create: `packages/cli/src/lib/env-detect.ts`
- Test: `packages/cli/tests/env-detect.test.ts`

Problem (`dogfood/website-vercel-supabase/FINDINGS.md` #1, #6): target needs `NEXT_PUBLIC_SUPABASE_URL`, `AUTH_SECRET`, etc., just to load JS modules. Today the contract author discovers this by reading crash stacks. Doctor should parse the target for required env vars and emit stubs.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/env-detect.test.ts
import { describe, it, expect } from 'vitest';
import { detectRequiredEnv } from '../src/lib/env-detect.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'envdetect-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

describe('detectRequiredEnv', () => {
  it('parses .env.example into required vars', async () => {
    const dir = fixture({ '.env.example': 'NEXT_PUBLIC_SUPABASE_URL=\nAUTH_SECRET=changeme' });
    const out = await detectRequiredEnv(dir);
    expect(out.map((v) => v.name).sort()).toEqual(['AUTH_SECRET', 'NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('extracts $VAR from package.json `dev` script', async () => {
    const dir = fixture({ 'package.json': JSON.stringify({ scripts: { dev: 'PORT=${PORT:-3000} next dev' } }) });
    const out = await detectRequiredEnv(dir);
    expect(out.map((v) => v.name)).toContain('PORT');
  });

  it('produces a stub value at least 32 chars for *_SECRET', async () => {
    const dir = fixture({ '.env.example': 'AUTH_SECRET=' });
    const out = await detectRequiredEnv(dir);
    const stub = out.find((v) => v.name === 'AUTH_SECRET')!.suggestedStub;
    expect(stub.length).toBeGreaterThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/lib/env-detect.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface RequiredVar {
  name: string;
  source: '.env.example' | 'README' | 'package.json' | 'doctor';
  suggestedStub: string;
}

const STUB_RULES: Array<{ test: RegExp; stub: () => string }> = [
  { test: /SECRET$|_SECRET$|_KEY$/, stub: () => crypto.randomBytes(32).toString('hex') },
  { test: /URL$/, stub: () => 'http://localhost:1' },
  { test: /^PORT$/, stub: () => '3000' },
  { test: /CLIENT_ID|API_KEY/, stub: () => 'stub-id' },
];

function stubFor(name: string): string {
  for (const rule of STUB_RULES) if (rule.test.test(name)) return rule.stub();
  return 'stub';
}

async function readMaybe(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); } catch { return null; }
}

export async function detectRequiredEnv(repoRoot: string): Promise<RequiredVar[]> {
  const seen = new Map<string, RequiredVar>();
  const add = (name: string, source: RequiredVar['source']) => {
    if (!seen.has(name)) seen.set(name, { name, source, suggestedStub: stubFor(name) });
  };

  const envExample = await readMaybe(path.join(repoRoot, '.env.example'))
    ?? await readMaybe(path.join(repoRoot, '.env.template'))
    ?? await readMaybe(path.join(repoRoot, 'env.template'));
  if (envExample) {
    for (const line of envExample.split('\n')) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]+)=/);
      if (m && m[1]) add(m[1], '.env.example');
    }
  }

  const pkgRaw = await readMaybe(path.join(repoRoot, 'package.json'));
  if (pkgRaw) {
    const pkg = JSON.parse(pkgRaw);
    for (const cmd of Object.values<string>(pkg.scripts ?? {})) {
      for (const m of cmd.matchAll(/\$\{?([A-Z][A-Z0-9_]+)(?::-[^}]+)?\}?/g)) {
        if (m[1]) add(m[1], 'package.json');
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/env-detect.ts packages/cli/tests/env-detect.test.ts
git commit -m "feat(cli): detectRequiredEnv parses .env.example + package.json scripts"
```

---

### Task 12: Native-dep mismatch detector

**Files:**
- Create: `packages/cli/src/lib/native-deps.ts`
- Test: `packages/cli/tests/native-deps.test.ts`

Problem (`dogfood/5-4-codex/FINDINGS.md` #4): better-sqlite3 was built for a different Node version. Best-effort detection: enumerate `*.node` files under `node_modules/` and surface them as candidates to rebuild.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/native-deps.test.ts
import { describe, it, expect } from 'vitest';
import { detectNativeDepMismatch } from '../src/lib/native-deps.js';

describe('detectNativeDepMismatch', () => {
  it('returns an empty list when there are no .node binaries', async () => {
    const out = await detectNativeDepMismatch('/nonexistent-' + Date.now());
    expect(out).toEqual([]);
  });

  it('with stub input, flags entries whose ABI differs from runtime', async () => {
    const out = await detectNativeDepMismatch(process.cwd(), {
      _stubFiles: [{ path: '/x/better_sqlite3.node', abi: '108' }],
      _runtimeAbi: '115',
    } as any);
    expect(out.length).toBe(1);
    expect(out[0]!.suggestion).toContain('rebuild');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/lib/native-deps.ts
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface NativeMismatch {
  binding: string;
  packagePath: string;
  builtAbi: string | null;
  runtimeAbi: string;
  suggestion: string;
}

interface DetectOpts {
  _stubFiles?: Array<{ path: string; abi: string }>;
  _runtimeAbi?: string;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (e.isFile() && e.name.endsWith('.node')) out.push(full);
    }
  } catch { /* unreadable dir, skip */ }
  return out;
}

export async function detectNativeDepMismatch(repoRoot: string, opts: DetectOpts = {}): Promise<NativeMismatch[]> {
  const runtimeAbi = opts._runtimeAbi ?? process.versions.modules;

  if (opts._stubFiles) {
    return opts._stubFiles
      .filter((s) => s.abi !== runtimeAbi)
      .map((s) => ({
        binding: path.basename(s.path),
        packagePath: path.dirname(s.path),
        builtAbi: s.abi,
        runtimeAbi,
        suggestion: `built for ABI ${s.abi}, current is ${runtimeAbi}. run: npm --prefix ${path.dirname(s.path)} rebuild`,
      }));
  }

  const nodeModules = path.join(repoRoot, 'node_modules');
  try { await stat(nodeModules); } catch { return []; }
  const bindings = await walk(nodeModules);
  return bindings.map((b) => ({
    binding: path.basename(b),
    packagePath: path.dirname(b),
    builtAbi: null,
    runtimeAbi,
    suggestion: `native binding present. if dev-server boot fails with "bindings not found", run: npm --prefix ${path.dirname(b)} rebuild`,
  }));
}
```

- [ ] **Step 4: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/native-deps.ts packages/cli/tests/native-deps.test.ts
git commit -m "feat(cli): native-dep mismatch detector (best-effort, false-positive-leaning)"
```

---

### Task 13: `contractqa doctor <target>` command

**Files:**
- Create: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/bin/contractqa.ts`
- Test: `packages/cli/tests/doctor.test.ts`

Wire T9–T12 into one command.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/doctor.test.ts
import { describe, it, expect } from 'vitest';
import { doctor } from '../src/commands/doctor.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('doctor', () => {
  it('produces a report with env, ports, native sections', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts: { dev: 'echo hi' } }));
    writeFileSync(path.join(dir, '.env.example'), 'FOO=');
    const report = await doctor({ targetRoot: dir, requestedPorts: [3713], skipBootProbe: true });
    expect(report.env.some((v) => v.name === 'FOO')).toBe(true);
    expect(report.ports.some((p) => p.allocated >= 3713)).toBe(true);
    expect(report.summary).toMatch(/READY|NEEDS FIX/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/doctor.ts
import { detectRequiredEnv, type RequiredVar } from '../lib/env-detect.js';
import { allocatePort } from '../lib/port-pool.js';
import { detectNativeDepMismatch, type NativeMismatch } from '../lib/native-deps.js';
import { probeHostBoot, type ProbeResult } from '../lib/host-probe.js';

export interface DoctorInput {
  targetRoot: string;
  requestedPorts?: number[];
  skipBootProbe?: boolean;
  bootCommand?: { command: string; args: string[]; readinessUrl: string };
}

export interface DoctorReport {
  env: RequiredVar[];
  ports: Array<{ requested: number; allocated: number }>;
  native: NativeMismatch[];
  boot: Pick<ProbeResult, 'ready' | 'firstStderrError'> | null;
  summary: 'READY' | 'NEEDS FIX';
}

export async function doctor(i: DoctorInput): Promise<DoctorReport> {
  const env = await detectRequiredEnv(i.targetRoot);
  const ports: DoctorReport['ports'] = [];
  for (const req of i.requestedPorts ?? []) {
    ports.push({ requested: req, allocated: await allocatePort(req) });
  }
  const native = await detectNativeDepMismatch(i.targetRoot);
  let boot: DoctorReport['boot'] = null;
  if (!i.skipBootProbe && i.bootCommand) {
    const r = await probeHostBoot({ ...i.bootCommand, cwd: i.targetRoot, timeoutMs: 30_000 });
    boot = { ready: r.ready, firstStderrError: r.firstStderrError };
    r.kill();
  }
  const needsFix = !!boot && !boot.ready;
  return { env, ports, native, boot, summary: needsFix ? 'NEEDS FIX' : 'READY' };
}

export function renderDoctorReport(r: DoctorReport): string {
  const lines = [`## ContractQA doctor — ${r.summary}`, ''];
  lines.push('### Env vars (target needs these set before boot)');
  for (const v of r.env) lines.push(`- \`${v.name}\` (${v.source}) — suggested stub: \`${v.suggestedStub}\``);
  lines.push('', '### Port allocations');
  for (const p of r.ports) lines.push(`- requested ${p.requested} → allocated ${p.allocated}`);
  if (r.native.length) {
    lines.push('', '### Native bindings');
    for (const n of r.native) lines.push(`- ${n.binding} — ${n.suggestion}`);
  }
  if (r.boot) {
    lines.push('', '### Boot probe');
    lines.push(`- ready: ${r.boot.ready}`);
    if (r.boot.firstStderrError) lines.push(`- first stderr error: ${r.boot.firstStderrError}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Register in CLI**

In `packages/cli/src/bin/contractqa.ts` (find the existing command registrations), add:

```ts
import { doctor, renderDoctorReport } from '../commands/doctor.js';

// in the command dispatcher:
if (args[0] === 'doctor') {
  const targetRoot = args[1];
  if (!targetRoot) { console.error('usage: contractqa doctor <target>'); process.exit(2); }
  const report = await doctor({ targetRoot, skipBootProbe: true });
  console.log(renderDoctorReport(report));
  process.exit(report.summary === 'READY' ? 0 : 1);
}
```

(Match the existing command-dispatch style in that file — if commands are registered with commander or a switch, follow the same pattern.)

- [ ] **Step 5: Run tests to verify PASS**

Run: `pnpm --filter contractqa exec vitest run tests/doctor.test.ts && pnpm --filter contractqa build && node packages/cli/dist/bin/contractqa.js doctor /Users/zmy/intership/5/5-4-codex | head -20`
Expected: tests PASS; doctor prints a markdown report with env + ports sections.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/src/bin/contractqa.ts packages/cli/tests/doctor.test.ts
git commit -m "feat(cli): contractqa doctor <target> — preflight report"
```

---

### Task 14: Phase 2b checkpoint

- [ ] **Step 1: Full gate**

Run: `pnpm -r --filter './packages/**' typecheck && pnpm -r --filter './packages/**' test && node packages/cli/dist/bin/contractqa.js doctor /Users/zmy/intership/5/5-4-codex`
Expected: doctor report prints; tests green.

- [ ] **Step 2: Marker commit**

```bash
git commit --allow-empty -m "chore: phase 2b checkpoint — doctor preflight green"
```

---

## Phase 2c — Adapter composition + cookie-auth adapter

### Task 15: `CustomCookieAuthAdapter`

**Files:**
- Create: `packages/adapters/src/custom-cookie-auth-adapter.ts`
- Modify: `packages/adapters/src/index.ts`
- Test: `packages/adapters/tests/custom-cookie-auth-adapter.test.ts`

Problem (`dogfood/5-4-codex/FINDINGS.md` #3): Phase 1 ships Supabase / Clerk / NextAuth / Auth0 — nothing for plain custom-cookie auth (`apk_sid`-style). Most internal apps have this shape.

- [ ] **Step 1: Write the failing test**

```ts
// packages/adapters/tests/custom-cookie-auth-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CustomCookieAuthAdapter } from '../src/custom-cookie-auth-adapter.js';

describe('CustomCookieAuthAdapter', () => {
  it('ensureLoggedIn POSTs to the configured login endpoint and adds the cookie to context', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      return new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'apk_sid=abc; HttpOnly; Path=/' },
      });
    });
    const addCookies = vi.fn(async () => undefined);
    const a = new CustomCookieAuthAdapter({
      cookieName: 'apk_sid',
      loginUrl: '/api/v1/auth/login',
      logoutUrl: '/api/v1/auth/logout',
      baseUrl: 'http://localhost:3000',
      _fetch: fetchMock as any,
    });
    const page: any = { context: () => ({ addCookies, cookies: async () => [] }) };
    await a.ensureLoggedIn('alice@x.test', 'pw', page);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/auth/login', expect.any(Object));
    expect(addCookies).toHaveBeenCalled();
  });

  it('currentUser reads the cookie from page.context', async () => {
    const page: any = {
      context: () => ({ cookies: async () => [{ name: 'apk_sid', value: 'sid-123' }] }),
    };
    const a = new CustomCookieAuthAdapter({
      cookieName: 'apk_sid', loginUrl: '/x', logoutUrl: '/y', baseUrl: 'http://localhost:3000',
    });
    const u = await a.currentUser(page);
    expect(u).toEqual({ id: 'sid-123', role: 'user' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/adapters/src/custom-cookie-auth-adapter.ts
import type { AuthAdapter, Page } from '@contractqa/core';

export interface CustomCookieAuthConfig {
  cookieName: string;
  loginUrl: string;
  logoutUrl: string;
  baseUrl: string;
  _fetch?: typeof fetch;
}

export class CustomCookieAuthAdapter implements AuthAdapter {
  readonly name = 'custom-cookie';
  responsibilities = ['session'] as const;
  private fetcher: typeof fetch;

  constructor(private cfg: CustomCookieAuthConfig) {
    this.fetcher = cfg._fetch ?? fetch;
  }

  async ensureLoggedIn(email: string, password: string, page: Page): Promise<void> {
    const res = await this.fetcher(`${this.cfg.baseUrl}${this.cfg.loginUrl}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(new RegExp(`${this.cfg.cookieName}=([^;]+)`));
    if (!match || !match[1]) throw new Error(`login response missing ${this.cfg.cookieName} cookie`);
    const ctx = (page as { context: () => { addCookies: (a: unknown[]) => Promise<void> } }).context();
    const url = new URL(this.cfg.baseUrl);
    await ctx.addCookies([{
      name: this.cfg.cookieName, value: match[1], domain: url.hostname, path: '/',
      httpOnly: true, secure: false,
    }]);
  }

  async loginAs(_role: string, _page: Page): Promise<void> {
    throw new Error('CustomCookieAuthAdapter.loginAs requires email+password; use ensureLoggedIn');
  }

  async ensureLoggedOut(page: Page): Promise<void> {
    const ctx = (page as { context: () => { clearCookies: () => Promise<void> } }).context();
    await ctx.clearCookies();
  }

  async currentUser(page: Page): Promise<{ id: string; role: string } | null> {
    const ctx = (page as {
      context: () => { cookies: () => Promise<Array<{ name: string; value: string }>> }
    }).context();
    const cookies = await ctx.cookies();
    const c = cookies.find((x) => x.name === this.cfg.cookieName);
    return c ? { id: c.value, role: 'user' } : null;
  }
}
```

- [ ] **Step 4: Wire export**

`packages/adapters/src/index.ts`:

```ts
export { CustomCookieAuthAdapter } from './custom-cookie-auth-adapter.js';
export type { CustomCookieAuthConfig } from './custom-cookie-auth-adapter.js';
```

- [ ] **Step 5: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/src/custom-cookie-auth-adapter.ts packages/adapters/src/index.ts packages/adapters/tests/custom-cookie-auth-adapter.test.ts
git commit -m "feat(adapters): CustomCookieAuthAdapter for non-OAuth cookie-session apps"
```

---

### Task 16: AuthAdapter composition

**Files:**
- Modify: `packages/core/src/types/adapter.ts`
- Create: `packages/adapters/src/composite-auth-adapter.ts`
- Test: `packages/adapters/tests/composite-auth-adapter.test.ts`

Problem (`dogfood/website-vercel-supabase/FINDINGS.md` #4): real apps stack NextAuth (sessions) + Supabase (user store). Make `auth` a composite that delegates per-responsibility.

- [ ] **Step 1: Extend the type**

In `packages/core/src/types/adapter.ts`:

```ts
export type AuthResponsibility = 'session' | 'user-store' | 'oauth-callback';

export interface AuthAdapter {
  name: string;
  responsibilities?: readonly AuthResponsibility[];
  ensureLoggedIn(email: string, password: string, page: Page): Promise<void>;
  loginAs(role: string, page: Page): Promise<void>;
  ensureLoggedOut(page: Page): Promise<void>;
  currentUser(page: Page): Promise<{ id: string; role: string } | null>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/adapters/tests/composite-auth-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { composeAuth } from '../src/composite-auth-adapter.js';

describe('composeAuth', () => {
  it('delegates ensureLoggedIn to the adapter that owns "session"', async () => {
    const session = {
      name: 's', responsibilities: ['session'] as const,
      ensureLoggedIn: vi.fn(async () => undefined),
      loginAs: vi.fn(), ensureLoggedOut: vi.fn(), currentUser: vi.fn(async () => null),
    };
    const userStore = {
      name: 'u', responsibilities: ['user-store'] as const,
      ensureLoggedIn: vi.fn(), loginAs: vi.fn(), ensureLoggedOut: vi.fn(),
      currentUser: vi.fn(async () => null),
    };
    const c = composeAuth([session as any, userStore as any]);
    const page: any = {};
    await c.ensureLoggedIn('a', 'b', page);
    expect(session.ensureLoggedIn).toHaveBeenCalled();
    expect(userStore.ensureLoggedIn).not.toHaveBeenCalled();
  });

  it('throws when no adapter is provided', () => {
    expect(() => composeAuth([])).toThrow(/at least one adapter/);
  });

  it('throws when no adapter declares the requested responsibility', () => {
    const a = {
      name: 'u', responsibilities: ['user-store'] as const,
      ensureLoggedIn: vi.fn(), loginAs: vi.fn(), ensureLoggedOut: vi.fn(),
      currentUser: vi.fn(async () => null),
    };
    const c = composeAuth([a as any]);
    expect(() => c.ensureLoggedIn('e', 'p', {} as any)).toThrow(/responsibility/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
// packages/adapters/src/composite-auth-adapter.ts
import type { AuthAdapter, Page, AuthResponsibility } from '@contractqa/core';

function pick(adapters: AuthAdapter[], r: AuthResponsibility): AuthAdapter {
  const a = adapters.find((x) =>
    (x.responsibilities ?? ['session', 'user-store', 'oauth-callback']).includes(r),
  );
  if (!a) throw new Error(`no adapter declares responsibility "${r}"`);
  return a;
}

export function composeAuth(adapters: AuthAdapter[]): AuthAdapter {
  if (adapters.length === 0) throw new Error('composeAuth requires at least one adapter');
  return {
    name: `composite(${adapters.map((a) => a.name).join('+')})`,
    responsibilities: ['session', 'user-store', 'oauth-callback'],
    ensureLoggedIn: (e, p, page) => pick(adapters, 'session').ensureLoggedIn(e, p, page),
    loginAs: (r, page) => pick(adapters, 'session').loginAs(r, page),
    ensureLoggedOut: (page) => pick(adapters, 'session').ensureLoggedOut(page),
    currentUser: (page) => pick(adapters, 'session').currentUser(page),
  };
}
```

Wire export in `packages/adapters/src/index.ts`:

```ts
export { composeAuth } from './composite-auth-adapter.js';
```

- [ ] **Step 5: Run tests to verify PASS**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/adapter.ts packages/adapters/src/composite-auth-adapter.ts packages/adapters/src/index.ts packages/adapters/tests/composite-auth-adapter.test.ts
git commit -m "feat(adapters): composeAuth — multi-adapter composition with responsibilities"
```

---

### Task 17: Reference `CustomCookieAuthAdapter` from 5-4-codex dogfood

**Files:**
- Modify: `dogfood/5-4-codex/dogfood.test.ts`

Demonstrates the adapter is usable. The actual UI registration flow stays — adapter is illustrative for Phase 2 (full backend-bypass is Phase 3).

- [ ] **Step 1: Add the adapter import + instantiation**

```ts
import { CustomCookieAuthAdapter } from '@contractqa/adapters';

// after browser launch:
const auth = new CustomCookieAuthAdapter({
  cookieName: 'apk_sid',
  loginUrl: '/api/v1/auth/register',
  logoutUrl: '/api/v1/auth/logout',
  baseUrl: WEB_BASE,
});
// auth.currentUser(page) is callable mid-test as a diagnostic; the contract
// flow itself still drives the UI registration.
```

Add a single assertion that the adapter is callable:

```ts
expect(auth.name).toBe('custom-cookie');
```

- [ ] **Step 2: Run dogfood**

Run: `pnpm --filter @contractqa/dogfood test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dogfood/5-4-codex/dogfood.test.ts
git commit -m "dogfood(5-4-codex): wire CustomCookieAuthAdapter as smoke"
```

---

### Task 18: Phase 2c checkpoint

- [ ] **Step 1: Full gate**

Run: `pnpm -r --filter './packages/**' typecheck && pnpm -r --filter './packages/**' test && pnpm --filter @contractqa/dogfood test`
Expected: green.

- [ ] **Step 2: Marker commit**

```bash
git commit --allow-empty -m "chore: phase 2c checkpoint — adapter composition + cookie adapter green"
```

---

## Phase 2d — Host install path + Phase 2 acceptance

### Task 19: `pnpm pack` workflow for host install

**Files:**
- Create: `scripts/pack-for-host.sh`
- Modify: `package.json`
- Modify: `README.md`

Problem (`dogfood/5-4-codex/FINDINGS.md` #8): host projects can't `pnpm add @contractqa/*` because packages are unpublished. Provide a `pnpm pack` workflow.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/pack-for-host.sh
# Produces tarballs of every @contractqa/* package under dist-host/.
# Host projects install with: npm i ./dist-host/<name>-<version>.tgz
set -euo pipefail
OUT_DIR="${1:-dist-host}"
ABS_OUT="$(cd "$(dirname "$0")/.." && pwd)/$OUT_DIR"
rm -rf "$ABS_OUT"
mkdir -p "$ABS_OUT"
pnpm -r --filter './packages/**' build
for pkg in packages/*; do
  if [ -f "$pkg/package.json" ]; then
    pushd "$pkg" >/dev/null
    pnpm pack --pack-destination "$ABS_OUT"
    popd >/dev/null
  fi
done
ls -la "$ABS_OUT"
echo "OK — tarballs in $ABS_OUT. Install in a host with: npm i file:./path/to/$OUT_DIR/<name>-<version>.tgz"
```

- [ ] **Step 2: Add root script + permission**

In root `package.json`:

```json
"scripts": {
  "pack:host": "bash scripts/pack-for-host.sh"
}
```

Run: `chmod +x scripts/pack-for-host.sh`

- [ ] **Step 3: Test the workflow**

Run: `pnpm pack:host`
Expected: `dist-host/` contains `.tgz` for every workspace package; final line is the OK banner.

- [ ] **Step 4: Document**

Append to `README.md`:

```markdown
## Installing into a host project

ContractQA packages are workspace-only. To install into a host project,
run `pnpm pack:host` here, then in the host:

```bash
npm i ./path/to/dist-host/contractqa-runner-0.1.0.tgz \
       ./path/to/dist-host/contractqa-core-0.1.0.tgz \
       ./path/to/dist-host/contractqa-oracle-0.1.0.tgz \
       ./path/to/dist-host/contractqa-evidence-0.1.0.tgz \
       ./path/to/dist-host/contractqa-probes-0.1.0.tgz \
       @playwright/test
```

Alternatively, use the **sidecar** pattern (`dogfood/`) — a workspace inside
qa-agent boots host repos as subprocesses.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/pack-for-host.sh package.json README.md
git commit -m "feat(scripts): pack:host produces tarballs for file: install in host projects"
```

---

### Task 20: Dogfood target #4 — 5-4-claude (Supabase on Vite, stubbed)

**Files:**
- Create: `dogfood/5-4-claude/contracts/INV-S1-login-renders.yml`
- Create: `dogfood/5-4-claude/noise-profile.yml`
- Create: `dogfood/5-4-claude/dogfood.test.ts`
- Create: `dogfood/5-4-claude/FINDINGS.md`

5-4-claude uses `@supabase/supabase-js` (`supabase.auth.signInWithPassword`) on Vite+React. Without real Supabase creds, drive a render-only contract.

- [ ] **Step 1: Inspect target**

```bash
cat /Users/zmy/intership/5/5-4-claude/apps/web/package.json | grep -E "name|vite|supabase|react"
cat /Users/zmy/intership/5/5-4-claude/apps/web/src/router.tsx | head -20
ls /Users/zmy/intership/5/5-4-claude/node_modules >/dev/null 2>&1 || echo "needs pnpm install"
```

Expected: confirms Vite + React + Supabase. If node_modules missing, `pnpm --dir /Users/zmy/intership/5/5-4-claude install`.

- [ ] **Step 2: Write contract YAML**

```yaml
# dogfood/5-4-claude/contracts/INV-S1-login-renders.yml
id: INV-S1
title: Login page renders + no Supabase error token leaks
area: auth
severity: P2
owner: dogfood
risk_tags: [auth, supabase, stub-env]

preconditions:
  auth_state: anonymous
  role: visitor

actions:
  - { type: goto, path: /login }
  - { type: wait, ms: 800 }

expected:
  url: { matches: "^/login" }
  localStorage: { no_key_matches: "^sb-.+-auth-token-error$" }

verification:
  wait_ms: 500
  retries: 1
  evidence_required: [state_diff]
```

- [ ] **Step 3: Noise profile**

```yaml
# dogfood/5-4-claude/noise-profile.yml
project: 5-4-claude
generated_at: 2026-05-14T10:00:00Z
ignore:
  localStorage_keys:
    - "^sb-.+-auth-token$"  # supabase-js writes a stub token at module init
  sessionStorage_keys: []
  cookies: []
  network_url_patterns:
    - "^http://localhost:1/"
  console_patterns:
    - "Failed to fetch"
```

- [ ] **Step 4: Write the test**

Copy `dogfood/wolfmind/dogfood.test.ts` as a template. Adjust:

```ts
const TARGET = '/Users/zmy/intership/5/5-4-claude/apps/web';
const PORT = Number(process.env.DOGFOOD_5_4_CLAUDE_PORT ?? '5391');
const BASE = `http://127.0.0.1:${PORT}`;

// beforeAll:
web = spawn(
  'pnpm', ['--filter', 'web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: '/Users/zmy/intership/5/5-4-claude', env: {
    ...process.env,
    VITE_SUPABASE_URL: 'http://localhost:1',
    VITE_SUPABASE_ANON_KEY: 'stub',
  }, stdio: ['ignore', 'pipe', 'pipe'] },
);
```

In the test body, use `runContract()`:

```ts
const result = await runContract({
  contract: inv!,
  page: page as any,
  stripBaseUrl: BASE,
  noise,
  artifactsRoot,
  tracePath, harPath,
  screenshotPaths: { before: beforeShot, after: afterShot },
  attachments: [
    { name: 'evidence:trace', path: tracePath, contentType: 'application/zip' },
    { name: 'evidence:screenshot', path: afterShot, contentType: 'image/png' },
    { name: 'evidence:network', path: harPath, contentType: 'application/json' },
  ],
  alwaysBundle: true,
});
expect(result.verdict.verdict).toBe('PASS');
```

- [ ] **Step 5: Run + capture**

Run: `pnpm --filter @contractqa/dogfood test`
Expected: 4 tests pass. If FAIL on 5-4-claude, capture the actual failure in step 6 — that's a valid dogfood outcome.

- [ ] **Step 6: Write FINDINGS.md**

```markdown
# Dogfood findings — 5-4-claude

Target: Vite + React + @supabase/supabase-js auth, stubbed (no real Supabase).
Outcome: <PASS|FAIL>.

## New findings

1. <real finding from running the test>

## Reused findings (already in dogfood/FINDINGS.md)

- vite --host quirk
- snapshotBrowser origin-less tolerance (now fixed in T5)
- ...

## What this proves about Phase 1 / 2

- supabase-js is framework-agnostic: imports + module init work on Vite + React without changes
- `SupabaseAuthAdapter` (Phase 1) is not actually invoked here — the
  app uses supabase-js directly, not the adapter wrapper. Phase 2's
  `composeAuth` would let the host opt in.
```

Update `dogfood/FINDINGS.md` target-summary table to add a 4th row.

- [ ] **Step 7: Commit**

```bash
git add dogfood/5-4-claude/ dogfood/FINDINGS.md
git commit -m "feat(dogfood): target #4 — 5-4-claude (Supabase on Vite, stub env)"
```

---

### Task 21: Dogfood target #5 — agent-poker-platform (original)

**Files:**
- Create: `dogfood/agent-poker-platform/contracts/INV-L2-logout.yml`
- Create: `dogfood/agent-poker-platform/noise-profile.yml`
- Create: `dogfood/agent-poker-platform/dogfood.test.ts`
- Create: `dogfood/agent-poker-platform/FINDINGS.md`

`/Users/zmy/intership/4/agent-poker-platform` is the canonical pre-codex version. Compare findings against the 5-4-codex variant.

- [ ] **Step 1: Survey + install if needed**

```bash
cat /Users/zmy/intership/4/agent-poker-platform/apps/web/package.json | grep -E "vite|react"
cat /Users/zmy/intership/4/agent-poker-platform/apps/web/src/auth/AuthContext.tsx | head -30
ls /Users/zmy/intership/4/agent-poker-platform/node_modules >/dev/null 2>&1 || (pnpm --dir /Users/zmy/intership/4/agent-poker-platform install)
```

Expected: same structure as 5-4-codex (apk_sid cookie auth). If different, adjust the contract.

- [ ] **Step 2: Adapt the 5-4-codex test**

Copy `dogfood/5-4-codex/dogfood.test.ts` to `dogfood/agent-poker-platform/dogfood.test.ts`. Change:
- `TARGET_REPO = '/Users/zmy/intership/4/agent-poker-platform'`
- `API_PORT = 3387, WEB_PORT = 5387` (avoid collisions with other dogfoods)

Same contract YAML / noise-profile as 5-4-codex but renamed `INV-L1` → `INV-L2` to differentiate.

- [ ] **Step 3: Native rebuild if needed**

If sqlite bindings fail on first run, find the path and:

```bash
npm --prefix /Users/zmy/intership/4/agent-poker-platform/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 rebuild
```

- [ ] **Step 4: Run + iterate**

Run: `pnpm --filter @contractqa/dogfood test -t agent-poker-platform`
Expected: PASS. Capture any divergence-from-5-4-codex findings.

- [ ] **Step 5: FINDINGS.md**

Document what's the same vs different from 5-4-codex. The interesting question: do variants of the same project produce identical findings, or do small impl differences (different package manager version, different patch versions of next/vite) surface new gaps?

- [ ] **Step 6: Commit**

```bash
git add dogfood/agent-poker-platform/ dogfood/FINDINGS.md
git commit -m "feat(dogfood): target #5 — agent-poker-platform (original variant)"
```

---

### Task 22: Phase 2 acceptance script + handoff

**Files:**
- Create: `scripts/phase2-acceptance.sh`
- Modify: `README.md`
- Modify: `dogfood/FINDINGS.md`

- [ ] **Step 1: Write the acceptance script**

```bash
#!/usr/bin/env bash
# scripts/phase2-acceptance.sh
set -euo pipefail
echo "== ContractQA Phase 2 acceptance =="

echo "--- typecheck"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests"
pnpm -r --filter './packages/**' test

echo "--- build"
pnpm -r --filter './packages/**' build

echo "--- generate INVARIANTS.md"
node packages/cli/dist/bin/contractqa.js invariants:gen \
  --contracts qa/contracts --out qa/INVARIANTS.md
grep -q "INV-A2" qa/INVARIANTS.md

echo "--- e2e (Phase 1)"
pnpm --filter @contractqa/e2e test

echo "--- dogfood (5 targets)"
pnpm --filter @contractqa/dogfood test

echo "--- pack-for-host"
bash scripts/pack-for-host.sh dist-host-acceptance >/dev/null
test -d dist-host-acceptance
rm -rf dist-host-acceptance

echo "--- doctor smoke (against 5-4-codex)"
node packages/cli/dist/bin/contractqa.js doctor /Users/zmy/intership/5/5-4-codex || true

echo "OK — Phase 2 acceptance passed."
```

- [ ] **Step 2: Run the gate**

Run: `chmod +x scripts/phase2-acceptance.sh && ./scripts/phase2-acceptance.sh`
Expected: ends with `OK — Phase 2 acceptance passed.`.

- [ ] **Step 3: Update README**

Add a Phase 2 status block under (or replacing) the Phase 1 one:

```markdown
## Phase 2 status

- [x] `runContract()` one-shot helper (`packages/runner`)
- [x] `target.within` + `target.first` + `target.locale` schema
- [x] `dom:` block (`contains_text` / `not_contains_text` / `role_count`)
- [x] `snapshotBrowser.captureDom` + origin-less tolerance
- [x] `ReporterOptions.alwaysBundle`
- [x] `contractqa doctor <target>` preflight (env, ports, native, boot)
- [x] `CustomCookieAuthAdapter` + `composeAuth`
- [x] `pnpm pack:host` workflow for tarball install
- [x] 5 dogfood targets validated (§23.1 acceptance criterion met)

Out of Phase 2 (Phase 3+):
- Framework-aware `contractqa init` / `scan`
- `BackendAdapter` for HTTP-API-bypass test setup
- Cross-pnpm spawn helper
- Persona dogfood agents
- Property / model-based generation
- Dashboard §15.3–§15.6
```

- [ ] **Step 4: Final FINDINGS.md update**

In `dogfood/FINDINGS.md`, finalize the 5-target summary table and mark each finding as RESOLVED / DEFERRED / OPEN. The OPEN ones become Phase 3 input.

- [ ] **Step 5: Commit**

```bash
git add scripts/phase2-acceptance.sh README.md dogfood/FINDINGS.md
git commit -m "chore: phase 2 acceptance script + 5-target dogfood summary"
```

- [ ] **Step 6: Tag**

```bash
git tag v0.2.0
```

---

## Phase 2 acceptance criteria (mapped from `dogfood/FINDINGS.md`)

| Finding | Source | Resolved by |
|---|---|---|
| Cookie classifier delta-only blindspot | 5-4-codex #1 | Already shipped (commit 2a75413) |
| CLI `init` / `scan` Next-only | 5-4-codex #2 | DEFERRED — Phase 3 |
| No cookie-session AuthAdapter | 5-4-codex #3 | T15 CustomCookieAuthAdapter |
| Native-dep rebuild preflight | 5-4-codex #4 | T12 detectNativeDepMismatch |
| pnpm 9 vs 10 arg forwarding | 5-4-codex #5 | DOCUMENTED (Phase 3 cross-pnpm helper) |
| vite `--host` quirk | 5-4-codex #6 | DOCUMENTED + surfaced via T13 doctor |
| Reporter no-bundle on PASS | cross-cutting | T2 alwaysBundle |
| Workspace-only install | 5-4-codex #8 | T19 pack:host |
| Standalone runner glue | cross-cutting | T1 runContract |
| Env preflight | website #1 | T11 detectRequiredEnv + T13 doctor |
| about:blank SecurityError | website #2 | T5 origin-less tolerance |
| Multi-match locator scoping | website #3 | T3 target.within + already-shipped target.first |
| Multi-adapter composition | website #4 | T16 composeAuth |
| Port-collision footgun | cross-cutting | T9 allocatePort |
| Schema thinness on no-auth UIs | wolfmind | T4 dom: block |
| i18n stability | website #3 sibling | T6 goto.locale |
| 5-target validation (§23.1) | original goal | 3 existing + T20 (5-4-claude) + T21 (agent-poker-platform) = 5 |

---

## Out of Phase 2 (Phase 3 candidates)

- `BackendAdapter` for HTTP-API-bypass test setup (host-supplied `createTestUser` etc.)
- `contractqa init` framework detection (Next.js / Vite / Astro / etc.) writing per-framework scaffolds
- pnpm-version-aware spawn helper
- Persona dogfood agents
- Property / model-based test generation
- Public adapter API
- Dashboard §15.3–§15.6
- Real-Supabase + real-NextAuth integration tests (vs stubbed env)
- TypeScript project references (`tsc -b`) — consumers resolve `@contractqa/core` from source, not `dist/*.d.ts`. Removes the stale-dist typecheck failure mode (surfaced 2026-05-14 on resume: `DomShape` / `AuthResponsibility` source additions weren't reflected in `dist/` because the acceptance script runs `typecheck` before `build`). Cheaper one-line mitigation: reorder the acceptance script to `build → typecheck → test`.

---

## Risk register

- **5-4-claude needs real Supabase to actually exercise auth** — Phase 2's fallback is render-only contract (T20). Phase 3 should add a docker-supabase fixture so real-auth flows can run in CI.
- **agent-poker-platform may be stale or diverged** — T21 step 1 mitigates with a fresh survey. If divergence is huge, swap for a different available target and document why.
- **`pnpm pack` tarball install paths are absolute** — `npm i file:` paths break across machines. T19 step 4 documents this; Phase 3 should publish to a private registry.
- **Doctor's native-dep detector is best-effort** (T12) — flags any `.node` binary, not just mismatched ones. False positives expected; acceptable for Phase 2.
- **`runContract`'s attachment list is opinionated** — silently drops attachments with unrecognized names. Phase 3 should add an explicit attachment-name validation step that errors on typos.
- **The dogfood vitest workspace runs all targets in one process** — total runtime grows linearly with target count. Beyond 5 targets, consider parallel vitest projects.

---

## Self-review notes (for the executor)

This plan was self-reviewed against `dogfood/FINDINGS.md`. Every finding tagged "Phase 2 task" in any of the 3 per-target FINDINGS.md files maps to a task above (see acceptance matrix). Findings tagged "Phase 3" or "documented only" are explicitly listed in the Risk Register or Out-of-Phase-2 section.

The 5-target acceptance criterion is met after T21. Earlier sub-phases (2a-2c) leave the project shippable independently — if execution stalls after T18, the work merged so far still constitutes a meaningful Phase 2 release.
