# ContractQA Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 deliverable from `claude_code_qa_agent_design.md` §23.1 — a contract-driven web QA platform that turns YAML invariants into Playwright tests, captures full browser/state evidence on failure, generates minimal repros, hands them to Claude Code for shadow-fix in an isolated worktree, and renders runs + issues on a Next.js dashboard. Reference target: the §24 Logout Bug case study runs end-to-end on a fixture Next.js + Supabase app.

**Architecture:** pnpm monorepo. Core engine = TypeScript packages (`@contractqa/*`) composed on top of Playwright Test (per §9.0 — Playwright Test is the runner base, ContractQA contributes a custom test loader for contract YAML and a reporter that emits evidence bundles). Adapters decouple contracts from provider specifics (§7.6). Dashboard = standalone Next.js app reading from local artifact store (S3-compatible) and a Postgres metadata DB. Claude Code orchestration runs in the §17.0.2 Shadow Fix Pipeline — never on the critical path.

**Tech Stack:** TypeScript 5, pnpm workspaces, Playwright Test 1.49+, Zod 3, Vitest 2, Next.js 15 (App Router), Postgres 16 + Drizzle ORM, MinIO (S3-compatible local), Claude Code CLI (headless `--bare -p`), Supabase / Clerk / NextAuth / Auth0 SDKs for adapters.

**Scope discipline:**
- In: §23.1 Phase 1 bullets, §15.1 Run Overview + §15.2 Issue Detail dashboard pages, dual-pipeline §17.0 (critical-path gate + shadow fix).
- Out (Phase 2+): BackendAdapter (L2), Persona Dogfood, Property/Model-based, Dashboard §15.3–§15.6, OpenClaw integration, open Adapter API.

**Sub-phase split** (each leaves a shippable artifact, natural review boundary):
- **Phase 1a** — Foundations (T1–T11): repo bootstrap, core types, contract schema, INVARIANTS.md generator, AppAdapter + 4 AuthAdapter providers.
- **Phase 1b** — Runner / Oracle (T12–T20): browser snapshot, noise profile, state diff, 4-state oracle, evidence bundle, S3 upload, PW custom test loader, PW reporter, repro generator.
- **Phase 1c** — Orchestrator / Dashboard / E2E (T21–T29): CLI, Claude Code shadow-fix orchestrator, Next.js dashboard, fixture app, end-to-end §24 case-study verification, Phase 1 acceptance dry-run.

---

## File Structure (locked before tasks start)

```
qa-agent/                                         # repo root, will `git init`
├── package.json                                   # pnpm workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── vitest.config.ts                               # shared Vitest config
├── playwright.config.ts                           # consumed by fixture app + e2e
├── packages/
│   ├── core/                                      # @contractqa/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types/
│   │   │   │   ├── contract.ts                    # ContractDoc, ExpectedBlock
│   │   │   │   ├── snapshot.ts                    # BrowserSnapshot, BackendSnapshot
│   │   │   │   ├── verdict.ts                     # Verdict = PASS|FAIL|FLAKY|INCONCLUSIVE
│   │   │   │   ├── evidence.ts                    # EvidenceBundleManifest, IssueJson
│   │   │   │   └── adapter.ts                     # AppAdapter, AuthAdapter, BackendAdapter
│   │   │   └── schemas/
│   │   │       ├── contract.schema.ts             # Zod schemas
│   │   │       ├── noise-profile.schema.ts
│   │   │       └── safe-regex.ts                  # ReDoS protection helper
│   │   └── tests/
│   ├── adapters/                                  # @contractqa/adapters
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── app/default.ts                     # DefaultAppAdapter
│   │   │   ├── auth/
│   │   │   │   ├── supabase.ts
│   │   │   │   ├── clerk.ts
│   │   │   │   ├── next-auth.ts
│   │   │   │   └── auth0.ts
│   │   │   └── registry.ts                        # provider lookup
│   │   └── tests/
│   ├── probes/                                    # @contractqa/probes
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── browser-snapshot.ts                # takes a Playwright Page
│   │   │   ├── console.ts
│   │   │   ├── network.ts
│   │   │   ├── websocket.ts
│   │   │   ├── redaction.ts                       # §8.4 rules
│   │   │   └── noise-profile.ts                   # §8.5 idle baseline
│   │   └── tests/
│   ├── oracle/                                    # @contractqa/oracle
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── state-diff.ts                      # §8.3
│   │   │   ├── declared-fields.ts                 # §8.5.1 classifier
│   │   │   ├── verdict.ts                         # 4-state, §9.2
│   │   │   └── confidence.ts                      # §9.3 score
│   │   └── tests/
│   ├── evidence/                                  # @contractqa/evidence
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── bundle.ts                          # §11.1 layout writer
│   │   │   ├── manifest.ts                        # manifest.json
│   │   │   ├── issue-json.ts                      # §11.2 schema writer
│   │   │   └── s3-upload.ts                       # MinIO/S3 client
│   │   └── tests/
│   ├── runner/                                    # @contractqa/runner
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── loader.ts                          # YAML contract → PW test
│   │   │   ├── verified-action.ts                 # §9.1 wrapper
│   │   │   ├── reporter.ts                        # custom PW reporter
│   │   │   └── config.ts                          # contractqa.config.ts loader
│   │   └── tests/
│   ├── repro/                                     # @contractqa/repro
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── generator.ts                       # contract+evidence → spec.ts
│   │   │   └── stabilizer.ts                      # 2/3 reproducer guard
│   │   └── tests/
│   ├── orchestrator/                              # @contractqa/orchestrator
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── claude-code.ts                     # spawn claude --bare -p
│   │   │   ├── worktree.ts                        # git worktree isolation
│   │   │   ├── fix-loop.ts                        # maxFixAttempts=3
│   │   │   └── shadow-pipeline.ts                 # §17.0.2 entrypoint
│   │   └── tests/
│   └── cli/                                       # contractqa CLI
│       ├── package.json
│       ├── bin/contractqa.ts
│       └── src/commands/
│           ├── init.ts
│           ├── scan.ts
│           ├── run.ts
│           ├── repro.ts
│           ├── fix.ts
│           └── invariants-gen.ts                  # YAML → INVARIANTS.md
├── apps/
│   ├── dashboard/                                 # Next.js 15 dashboard
│   │   ├── package.json
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                           # redirect to /runs
│   │   │   ├── runs/page.tsx                      # §15.1 Run Overview
│   │   │   └── issues/[id]/page.tsx               # §15.2 Issue Detail
│   │   ├── lib/db.ts                              # Drizzle client
│   │   └── components/
│   │       ├── StateDiffViewer.tsx
│   │       └── EvidenceLinks.tsx
│   └── fixture-app/                               # Next.js + Supabase fixture for tests
│       ├── package.json
│       ├── app/
│       │   ├── login/page.tsx
│       │   ├── lobby/page.tsx
│       │   └── agents/page.tsx
│       └── lib/supabase.ts
├── qa/                                            # in-repo dogfood: contractqa tests itself
│   ├── INVARIANTS.md                              # generated from yml
│   ├── contracts/
│   │   ├── auth.yml                               # the §24 logout case
│   │   └── lobby.yml
│   ├── noise-profile.yml
│   └── adapters/
│       └── fixture-app.adapter.ts
├── e2e/
│   └── phase1-acceptance.spec.ts                  # end-to-end §24 walkthrough
├── docker/
│   ├── docker-compose.yml                         # postgres + minio for local dev
│   └── seed.sql                                   # dashboard schema
└── docs/superpowers/plans/
    └── 2026-05-14-contractqa-phase-1.md           # this file
```

**Boundary rules:**
- `core` exports types/schemas only — no I/O, no Playwright import.
- `adapters` imports `core` only.
- `probes`, `oracle` import `core` (+ Playwright `Page` for probes).
- `evidence` imports `core` + S3 client.
- `runner` imports everything above + `@playwright/test`.
- `orchestrator`, `cli`, `dashboard` are top-of-stack — they orchestrate, not implement.

---

## Tooling conventions (apply to every task)

- Test runner: **Vitest** for unit tests in `packages/*/tests`. **Playwright Test** for browser flows in `e2e/` and runner integration tests.
- Test file naming: `<module>.test.ts` for unit, `<flow>.spec.ts` for Playwright.
- Run a single unit test: `pnpm --filter @contractqa/<pkg> test -- <name>`.
- Run a single Playwright test: `pnpm exec playwright test e2e/<file>.spec.ts -g "<title>"`.
- Type check: `pnpm -r typecheck`.
- Lint: `pnpm -r lint`.
- Commit message style: Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- After every task: typecheck + lint + the new test must pass before commit.

---

# Phase 1a — Foundations

## Task 1: Repo bootstrap

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `vitest.config.ts`, `.nvmrc`, `README.md`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/zmy/intership/5.10+/qa-agent
git init
git branch -M main
```

- [ ] **Step 2: Write `.nvmrc`**

```
20.18.0
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 4: Write root `package.json`**

```json
{
  "name": "contractqa",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=20.18" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.16.0",
    "@typescript-eslint/parser": "^8.18.0",
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.4.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "packageManager": "pnpm@9.15.0"
}
```

- [ ] **Step 5: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    environment: 'node',
    coverage: { reporter: ['text', 'html'] },
  },
});
```

- [ ] **Step 7: Write `.eslintrc.cjs`, `.prettierrc`, `.gitignore`**

`.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', '.next', 'playwright-report', 'test-results'],
};
```

`.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

`.gitignore`:
```
node_modules
dist
.next
.turbo
coverage
playwright-report
test-results
artifacts
.env
.env.local
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` created, no errors.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: bootstrap pnpm monorepo with TS, ESLint, Prettier, Vitest"
```

---

## Task 2: Create `@contractqa/core` package skeleton

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/tests/smoke.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@contractqa/core', () => {
  it('exposes a VERSION string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@contractqa/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "eslint": "^9.16.0"
  },
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 4: Write minimal `src/index.ts`**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm --filter @contractqa/core test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): scaffold @contractqa/core with smoke test"
```

---

## Task 3: Contract YAML schema (Zod)

**Files:**
- Create: `packages/core/src/schemas/safe-regex.ts`, `packages/core/src/schemas/contract.schema.ts`, `packages/core/src/types/contract.ts`, `packages/core/tests/contract-schema.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/contract-schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ContractSchema } from '../src/schemas/contract.schema.js';

const valid = {
  id: 'INV-A2',
  title: 'Logged-out users cannot access protected routes',
  area: 'auth',
  severity: 'P0',
  preconditions: { auth_state: 'logged_in', role: 'normal_user' },
  actions: [
    { type: 'goto', path: '/lobby' },
    { type: 'click', target: { role: 'button', name_regex: 'logout' } },
    { type: 'goto', path: '/agents' },
  ],
  expected: {
    url: { matches: '^/login' },
    auth_state: { fully_logged_out: true },
  },
  verification: { wait_ms: 3000, retries: 2, evidence_required: ['state_diff', 'trace'] },
};

describe('ContractSchema', () => {
  it('parses a well-formed §7.2 contract', () => {
    const parsed = ContractSchema.parse(valid);
    expect(parsed.id).toBe('INV-A2');
    expect(parsed.severity).toBe('P0');
  });

  it('rejects missing id', () => {
    const { id, ...rest } = valid;
    expect(() => ContractSchema.parse(rest)).toThrow(/id/);
  });

  it('rejects invalid severity', () => {
    expect(() => ContractSchema.parse({ ...valid, severity: 'P5' })).toThrow();
  });

  it('rejects ReDoS-dangerous regex in name_regex', () => {
    const bad = {
      ...valid,
      actions: [{ type: 'click', target: { role: 'button', name_regex: '(a+)+$' } }],
    };
    expect(() => ContractSchema.parse(bad)).toThrow(/unsafe regex/i);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `pnpm --filter @contractqa/core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `safe-regex.ts`**

```ts
// Reject patterns with nested unbounded quantifiers (classic ReDoS shapes).
// Not exhaustive — pragmatic guard for user-authored YAML.
const DANGEROUS = [
  /\([^)]*[+*][^)]*\)[+*]/,   // (a+)+ or (a*)*
  /\([^)]*\|[^)]*\)[+*]/,     // (a|a)+
];

export function assertSafeRegex(source: string): void {
  if (DANGEROUS.some((d) => d.test(source))) {
    throw new Error(`unsafe regex: ${source}`);
  }
  try {
    new RegExp(source);
  } catch (e) {
    throw new Error(`invalid regex: ${source} (${(e as Error).message})`);
  }
}
```

- [ ] **Step 4: Implement `contract.schema.ts`**

```ts
import { z } from 'zod';
import { assertSafeRegex } from './safe-regex.js';

const SafeRegex = z.string().superRefine((v, ctx) => {
  try {
    assertSafeRegex(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
  }
});

const Target = z.object({
  role: z.string().optional(),
  name_regex: SafeRegex.optional(),
  test_id: z.string().optional(),
  text: z.string().optional(),
});

const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string() }),
  z.object({ type: z.literal('click'), target: Target }),
  z.object({ type: z.literal('fill'), target: Target, value: z.string() }),
  z.object({ type: z.literal('wait'), ms: z.number().int().nonnegative() }),
]);

const ExpectedBlock = z.object({
  url: z.object({ matches: SafeRegex }).partial().optional(),
  localStorage: z
    .object({
      no_key_matches: SafeRegex.optional(),
      has_key_matches: SafeRegex.optional(),
    })
    .optional(),
  sessionStorage: z
    .object({ no_key_matches: SafeRegex.optional() })
    .optional(),
  cookies: z.object({ no_name_matches: SafeRegex.optional() }).optional(),
  dom: z
    .object({
      not_contains_any: z.array(z.string()).optional(),
      contains_all: z.array(z.string()).optional(),
    })
    .optional(),
  auth_state: z.object({ fully_logged_out: z.boolean() }).partial().optional(),
  watch_keys: z
    .object({
      localStorage: z.array(SafeRegex).optional(),
      cookies: z.array(SafeRegex).optional(),
    })
    .optional(),
});

export const ContractSchema = z.object({
  id: z.string().regex(/^INV-[A-Z0-9-]+$/),
  title: z.string().min(1),
  area: z.string(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  owner: z.string().optional(),
  risk_tags: z.array(z.string()).default([]),
  preconditions: z
    .object({ auth_state: z.string().optional(), role: z.string().optional() })
    .default({}),
  actions: z.array(Action).min(1),
  expected: ExpectedBlock,
  verification: z
    .object({
      wait_ms: z.number().int().nonnegative().default(2000),
      retries: z.number().int().min(0).max(5).default(1),
      evidence_required: z
        .array(z.enum(['state_diff', 'trace', 'screenshot', 'console', 'network']))
        .default(['state_diff']),
    })
    .default({}),
});

export type ContractDoc = z.infer<typeof ContractSchema>;
```

- [ ] **Step 5: Export from `src/types/contract.ts` and `src/index.ts`**

`packages/core/src/types/contract.ts`:
```ts
export type { ContractDoc } from '../schemas/contract.schema.js';
```

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';
export { ContractSchema } from './schemas/contract.schema.js';
export type { ContractDoc } from './types/contract.ts';
```

- [ ] **Step 6: Run test, expect pass**

Run: `pnpm --filter @contractqa/core test`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): contract YAML Zod schema with ReDoS guard"
```

---

## Task 4: Snapshot, verdict, evidence, adapter types

**Files:**
- Create: `packages/core/src/types/snapshot.ts`, `verdict.ts`, `evidence.ts`, `adapter.ts`
- Modify: `packages/core/src/index.ts` to re-export.
- Test: `packages/core/tests/types-shape.test.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/types-shape.test.ts`:
```ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  BrowserSnapshot,
  Verdict,
  IssueJson,
  AuthAdapter,
  AppAdapter,
} from '../src/index.js';

describe('public type surface', () => {
  it('Verdict is one of four states', () => {
    expectTypeOf<Verdict>().toEqualTypeOf<'PASS' | 'FAIL' | 'FLAKY' | 'INCONCLUSIVE'>();
  });
  it('BrowserSnapshot has required fields', () => {
    expectTypeOf<BrowserSnapshot>().toHaveProperty('localStorage');
    expectTypeOf<BrowserSnapshot>().toHaveProperty('cookies');
    expectTypeOf<BrowserSnapshot>().toHaveProperty('console');
  });
  it('IssueJson matches §11.2', () => {
    expectTypeOf<IssueJson>().toHaveProperty('issue_id');
    expectTypeOf<IssueJson>().toHaveProperty('invariants');
    expectTypeOf<IssueJson>().toHaveProperty('confidence');
  });
  it('AuthAdapter exposes sessionKeyPatterns and expectFullyLoggedOut', () => {
    expectTypeOf<AuthAdapter>().toHaveProperty('sessionKeyPatterns');
    expectTypeOf<AuthAdapter>().toHaveProperty('expectFullyLoggedOut');
  });
  it('AppAdapter exposes resetState and seed', () => {
    expectTypeOf<AppAdapter>().toHaveProperty('resetState');
    expectTypeOf<AppAdapter>().toHaveProperty('seed');
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @contractqa/core test`
Expected: FAIL — types not exported.

- [ ] **Step 3: Write `snapshot.ts`** (matches §8.1)

```ts
export type Redacted = { __redacted: true };

export interface ConsoleEntry {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: string;
  location?: { url: string; lineNumber: number };
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  requestHeaders: Record<string, string | Redacted>;
  responseHeaders?: Record<string, string | Redacted>;
  timing: { startedAt: string; durationMs: number };
}

export interface WebSocketEntry {
  url: string;
  events: Array<{ kind: 'open' | 'message' | 'close'; payload?: string | Redacted; at: string }>;
}

export interface CookieSummary {
  name: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  valueRedacted: true;
}

export interface BrowserSnapshot {
  timestamp: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  screenshotPath: string;
  domTextHash: string;
  accessibilityTree?: unknown;
  localStorage: Record<string, string | Redacted>;
  sessionStorage: Record<string, string | Redacted>;
  cookies: CookieSummary[];
  console: ConsoleEntry[];
  network: NetworkEntry[];
  websocket: WebSocketEntry[];
}

export interface AuthStateAssertion {
  fullyLoggedOut: boolean;
  reasons: string[];
}
```

- [ ] **Step 4: Write `verdict.ts`** (matches §9.2, §9.3)

```ts
export type Verdict = 'PASS' | 'FAIL' | 'FLAKY' | 'INCONCLUSIVE';

export interface InvariantViolation {
  invariantId: string;
  message: string;
  expected: unknown;
  actual: unknown;
}

export interface VerdictResult {
  verdict: Verdict;
  violations: InvariantViolation[];
  confidence: number;
  reproductionRate: number;
  flakeScore: number;
  evidenceCompleteness: number;
  missingCapabilities: string[];
}
```

- [ ] **Step 5: Write `evidence.ts`** (matches §11.2)

```ts
export interface IssueJson {
  issue_id: string;
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  confidence: number;
  invariants: string[];
  environment: {
    branch: string;
    commit: string;
    base_url: string;
    browser: 'chromium' | 'firefox' | 'webkit';
  };
  steps: string[];
  expected: string[];
  actual: string[];
  artifacts: {
    trace: string;
    state_diff: string;
    repro: string;
    screenshot?: string;
    video?: string;
    console?: string;
    network?: string;
  };
  suggested_owner: string;
  fix_allowed: boolean;
  needs_human_contract_review?: boolean;
  proposed_contract_revision?: ProposedContractRevision;
}

export interface ProposedContractRevision {
  invariant_id: string;
  current_assertion: string;
  proposed_assertion: string;
  rationale: string;
  evidence: string[];
}

export interface EvidenceBundleManifest {
  bundle_id: string;
  created_at: string;
  contract_id: string;
  run_id: string;
  files: Array<{ path: string; sha256: string; bytes: number; kind: string }>;
  redaction_applied: boolean;
}
```

- [ ] **Step 6: Write `adapter.ts`** (matches §7.6.1, §7.6.2, §7.6.3)

```ts
import type { Page } from './page-shim.js';
import type { AuthStateAssertion } from './snapshot.js';

export type SeedProfile = 'minimal' | 'standard' | 'rich' | { name: string; fixtureDir: string };

export interface AppAdapter {
  baseUrl: string;
  startCommand?: string;
  healthCheckUrl: string;
  resetState(): Promise<void>;
  seed(profile: SeedProfile): Promise<void>;
}

export type AuthProviderName = 'supabase' | 'clerk' | 'next-auth' | 'auth0' | 'custom';

export interface SessionKeyPatterns {
  localStorage: RegExp[];
  sessionStorage: RegExp[];
  cookies: RegExp[];
}

export interface AuthAdapter {
  provider: AuthProviderName;
  loginAs(role: string, page: Page): Promise<void>;
  isAuthenticated(page: Page): Promise<boolean>;
  currentUser(page: Page): Promise<{ id: string; role: string } | null>;
  sessionKeyPatterns(): SessionKeyPatterns;
  expectFullyLoggedOut(page: Page): Promise<AuthStateAssertion>;
}

export interface BackendAdapter {
  kind: 'postgres' | 'mongo' | 'firestore' | 'custom';
  describe(): SchemaDescriptor;
  query(name: string, params: unknown): Promise<unknown>;
  authProviderState?(userId: string): Promise<{ sessionExists: boolean; userId?: string; role?: string }>;
}

export interface SchemaDescriptor {
  namedQueries: Array<{ name: string; description: string; params: Record<string, string> }>;
  tenantField: string | null;
}
```

`packages/core/src/types/page-shim.ts` (avoid Playwright dep in core):
```ts
export interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  context(): unknown;
}
```

- [ ] **Step 7: Re-export from `index.ts`**

```ts
export const VERSION = '0.1.0';
export { ContractSchema } from './schemas/contract.schema.js';
export type { ContractDoc } from './types/contract.js';
export type * from './types/snapshot.js';
export type * from './types/verdict.js';
export type * from './types/evidence.js';
export type * from './types/adapter.js';
```

- [ ] **Step 8: Run test, expect pass**

Run: `pnpm --filter @contractqa/core test`
Expected: 5 passed.

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): public types for snapshot, verdict, evidence, adapter"
```

---

## Task 5: Noise profile schema

**Files:**
- Create: `packages/core/src/schemas/noise-profile.schema.ts`, `packages/core/tests/noise-profile.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

`packages/core/tests/noise-profile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NoiseProfileSchema } from '../src/schemas/noise-profile.schema.js';

describe('NoiseProfileSchema', () => {
  it('parses §8.5.2 example', () => {
    const parsed = NoiseProfileSchema.parse({
      project: 'my-app',
      generated_at: '2026-05-14T10:00:00Z',
      ignore: {
        localStorage_keys: ['^posthog-', '^sentry-'],
        cookies: ['^_ga', '^_gid'],
        network_url_patterns: ['/api/telemetry'],
        console_patterns: ['Download the React DevTools.*'],
      },
    });
    expect(parsed.ignore.localStorage_keys).toHaveLength(2);
  });

  it('rejects ReDoS-dangerous patterns', () => {
    expect(() =>
      NoiseProfileSchema.parse({
        project: 'x',
        generated_at: '2026-05-14T10:00:00Z',
        ignore: { localStorage_keys: ['(a+)+$'] },
      }),
    ).toThrow(/unsafe regex/i);
  });

  it('defaults empty arrays when ignore omitted', () => {
    const parsed = NoiseProfileSchema.parse({
      project: 'x',
      generated_at: '2026-05-14T10:00:00Z',
    });
    expect(parsed.ignore.localStorage_keys).toEqual([]);
    expect(parsed.ignore.cookies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @contractqa/core test -- noise-profile`
Expected: FAIL.

- [ ] **Step 3: Implement schema**

`packages/core/src/schemas/noise-profile.schema.ts`:
```ts
import { z } from 'zod';
import { assertSafeRegex } from './safe-regex.js';

const SafeRegex = z.string().superRefine((v, ctx) => {
  try {
    assertSafeRegex(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
  }
});

export const NoiseProfileSchema = z.object({
  project: z.string().min(1),
  generated_at: z.string().datetime(),
  ignore: z
    .object({
      localStorage_keys: z.array(SafeRegex).default([]),
      sessionStorage_keys: z.array(SafeRegex).default([]),
      cookies: z.array(SafeRegex).default([]),
      network_url_patterns: z.array(SafeRegex).default([]),
      console_patterns: z.array(SafeRegex).default([]),
    })
    .default({}),
});

export type NoiseProfile = z.infer<typeof NoiseProfileSchema>;
```

- [ ] **Step 4: Export from `index.ts`** and run test, expect pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): noise profile schema for §8.5 idle baseline"
```

---

## Task 6: `@contractqa/adapters` package + AppAdapter default

**Files:**
- Create: `packages/adapters/package.json`, `tsconfig.json`, `src/index.ts`, `src/app/default.ts`, `src/registry.ts`, `tests/default-app.test.ts`

- [ ] **Step 1: Write failing test**

`packages/adapters/tests/default-app.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { DefaultAppAdapter } from '../src/app/default.js';

describe('DefaultAppAdapter', () => {
  it('exposes baseUrl and healthCheckUrl', () => {
    const a = new DefaultAppAdapter({
      baseUrl: 'http://localhost:3000',
      healthCheckUrl: 'http://localhost:3000/api/health',
    });
    expect(a.baseUrl).toBe('http://localhost:3000');
    expect(a.healthCheckUrl).toBe('http://localhost:3000/api/health');
  });

  it('resetState calls user-provided reset hook', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    const a = new DefaultAppAdapter({
      baseUrl: 'http://x',
      healthCheckUrl: 'http://x/h',
      onReset: reset,
    });
    await a.resetState();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('seed without onSeed is a no-op', async () => {
    const a = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    await expect(a.seed('minimal')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@contractqa/adapters",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "test": "vitest run"
  },
  "dependencies": { "@contractqa/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 3: Implement `DefaultAppAdapter`**

`packages/adapters/src/app/default.ts`:
```ts
import type { AppAdapter, SeedProfile } from '@contractqa/core';

export interface DefaultAppAdapterOptions {
  baseUrl: string;
  startCommand?: string;
  healthCheckUrl: string;
  onReset?: () => Promise<void>;
  onSeed?: (profile: SeedProfile) => Promise<void>;
}

export class DefaultAppAdapter implements AppAdapter {
  readonly baseUrl: string;
  readonly startCommand?: string;
  readonly healthCheckUrl: string;
  private readonly opts: DefaultAppAdapterOptions;
  constructor(opts: DefaultAppAdapterOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl;
    this.startCommand = opts.startCommand;
    this.healthCheckUrl = opts.healthCheckUrl;
  }
  async resetState(): Promise<void> {
    if (this.opts.onReset) await this.opts.onReset();
  }
  async seed(profile: SeedProfile): Promise<void> {
    if (this.opts.onSeed) await this.opts.onSeed(profile);
  }
}
```

- [ ] **Step 4: Write `src/index.ts` and `src/registry.ts`**

```ts
// src/index.ts
export { DefaultAppAdapter } from './app/default.js';
export type { DefaultAppAdapterOptions } from './app/default.js';
```

```ts
// src/registry.ts — populated as auth adapters land in T7–T10
import type { AuthAdapter, AuthProviderName } from '@contractqa/core';

const registry = new Map<AuthProviderName, () => AuthAdapter>();

export function registerAuthAdapter(name: AuthProviderName, factory: () => AuthAdapter): void {
  registry.set(name, factory);
}

export function getAuthAdapter(name: AuthProviderName): AuthAdapter {
  const f = registry.get(name);
  if (!f) throw new Error(`auth provider not registered: ${name}`);
  return f();
}
```

- [ ] **Step 5: `pnpm install`, run test, expect pass.**

- [ ] **Step 6: Commit**

```bash
git add packages/adapters
git commit -m "feat(adapters): @contractqa/adapters scaffold + DefaultAppAdapter"
```

---

## Task 7: SupabaseAuthAdapter

**Files:**
- Create: `packages/adapters/src/auth/supabase.ts`, `packages/adapters/tests/supabase-auth.test.ts`

- [ ] **Step 1: Write failing test**

`packages/adapters/tests/supabase-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase.js';

function pageWithStorage(local: Record<string, string>, cookies: Array<{ name: string }> = []) {
  return {
    async evaluate<T>(fn: () => T): Promise<T> {
      const globals = { localStorage: { ...local }, document: { cookie: '' } } as never;
      return fn.call(globals);
    },
    context() {
      return { cookies: async () => cookies };
    },
  } as any;
}

describe('SupabaseAuthAdapter', () => {
  const a = new SupabaseAuthAdapter({ url: 'https://x.supabase.co', anonKey: 'k' });

  it('sessionKeyPatterns matches sb-* localStorage keys', () => {
    const pats = a.sessionKeyPatterns();
    expect(pats.localStorage[0].test('sb-xyz-auth-token')).toBe(true);
    expect(pats.localStorage[0].test('posthog-id')).toBe(false);
  });

  it('expectFullyLoggedOut returns true when no sb-* keys and no supabase cookies', async () => {
    const page = pageWithStorage({}, []);
    const r = await a.expectFullyLoggedOut(page);
    expect(r.fullyLoggedOut).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('expectFullyLoggedOut returns false when sb-* key present', async () => {
    const page = pageWithStorage({ 'sb-xyz-auth-token': 'redacted' });
    const r = await a.expectFullyLoggedOut(page);
    expect(r.fullyLoggedOut).toBe(false);
    expect(r.reasons.join(',')).toMatch(/sb-/);
  });

  it('expectFullyLoggedOut returns false when supabase cookie present', async () => {
    const page = pageWithStorage({}, [{ name: 'sb-access-token' }]);
    const r = await a.expectFullyLoggedOut(page);
    expect(r.fullyLoggedOut).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement adapter**

`packages/adapters/src/auth/supabase.ts`:
```ts
import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

export interface SupabaseAuthAdapterOptions {
  url: string;
  anonKey: string;
}

interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>;
  context(): { cookies(): Promise<Array<{ name: string }>> };
  goto?(url: string): Promise<unknown>;
}

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly provider = 'supabase' as const;
  constructor(private readonly opts: SupabaseAuthAdapterOptions) {}

  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^sb-/, /^supabase\.auth\./],
      sessionStorage: [/^sb-/],
      cookies: [/^sb-/, /^supabase/],
    };
  }

  async loginAs(_role: string, _page: PageLike): Promise<void> {
    // Programmatic login lives in the fixture adapter (Task 24); this base adapter
    // documents the contract and is overridden per fixture.
    throw new Error('SupabaseAuthAdapter.loginAs must be overridden per project');
  }

  async isAuthenticated(page: PageLike): Promise<boolean> {
    const r = await this.expectFullyLoggedOut(page);
    return !r.fullyLoggedOut;
  }

  async currentUser(_page: PageLike): Promise<{ id: string; role: string } | null> {
    return null;
  }

  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const localKeys = await page.evaluate(() => Object.keys((globalThis as any).localStorage ?? {}));
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons: string[] = [];
    for (const k of localKeys) {
      if (pats.localStorage.some((r) => r.test(k))) reasons.push(`localStorage key ${k} still present`);
    }
    for (const c of cookies) {
      if (pats.cookies.some((r) => r.test(c.name))) reasons.push(`cookie ${c.name} still present`);
    }
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
```

- [ ] **Step 4: Export from `src/index.ts` and register in registry**

```ts
// src/index.ts (append)
import { SupabaseAuthAdapter, type SupabaseAuthAdapterOptions } from './auth/supabase.js';
import { registerAuthAdapter } from './registry.js';
export { SupabaseAuthAdapter };
export type { SupabaseAuthAdapterOptions };
registerAuthAdapter('supabase', () => new SupabaseAuthAdapter({ url: '', anonKey: '' }));
export { registerAuthAdapter, getAuthAdapter } from './registry.js';
```

- [ ] **Step 5: Run test, expect pass.**

- [ ] **Step 6: Commit**

```bash
git add packages/adapters
git commit -m "feat(adapters): SupabaseAuthAdapter with sb-* session detection"
```

---

## Task 8: ClerkAuthAdapter

**Files:**
- Create: `packages/adapters/src/auth/clerk.ts`, `packages/adapters/tests/clerk-auth.test.ts`

- [ ] **Step 1: Write failing test**

`packages/adapters/tests/clerk-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ClerkAuthAdapter } from '../src/auth/clerk.js';

function page(cookies: Array<{ name: string }>) {
  return {
    async evaluate<T>(fn: () => T): Promise<T> {
      const g = { localStorage: {} } as never;
      return fn.call(g);
    },
    context() {
      return { cookies: async () => cookies };
    },
  } as any;
}

describe('ClerkAuthAdapter', () => {
  const a = new ClerkAuthAdapter();
  it('detects __session cookie', () => {
    expect(a.sessionKeyPatterns().cookies.some((r) => r.test('__session'))).toBe(true);
  });
  it('expectFullyLoggedOut returns false when __session present', async () => {
    const r = await a.expectFullyLoggedOut(page([{ name: '__session' }]));
    expect(r.fullyLoggedOut).toBe(false);
  });
  it('expectFullyLoggedOut returns true when no Clerk cookies', async () => {
    const r = await a.expectFullyLoggedOut(page([{ name: '_ga' }]));
    expect(r.fullyLoggedOut).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>;
  context(): { cookies(): Promise<Array<{ name: string }>> };
}

export class ClerkAuthAdapter implements AuthAdapter {
  readonly provider = 'clerk' as const;
  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^__clerk/],
      sessionStorage: [/^__clerk/],
      cookies: [/^__session$/, /^__client_uat$/, /^__clerk/],
    };
  }
  async loginAs(): Promise<void> { throw new Error('override per project'); }
  async isAuthenticated(page: PageLike): Promise<boolean> {
    return !(await this.expectFullyLoggedOut(page)).fullyLoggedOut;
  }
  async currentUser(): Promise<null> { return null; }
  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons = cookies
      .filter((c) => pats.cookies.some((r) => r.test(c.name)))
      .map((c) => `cookie ${c.name} still present`);
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
```

- [ ] **Step 4: Export + register; run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters
git commit -m "feat(adapters): ClerkAuthAdapter"
```

---

## Task 9: NextAuthAdapter

**Files:**
- Create: `packages/adapters/src/auth/next-auth.ts`, `packages/adapters/tests/next-auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { NextAuthAdapter } from '../src/auth/next-auth.js';

function page(cookies: Array<{ name: string }>) {
  return {
    evaluate: async <T>(fn: () => T) => fn.call({ localStorage: {} } as never),
    context: () => ({ cookies: async () => cookies }),
  } as any;
}

describe('NextAuthAdapter', () => {
  const a = new NextAuthAdapter();
  it('detects next-auth.session-token', () => {
    expect(a.sessionKeyPatterns().cookies.some((r) => r.test('next-auth.session-token'))).toBe(true);
  });
  it('detects __Secure-next-auth variant', () => {
    expect(
      a.sessionKeyPatterns().cookies.some((r) => r.test('__Secure-next-auth.session-token')),
    ).toBe(true);
  });
  it('false when session-token cookie present', async () => {
    const r = await a.expectFullyLoggedOut(page([{ name: 'next-auth.session-token' }]));
    expect(r.fullyLoggedOut).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`packages/adapters/src/auth/next-auth.ts`:
```ts
import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>;
  context(): { cookies(): Promise<Array<{ name: string }>> };
}

export class NextAuthAdapter implements AuthAdapter {
  readonly provider = 'next-auth' as const;
  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [],
      sessionStorage: [],
      cookies: [
        /^next-auth\.session-token$/,
        /^__Secure-next-auth\.session-token$/,
        /^next-auth\.csrf-token$/,
        /^__Host-next-auth\.csrf-token$/,
      ],
    };
  }
  async loginAs(): Promise<void> { throw new Error('override per project'); }
  async isAuthenticated(page: PageLike): Promise<boolean> {
    return !(await this.expectFullyLoggedOut(page)).fullyLoggedOut;
  }
  async currentUser(): Promise<null> { return null; }
  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons = cookies
      .filter((c) => pats.cookies.some((r) => r.test(c.name)))
      .map((c) => `cookie ${c.name} still present`);
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
```

- [ ] **Step 4: Export + register; run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(adapters): NextAuthAdapter"
```

---

## Task 10: Auth0Adapter

**Files:**
- Create: `packages/adapters/src/auth/auth0.ts`, `packages/adapters/tests/auth0.test.ts`

- [ ] **Step 1: Write failing test** (same shape as Task 9)

Patterns to check: cookies `auth0`, `auth0.is.authenticated`, `_legacy_auth0`, plus localStorage keys `@@auth0spajs@@`.

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`packages/adapters/src/auth/auth0.ts`:
```ts
import type { AuthAdapter, AuthStateAssertion, SessionKeyPatterns } from '@contractqa/core';

interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>;
  context(): { cookies(): Promise<Array<{ name: string }>> };
}

export class Auth0Adapter implements AuthAdapter {
  readonly provider = 'auth0' as const;
  sessionKeyPatterns(): SessionKeyPatterns {
    return {
      localStorage: [/^@@auth0spajs@@/],
      sessionStorage: [/^@@auth0spajs@@/],
      cookies: [/^auth0$/, /^auth0\.is\.authenticated$/, /^_legacy_auth0/],
    };
  }
  async loginAs(): Promise<void> { throw new Error('override per project'); }
  async isAuthenticated(page: PageLike): Promise<boolean> {
    return !(await this.expectFullyLoggedOut(page)).fullyLoggedOut;
  }
  async currentUser(): Promise<null> { return null; }
  async expectFullyLoggedOut(page: PageLike): Promise<AuthStateAssertion> {
    const localKeys = await page.evaluate(() => Object.keys((globalThis as any).localStorage ?? {}));
    const cookies = await page.context().cookies();
    const pats = this.sessionKeyPatterns();
    const reasons: string[] = [];
    for (const k of localKeys) {
      if (pats.localStorage.some((r) => r.test(k))) reasons.push(`localStorage key ${k} still present`);
    }
    for (const c of cookies) {
      if (pats.cookies.some((r) => r.test(c.name))) reasons.push(`cookie ${c.name} still present`);
    }
    return { fullyLoggedOut: reasons.length === 0, reasons };
  }
}
```

- [ ] **Step 4: Export + register; run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(adapters): Auth0Adapter"
```

---

## Task 11: Adapter completeness level helper

**Files:**
- Create: `packages/adapters/src/level.ts`, `packages/adapters/tests/level.test.ts`
- Modify: `packages/adapters/src/index.ts`

Implements §7.6.4 L0–L3 detection so the runner can downgrade contracts to `INCONCLUSIVE` per §7.6.3 when capability missing.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeAdapterLevel } from '../src/level.js';
import { DefaultAppAdapter, SupabaseAuthAdapter } from '../src/index.js';

describe('computeAdapterLevel', () => {
  it('L0 with only AppAdapter', () => {
    const app = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    expect(computeAdapterLevel({ app })).toBe('L0');
  });
  it('L1 with AppAdapter + AuthAdapter', () => {
    const app = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    const auth = new SupabaseAuthAdapter({ url: '', anonKey: '' });
    expect(computeAdapterLevel({ app, auth })).toBe('L1');
  });
  it('L2 with BackendAdapter included', () => {
    const app = new DefaultAppAdapter({ baseUrl: 'http://x', healthCheckUrl: 'http://x/h' });
    const auth = new SupabaseAuthAdapter({ url: '', anonKey: '' });
    const backend = { kind: 'postgres', describe: () => ({ namedQueries: [], tenantField: null }), query: async () => null } as any;
    expect(computeAdapterLevel({ app, auth, backend })).toBe('L2');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { AppAdapter, AuthAdapter, BackendAdapter } from '@contractqa/core';

export type AdapterLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface AdapterSet {
  app: AppAdapter;
  auth?: AuthAdapter;
  backend?: BackendAdapter;
  customProbes?: string[];
}

export function computeAdapterLevel(set: AdapterSet): AdapterLevel {
  if (set.customProbes && set.customProbes.length > 0 && set.backend && set.auth) return 'L3';
  if (set.backend && set.auth) return 'L2';
  if (set.auth) return 'L1';
  return 'L0';
}

export function meetsMinimum(level: AdapterLevel): boolean {
  return level === 'L1' || level === 'L2' || level === 'L3';
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(adapters): adapter completeness level (L0-L3)"
```

---

**End of Phase 1a.** Checkpoint: all packages typecheck, all unit tests pass, four auth providers registered, AppAdapter usable, schemas reject ReDoS regex.

Run: `pnpm -r typecheck && pnpm -r test`

---

# Phase 1b — Runner / Probe / Oracle

## Task 12: `@contractqa/probes` package + redaction

**Files:**
- Create: `packages/probes/package.json`, `tsconfig.json`, `src/index.ts`, `src/redaction.ts`, `tests/redaction.test.ts`

- [ ] **Step 1: Write failing test**

`packages/probes/tests/redaction.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { redactValue, redactHeaders, redactBody, defaultRedactionRules } from '../src/redaction.js';

describe('redaction (§8.4)', () => {
  it('redacts string value', () => {
    expect(redactValue('secret-token')).toEqual({ __redacted: true });
  });
  it('redacts sensitive headers case-insensitively', () => {
    const r = redactHeaders(
      { Authorization: 'Bearer x', 'X-API-Key': 'y', 'User-Agent': 'pw' },
      defaultRedactionRules,
    );
    expect(r['Authorization']).toEqual({ __redacted: true });
    expect(r['X-API-Key']).toEqual({ __redacted: true });
    expect(r['User-Agent']).toBe('pw');
  });
  it('redacts sensitive body fields recursively', () => {
    const r = redactBody(
      { user: { password: 'abc', name: 'leo', token: 'xyz' }, list: [{ secret: 'x' }] },
      defaultRedactionRules,
    );
    expect(r).toMatchObject({
      user: { password: { __redacted: true }, name: 'leo', token: { __redacted: true } },
      list: [{ secret: { __redacted: true } }],
    });
  });
});
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@contractqa/probes",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "test": "vitest run"
  },
  "dependencies": {
    "@contractqa/core": "workspace:*",
    "playwright": "^1.49.0"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 3: Implement redaction**

`packages/probes/src/redaction.ts`:
```ts
import type { Redacted } from '@contractqa/core';

export interface RedactionRules {
  redactLocalStorageValues: boolean;
  redactSessionStorageValues: boolean;
  redactCookieValues: boolean;
  headers: string[];          // lowercase names
  bodyFields: string[];       // lowercase field names
}

export const defaultRedactionRules: RedactionRules = {
  redactLocalStorageValues: true,
  redactSessionStorageValues: true,
  redactCookieValues: true,
  headers: ['authorization', 'cookie', 'x-api-key', 'proxy-authorization'],
  bodyFields: ['password', 'token', 'secret', 'privatekey', 'apikey', 'access_token', 'refresh_token'],
};

export function redactValue(_v: unknown): Redacted {
  return { __redacted: true };
}

export function redactHeaders(
  headers: Record<string, string>,
  rules: RedactionRules,
): Record<string, string | Redacted> {
  const out: Record<string, string | Redacted> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = rules.headers.includes(k.toLowerCase()) ? redactValue(v) : v;
  }
  return out;
}

export function redactBody(body: unknown, rules: RedactionRules): unknown {
  if (body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map((x) => redactBody(x, rules));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (rules.bodyFields.includes(k.toLowerCase())) {
      out[k] = redactValue(v);
    } else {
      out[k] = redactBody(v, rules);
    }
  }
  return out;
}

export function redactStorageMap(
  m: Record<string, string>,
  enabled: boolean,
): Record<string, string | Redacted> {
  const out: Record<string, string | Redacted> = {};
  for (const k of Object.keys(m)) out[k] = enabled ? redactValue(m[k]) : (m[k] as string);
  return out;
}
```

- [ ] **Step 4: Run test, expect pass. Commit.**

```bash
git add packages/probes
git commit -m "feat(probes): redaction rules per §8.4"
```

---

## Task 13: Browser snapshot module

**Files:**
- Create: `packages/probes/src/browser-snapshot.ts`, `packages/probes/src/console.ts`, `packages/probes/src/network.ts`, `packages/probes/tests/browser-snapshot.test.ts`

Strategy: write the snapshot module to accept a small `Page`-shaped interface (so it's testable without a real browser), then test with a mock. A separate Playwright integration test will run later in Task 16.

- [ ] **Step 1: Write failing test**

`packages/probes/tests/browser-snapshot.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { snapshotBrowser } from '../src/browser-snapshot.js';

function mockPage() {
  const consoleHandlers: Array<(m: any) => void> = [];
  const requestHandlers: Array<(r: any) => void> = [];
  return {
    url: () => 'http://localhost:3000/lobby',
    title: async () => 'Lobby',
    viewportSize: () => ({ width: 1280, height: 720 }),
    screenshot: async () => Buffer.from('PNG'),
    content: async () => '<html><body>Hi</body></html>',
    evaluate: async (fn: (...a: any[]) => any, arg?: any) => fn(arg),
    context: () => ({
      cookies: async () => [
        { name: 'sb-xyz', domain: 'localhost', path: '/', httpOnly: true, secure: false, value: 'redact' },
      ],
    }),
    on: (event: string, handler: (...a: any[]) => void) => {
      if (event === 'console') consoleHandlers.push(handler);
      if (event === 'request') requestHandlers.push(handler);
    },
    __emitConsole: (m: any) => consoleHandlers.forEach((h) => h(m)),
  } as any;
}

describe('snapshotBrowser', () => {
  it('captures url, title, viewport, cookies (redacted)', async () => {
    const page = mockPage();
    const snap = await snapshotBrowser(page, { screenshotPath: '/tmp/x.png' });
    expect(snap.url).toBe('http://localhost:3000/lobby');
    expect(snap.title).toBe('Lobby');
    expect(snap.viewport).toEqual({ width: 1280, height: 720 });
    expect(snap.cookies[0]).toMatchObject({ name: 'sb-xyz', valueRedacted: true });
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`packages/probes/src/browser-snapshot.ts`:
```ts
import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BrowserSnapshot, CookieSummary } from '@contractqa/core';
import { defaultRedactionRules, redactStorageMap } from './redaction.js';

interface PageLike {
  url(): string;
  title(): Promise<string>;
  viewportSize(): { width: number; height: number } | null;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  content(): Promise<string>;
  evaluate<T>(fn: (...a: any[]) => T): Promise<T>;
  context(): {
    cookies(): Promise<
      Array<{
        name: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite?: 'Lax' | 'Strict' | 'None';
      }>
    >;
  };
  on(event: string, handler: (...a: any[]) => void): void;
}

export interface SnapshotOptions {
  screenshotPath: string;
  consoleBuffer?: Array<{ type: any; text: string; timestamp: string; location?: any }>;
  networkBuffer?: any[];
  websocketBuffer?: any[];
}

export async function snapshotBrowser(page: PageLike, opts: SnapshotOptions): Promise<BrowserSnapshot> {
  const buf = await page.screenshot({ fullPage: false });
  await writeFile(opts.screenshotPath, buf);
  const html = await page.content();
  const domTextHash = crypto.createHash('sha256').update(html).digest('hex');

  const localStorage = await page.evaluate(() => {
    const out: Record<string, string> = {};
    const ls = (globalThis as any).localStorage;
    if (ls) for (let i = 0; i < ls.length; i++) out[ls.key(i)!] = ls.getItem(ls.key(i)!) ?? '';
    return out;
  });
  const sessionStorage = await page.evaluate(() => {
    const out: Record<string, string> = {};
    const ss = (globalThis as any).sessionStorage;
    if (ss) for (let i = 0; i < ss.length; i++) out[ss.key(i)!] = ss.getItem(ss.key(i)!) ?? '';
    return out;
  });
  const rawCookies = await page.context().cookies();
  const cookies: CookieSummary[] = rawCookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    valueRedacted: true,
  }));

  return {
    timestamp: new Date().toISOString(),
    url: page.url(),
    title: await page.title(),
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    screenshotPath: opts.screenshotPath,
    domTextHash,
    localStorage: redactStorageMap(localStorage, defaultRedactionRules.redactLocalStorageValues),
    sessionStorage: redactStorageMap(sessionStorage, defaultRedactionRules.redactSessionStorageValues),
    cookies,
    console: (opts.consoleBuffer ?? []) as any,
    network: (opts.networkBuffer ?? []) as any,
    websocket: (opts.websocketBuffer ?? []) as any,
  };
}
```

- [ ] **Step 4: Run test, expect pass. Commit.**

```bash
git commit -am "feat(probes): browser snapshot capture with redaction"
```

---

## Task 14: Idle baseline → noise profile generator

**Files:**
- Create: `packages/probes/src/noise-profile.ts`, `packages/probes/tests/noise-profile.test.ts`

Implements §8.5.2.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { synthesizeNoiseProfile } from '../src/noise-profile.js';

describe('synthesizeNoiseProfile', () => {
  it('groups recurring localStorage prefixes into regex ignores', () => {
    const samples = [
      { localStorageKeys: ['posthog-1234', '_ph_session', 'sentry-id-aa'] },
      { localStorageKeys: ['posthog-9999', 'sentry-id-bb'] },
    ];
    const p = synthesizeNoiseProfile({ project: 'x', samples, cookies: [], network: [], console: [] });
    expect(p.ignore.localStorage_keys).toContain('^posthog-');
    expect(p.ignore.localStorage_keys).toContain('^sentry-');
  });

  it('keeps singletons out of ignore list', () => {
    const p = synthesizeNoiseProfile({
      project: 'x',
      samples: [{ localStorageKeys: ['only-once'] }],
      cookies: [], network: [], console: [],
    });
    expect(p.ignore.localStorage_keys).not.toContain('^only-once');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { NoiseProfile } from '@contractqa/core';

export interface NoiseInput {
  project: string;
  samples: Array<{ localStorageKeys: string[] }>;
  cookies: string[];
  network: string[];
  console: string[];
}

function commonPrefixes(values: string[], minOccur = 2, minLen = 3): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    for (let i = minLen; i <= Math.min(v.length, 12); i++) {
      const p = v.slice(0, i);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  const winners = [...counts.entries()]
    .filter(([, c]) => c >= minOccur)
    .sort((a, b) => b[0].length - a[0].length);
  const picked: string[] = [];
  for (const [p] of winners) {
    if (!picked.some((q) => p.startsWith(q))) picked.push(p);
  }
  return picked.map((p) => '^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

export function synthesizeNoiseProfile(input: NoiseInput): NoiseProfile {
  const lsKeys = input.samples.flatMap((s) => s.localStorageKeys);
  return {
    project: input.project,
    generated_at: new Date().toISOString(),
    ignore: {
      localStorage_keys: commonPrefixes(lsKeys),
      sessionStorage_keys: [],
      cookies: commonPrefixes(input.cookies),
      network_url_patterns: input.network,
      console_patterns: input.console,
    },
  };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(probes): synthesize noise profile from idle baseline"
```

---

## Task 15: `@contractqa/oracle` — state diff

**Files:**
- Create: `packages/oracle/package.json`, `tsconfig.json`, `src/index.ts`, `src/state-diff.ts`, `tests/state-diff.test.ts`

Implements §8.3.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeStateDiff } from '../src/state-diff.js';

const before = {
  url: '/lobby',
  localStorageKeys: ['sb-xyz-auth-token', 'theme'],
  cookies: ['app_sid'],
};
const after = {
  url: '/lobby',
  localStorageKeys: ['sb-xyz-auth-token', 'theme'],
  cookies: [],
};

describe('computeStateDiff', () => {
  it('reports url unchanged, cookies removed, localStorage unchanged', () => {
    const d = computeStateDiff(before, after);
    expect(d.url.changed).toBe(false);
    expect(d.cookies.removed).toEqual(['app_sid']);
    expect(d.localStorage.added).toEqual([]);
    expect(d.localStorage.removed).toEqual([]);
  });
  it('reports added and removed keys', () => {
    const d = computeStateDiff(
      { url: '/a', localStorageKeys: ['x'], cookies: [] },
      { url: '/b', localStorageKeys: ['y'], cookies: [] },
    );
    expect(d.url.changed).toBe(true);
    expect(d.localStorage.added).toEqual(['y']);
    expect(d.localStorage.removed).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Write `package.json`** (deps: `@contractqa/core`).

- [ ] **Step 3: Implement**

```ts
export interface StateSlice {
  url: string;
  localStorageKeys: string[];
  cookies: string[];
}

export interface StateDiff {
  url: { before: string; after: string; changed: boolean };
  localStorage: { added: string[]; removed: string[] };
  cookies: { added: string[]; removed: string[] };
}

function diffArrays(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    added: b.filter((x) => !sa.has(x)),
    removed: a.filter((x) => !sb.has(x)),
  };
}

export function computeStateDiff(before: StateSlice, after: StateSlice): StateDiff {
  return {
    url: { before: before.url, after: after.url, changed: before.url !== after.url },
    localStorage: diffArrays(before.localStorageKeys, after.localStorageKeys),
    cookies: diffArrays(before.cookies, after.cookies),
  };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(oracle): state diff (§8.3)"
```

---

## Task 16: Declared-field classifier (noise vs verdict)

**Files:**
- Create: `packages/oracle/src/declared-fields.ts`, `packages/oracle/tests/declared-fields.test.ts`

Implements §8.5.1 — only declared fields participate in verdict; undeclared = noise.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { classifyDiff } from '../src/declared-fields.js';

const diff = {
  url: { before: '/x', after: '/agents', changed: true },
  localStorage: { added: ['posthog-id'], removed: [] },
  cookies: { added: [], removed: [] },
};

const noise = {
  project: 'x',
  generated_at: '2026-05-14T00:00:00Z',
  ignore: { localStorage_keys: ['^posthog-'], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] },
};

describe('classifyDiff', () => {
  it('declared positive that matches expected → contributes to PASS', () => {
    const r = classifyDiff(diff, {
      url: { matches: '^/agents$' },
    }, noise);
    expect(r.passContributions).toContainEqual({ field: 'url', detail: 'matches ^/agents$' });
    expect(r.failContributions).toEqual([]);
  });

  it('declared negative violated → contributes to FAIL', () => {
    const r = classifyDiff(
      { ...diff, localStorage: { added: ['sb-token'], removed: [] } },
      { localStorage: { no_key_matches: '^sb-' } },
      noise,
    );
    expect(r.failContributions[0].field).toBe('localStorage');
  });

  it('undeclared field with noise match → ignored', () => {
    const r = classifyDiff(diff, { url: { matches: '^/agents$' } }, noise);
    expect(r.noiseIgnored).toContain('localStorage:posthog-id');
  });

  it('undeclared field NOT in noise → still noise (unless watch_keys overrides)', () => {
    const r = classifyDiff(diff, { url: { matches: '^/agents$' } }, noise);
    // Undeclared is never FAIL per §8.5.1 row 4
    expect(r.failContributions.every((f) => f.field !== 'localStorage')).toBe(true);
  });

  it('watch_keys overrides noise', () => {
    const r = classifyDiff(
      diff,
      { url: { matches: '^/agents$' }, watch_keys: { localStorage: ['^posthog-'] } },
      noise,
    );
    expect(r.watchedKeysMatched).toContain('posthog-id');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { NoiseProfile } from '@contractqa/core';
import type { StateDiff } from './state-diff.js';

export interface Expected {
  url?: { matches?: string };
  localStorage?: { no_key_matches?: string; has_key_matches?: string };
  cookies?: { no_name_matches?: string };
  watch_keys?: { localStorage?: string[]; cookies?: string[] };
}

export interface DiffClassification {
  passContributions: Array<{ field: string; detail: string }>;
  failContributions: Array<{ field: string; detail: string; actual: unknown }>;
  noiseIgnored: string[];
  watchedKeysMatched: string[];
}

function matchAny(s: string, patterns: string[] | undefined): boolean {
  if (!patterns) return false;
  return patterns.some((p) => new RegExp(p).test(s));
}

export function classifyDiff(
  diff: StateDiff,
  expected: Expected,
  noise: NoiseProfile,
): DiffClassification {
  const out: DiffClassification = {
    passContributions: [],
    failContributions: [],
    noiseIgnored: [],
    watchedKeysMatched: [],
  };

  if (expected.url?.matches) {
    const re = new RegExp(expected.url.matches);
    if (re.test(diff.url.after)) {
      out.passContributions.push({ field: 'url', detail: `matches ${expected.url.matches}` });
    } else {
      out.failContributions.push({
        field: 'url',
        detail: `expected ${expected.url.matches}`,
        actual: diff.url.after,
      });
    }
  }

  const watchLS = expected.watch_keys?.localStorage ?? [];
  const ignoreLS = noise.ignore.localStorage_keys;
  for (const key of diff.localStorage.added) {
    const isWatched = matchAny(key, watchLS);
    const isNoise = !isWatched && matchAny(key, ignoreLS);
    const violatesNegative = expected.localStorage?.no_key_matches
      ? new RegExp(expected.localStorage.no_key_matches).test(key)
      : false;
    if (isWatched) out.watchedKeysMatched.push(key);
    if (violatesNegative) {
      out.failContributions.push({
        field: 'localStorage',
        detail: `violates no_key_matches ${expected.localStorage!.no_key_matches}`,
        actual: key,
      });
    } else if (isNoise) {
      out.noiseIgnored.push(`localStorage:${key}`);
    } else if (!expected.localStorage) {
      // Undeclared, not in noise → still ignored per §8.5.1 row 4
      out.noiseIgnored.push(`localStorage:${key}`);
    }
  }

  if (expected.localStorage?.has_key_matches) {
    const re = new RegExp(expected.localStorage.has_key_matches);
    const present = diff.localStorage.added.some((k) => re.test(k));
    if (present) out.passContributions.push({ field: 'localStorage', detail: 'has_key_matches' });
    else out.failContributions.push({
      field: 'localStorage',
      detail: `missing has_key_matches ${expected.localStorage.has_key_matches}`,
      actual: diff.localStorage.added,
    });
  }

  if (expected.cookies?.no_name_matches) {
    const re = new RegExp(expected.cookies.no_name_matches);
    for (const c of diff.cookies.added) {
      if (re.test(c)) {
        out.failContributions.push({ field: 'cookies', detail: `violates no_name_matches`, actual: c });
      }
    }
  }

  return out;
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(oracle): noise-aware diff classifier (§8.5.1)"
```

---

## Task 17: Verdict + confidence engine

**Files:**
- Create: `packages/oracle/src/verdict.ts`, `packages/oracle/src/confidence.ts`, `packages/oracle/tests/verdict.test.ts`

Implements §9.2 and §9.3.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../src/verdict.js';

describe('computeVerdict (§9.2)', () => {
  const evidence = { state_diff: true, trace: true, screenshot: true, console: true, network: true };

  it('PASS when no fail contributions and not inconclusive', () => {
    const r = computeVerdict({
      runs: [{ failContributions: [], evidence }],
      requiredEvidence: ['state_diff', 'trace'],
      missingCapabilities: [],
    });
    expect(r.verdict).toBe('PASS');
  });

  it('FAIL when stable across runs', () => {
    const r = computeVerdict({
      runs: [
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence },
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence },
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence },
      ],
      requiredEvidence: ['state_diff'],
      missingCapabilities: [],
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.reproductionRate).toBe(1);
  });

  it('FLAKY when failures intermittent', () => {
    const r = computeVerdict({
      runs: [
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence },
        { failContributions: [], evidence },
        { failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence },
      ],
      requiredEvidence: ['state_diff'],
      missingCapabilities: [],
    });
    expect(r.verdict).toBe('FLAKY');
  });

  it('INCONCLUSIVE when missing required capability (§7.6.3)', () => {
    const r = computeVerdict({
      runs: [{ failContributions: [], evidence: { state_diff: true } }],
      requiredEvidence: ['state_diff'],
      missingCapabilities: ['backend_probe'],
    });
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.missingCapabilities).toContain('backend_probe');
  });

  it('confidence rises with reproduction rate and evidence completeness', () => {
    const r = computeVerdict({
      runs: Array(3).fill({ failContributions: [{ field: 'url', detail: 'x', actual: '' }], evidence }),
      requiredEvidence: ['state_diff', 'trace', 'screenshot', 'console', 'network'],
      missingCapabilities: [],
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement confidence**

`packages/oracle/src/confidence.ts`:
```ts
export interface ConfidenceInputs {
  reproductionRate: number;     // 0..1
  evidenceCompleteness: number; // 0..1
  flakeScore: number;           // 0..1, higher = flakier
  oracleStrictness: number;     // 0..1
  violationSeverity: number;    // 0..1 (P0=1)
}

export function computeConfidence(i: ConfidenceInputs): number {
  const stability = 1 - i.flakeScore;
  const raw =
    0.35 * i.reproductionRate +
    0.20 * i.evidenceCompleteness +
    0.15 * stability +
    0.15 * i.oracleStrictness +
    0.15 * i.violationSeverity;
  return Math.max(0, Math.min(1, raw));
}
```

- [ ] **Step 4: Implement verdict**

`packages/oracle/src/verdict.ts`:
```ts
import type { Verdict, VerdictResult } from '@contractqa/core';
import { computeConfidence } from './confidence.js';

export interface RunResult {
  failContributions: Array<{ field: string; detail: string; actual: unknown }>;
  evidence: Partial<Record<'state_diff' | 'trace' | 'screenshot' | 'console' | 'network', boolean>>;
}

export interface VerdictInput {
  runs: RunResult[];
  requiredEvidence: Array<'state_diff' | 'trace' | 'screenshot' | 'console' | 'network'>;
  missingCapabilities: string[];
  severity?: 'P0' | 'P1' | 'P2' | 'P3';
  oracleStrictness?: number;
}

export function computeVerdict(input: VerdictInput): VerdictResult {
  const totalRuns = input.runs.length;
  const failingRuns = input.runs.filter((r) => r.failContributions.length > 0).length;
  const reproductionRate = totalRuns === 0 ? 0 : failingRuns / totalRuns;

  const evidenceCompleteness =
    totalRuns === 0
      ? 0
      : input.runs.reduce((acc, r) => {
          const present = input.requiredEvidence.filter((k) => r.evidence[k]).length;
          return acc + present / Math.max(input.requiredEvidence.length, 1);
        }, 0) / totalRuns;

  // INCONCLUSIVE precedence: missing required capability
  if (input.missingCapabilities.length > 0) {
    return finalize('INCONCLUSIVE', {
      input, reproductionRate, evidenceCompleteness, flakeScore: 0,
      violations: input.runs.flatMap((r) => r.failContributions),
    });
  }

  let verdict: Verdict;
  if (failingRuns === 0) verdict = 'PASS';
  else if (failingRuns === totalRuns) verdict = 'FAIL';
  else verdict = 'FLAKY';

  const flakeScore = verdict === 'FLAKY' ? 1 - Math.abs(reproductionRate - 0.5) * 2 : 0;
  return finalize(verdict, {
    input, reproductionRate, evidenceCompleteness, flakeScore,
    violations: input.runs.flatMap((r) => r.failContributions),
  });
}

function finalize(
  verdict: Verdict,
  ctx: {
    input: VerdictInput;
    reproductionRate: number;
    evidenceCompleteness: number;
    flakeScore: number;
    violations: Array<{ field: string; detail: string; actual: unknown }>;
  },
): VerdictResult {
  const sevMap = { P0: 1, P1: 0.75, P2: 0.5, P3: 0.25 };
  const violationSeverity = sevMap[ctx.input.severity ?? 'P1'];
  const confidence = computeConfidence({
    reproductionRate: ctx.reproductionRate,
    evidenceCompleteness: ctx.evidenceCompleteness,
    flakeScore: ctx.flakeScore,
    oracleStrictness: ctx.input.oracleStrictness ?? 0.8,
    violationSeverity,
  });
  return {
    verdict,
    violations: ctx.violations.map((v) => ({
      invariantId: '',
      message: `${v.field}: ${v.detail}`,
      expected: v.detail,
      actual: v.actual,
    })),
    confidence,
    reproductionRate: ctx.reproductionRate,
    flakeScore: ctx.flakeScore,
    evidenceCompleteness: ctx.evidenceCompleteness,
    missingCapabilities: ctx.input.missingCapabilities,
  };
}
```

- [ ] **Step 5: Run, expect pass. Commit.**

```bash
git commit -am "feat(oracle): 4-state verdict + confidence score (§9.2-§9.3)"
```

---

## Task 18: `@contractqa/evidence` — bundle layout

**Files:**
- Create: `packages/evidence/package.json`, `tsconfig.json`, `src/index.ts`, `src/bundle.ts`, `src/manifest.ts`, `src/issue-json.ts`, `tests/bundle.test.ts`

Implements §11.1 and §11.2.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeEvidenceBundle } from '../src/bundle.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('writeEvidenceBundle', () => {
  it('creates §11.1 directory structure', async () => {
    const bundle = await writeEvidenceBundle({
      runId: '2026-05-14T10-20-31Z_auth_logout',
      contractId: 'INV-A2',
      artifactsRoot: dir,
      files: {
        'issue.json': Buffer.from('{}'),
        'repro.spec.ts': Buffer.from('// repro'),
        'trace.zip': Buffer.from('PK\x03\x04'),
        'screenshots/001-before-login.png': Buffer.from('PNG'),
        'snapshots/001-before.json': Buffer.from('{}'),
        'diffs/state-diff.json': Buffer.from('{}'),
        'network/network.har': Buffer.from('{}'),
        'console/console.log': Buffer.from(''),
      },
    });
    const runDir = path.join(dir, 'runs', '2026-05-14T10-20-31Z_auth_logout');
    const entries = await readdir(runDir);
    expect(entries).toContain('issue.json');
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('repro.spec.ts');
    expect(entries).toContain('screenshots');
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    expect(manifest.files).toBeInstanceOf(Array);
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.bundle_id).toBe(bundle.bundle_id);
  });

  it('writes redaction_applied flag', async () => {
    const b = await writeEvidenceBundle({
      runId: 'r1', contractId: 'INV-A1', artifactsRoot: dir, files: {}, redactionApplied: true,
    });
    expect(b.redaction_applied).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
// src/bundle.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { EvidenceBundleManifest } from '@contractqa/core';

export interface WriteBundleInput {
  runId: string;
  contractId: string;
  artifactsRoot: string;
  files: Record<string, Buffer>;
  redactionApplied?: boolean;
}

export async function writeEvidenceBundle(input: WriteBundleInput): Promise<EvidenceBundleManifest> {
  const runDir = path.join(input.artifactsRoot, 'runs', input.runId);
  await mkdir(runDir, { recursive: true });

  const files: EvidenceBundleManifest['files'] = [];
  for (const [rel, buf] of Object.entries(input.files)) {
    const abs = path.join(runDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    files.push({
      path: rel,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      kind: classify(rel),
    });
  }

  const manifest: EvidenceBundleManifest = {
    bundle_id: `bundle_${input.runId}`,
    created_at: new Date().toISOString(),
    contract_id: input.contractId,
    run_id: input.runId,
    files,
    redaction_applied: input.redactionApplied ?? true,
  };
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function classify(rel: string): string {
  if (rel.endsWith('.png')) return 'screenshot';
  if (rel.endsWith('.zip')) return 'trace';
  if (rel.endsWith('.har')) return 'network';
  if (rel.endsWith('.log')) return 'console';
  if (rel.startsWith('snapshots/')) return 'snapshot';
  if (rel.startsWith('diffs/')) return 'diff';
  if (rel === 'issue.json') return 'issue';
  if (rel.endsWith('.spec.ts')) return 'repro';
  return 'other';
}
```

`src/issue-json.ts` writes a typed `IssueJson` and validates required fields. `src/index.ts` re-exports both.

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git add packages/evidence
git commit -m "feat(evidence): write evidence bundle layout + manifest"
```

---

## Task 19: S3 upload (MinIO-compatible)

**Files:**
- Create: `packages/evidence/src/s3-upload.ts`, `packages/evidence/tests/s3-upload.test.ts`
- Add dep: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`

- [ ] **Step 1: Write failing test (with mocked client)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { uploadBundleToS3 } from '../src/s3-upload.js';

describe('uploadBundleToS3', () => {
  it('uploads each file with correct key prefix', async () => {
    const put = vi.fn().mockResolvedValue({});
    const client = { send: put } as any;
    const result = await uploadBundleToS3({
      client,
      bucket: 'contractqa',
      keyPrefix: 'projects/demo/runs/r1',
      localDir: '/tmp/nonexistent',
      manifest: {
        bundle_id: 'b1',
        created_at: '2026-05-14T00:00:00Z',
        contract_id: 'INV-A2',
        run_id: 'r1',
        files: [
          { path: 'issue.json', sha256: 'a', bytes: 2, kind: 'issue' },
          { path: 'screenshots/x.png', sha256: 'b', bytes: 3, kind: 'screenshot' },
        ],
        redaction_applied: true,
      },
      readFile: async (p: string) => Buffer.from('FAKE:' + p),
    });
    expect(put).toHaveBeenCalledTimes(3); // 2 files + manifest
    expect(result.uploaded).toBe(3);
    expect(result.keys).toContain('projects/demo/runs/r1/issue.json');
    expect(result.keys).toContain('projects/demo/runs/r1/manifest.json');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** (uses `PutObjectCommand`; accepts injected `readFile` for testability):

```ts
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvidenceBundleManifest } from '@contractqa/core';

export interface UploadBundleInput {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
  localDir: string;
  manifest: EvidenceBundleManifest;
  readFile?: (p: string) => Promise<Buffer>;
}

export interface UploadResult {
  uploaded: number;
  keys: string[];
}

export async function uploadBundleToS3(input: UploadBundleInput): Promise<UploadResult> {
  const read = input.readFile ?? fsReadFile;
  const keys: string[] = [];
  for (const f of input.manifest.files) {
    const body = await read(path.join(input.localDir, f.path));
    const key = `${input.keyPrefix}/${f.path}`;
    await input.client.send(new PutObjectCommand({ Bucket: input.bucket, Key: key, Body: body }));
    keys.push(key);
  }
  const manifestKey = `${input.keyPrefix}/manifest.json`;
  await input.client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: manifestKey,
      Body: Buffer.from(JSON.stringify(input.manifest, null, 2)),
      ContentType: 'application/json',
    }),
  );
  keys.push(manifestKey);
  return { uploaded: keys.length, keys };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(evidence): S3 upload via @aws-sdk/client-s3"
```

---

## Task 20: `@contractqa/runner` — verifiedAction wrapper

**Files:**
- Create: `packages/runner/package.json`, `tsconfig.json`, `src/index.ts`, `src/verified-action.ts`, `tests/verified-action.test.ts`

Implements §9.1.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { verifiedAction } from '../src/verified-action.js';

describe('verifiedAction', () => {
  it('takes before snapshot, runs action, takes after snapshot, evaluates effects', async () => {
    const before = vi.fn().mockResolvedValue({ url: '/a', localStorageKeys: ['x'], cookies: [] });
    const after = vi.fn().mockResolvedValue({ url: '/b', localStorageKeys: [], cookies: [] });
    const action = vi.fn().mockResolvedValue(undefined);

    const r = await verifiedAction({
      name: 'auth.logout',
      before,
      action,
      after,
      expectedEffects: [
        { name: 'redirectedToLogin', check: (b, a) => a.url !== b.url },
        { name: 'sbCleared', check: (_, a) => !a.localStorageKeys.includes('sb-x') },
      ],
    });

    expect(before).toHaveBeenCalled();
    expect(action).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(r.results).toEqual([
      { name: 'redirectedToLogin', passed: true },
      { name: 'sbCleared', passed: true },
    ]);
  });

  it('flags effect violations', async () => {
    const r = await verifiedAction({
      name: 'auth.logout',
      before: async () => ({ url: '/a', localStorageKeys: ['sb-x'], cookies: [] }),
      action: async () => {},
      after: async () => ({ url: '/a', localStorageKeys: ['sb-x'], cookies: [] }),
      expectedEffects: [{ name: 'urlChanged', check: (b, a) => b.url !== a.url }],
    });
    expect(r.results[0].passed).toBe(false);
  });
});
```

- [ ] **Step 2: Write `package.json`** (deps: core, oracle, evidence, probes, `@playwright/test`).

- [ ] **Step 3: Implement**

```ts
import type { StateSlice } from '@contractqa/oracle';

export interface ExpectedEffect {
  name: string;
  check: (before: StateSlice, after: StateSlice) => boolean | Promise<boolean>;
}

export interface VerifiedActionInput {
  name: string;
  before: () => Promise<StateSlice>;
  action: () => Promise<void>;
  after: () => Promise<StateSlice>;
  expectedEffects: ExpectedEffect[];
}

export interface VerifiedActionResult {
  name: string;
  before: StateSlice;
  after: StateSlice;
  results: Array<{ name: string; passed: boolean }>;
}

export async function verifiedAction(input: VerifiedActionInput): Promise<VerifiedActionResult> {
  const before = await input.before();
  await input.action();
  const after = await input.after();
  const results = [];
  for (const e of input.expectedEffects) {
    results.push({ name: e.name, passed: !!(await e.check(before, after)) });
  }
  return { name: input.name, before, after, results };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git add packages/runner
git commit -m "feat(runner): verifiedAction wrapper (§9.1)"
```

---

## Task 21: YAML contract loader (compiles to Playwright Test)

**Files:**
- Create: `packages/runner/src/loader.ts`, `packages/runner/tests/loader.test.ts`
- Add dep: `yaml`

Implements §9.0 — contract YAML → Playwright Test via custom loader. The loader produces a list of test definitions (test title + a runnable function) that the reporter (Task 22) and a Playwright project config consume.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { loadContractsFromDir } from '../src/loader.js';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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
    expect(contracts[0].id).toBe('INV-A2');
  });

  it('throws when YAML violates schema', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-yml-'));
    await writeFile(path.join(dir, 'bad.yml'), `id: NO-PREFIX\nseverity: P9`);
    await expect(loadContractsFromDir(dir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { ContractSchema, type ContractDoc } from '@contractqa/core';

export async function loadContractsFromDir(dir: string): Promise<ContractDoc[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: ContractDoc[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.yml')) continue;
    const raw = await readFile(path.join(dir, e.name), 'utf8');
    const parsed = parse(raw);
    out.push(ContractSchema.parse(parsed));
  }
  return out;
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(runner): YAML contract loader with Zod validation"
```

---

## Task 22: Contract → Playwright test compiler

**Files:**
- Create: `packages/runner/src/compile.ts`, `packages/runner/tests/compile.test.ts`

Translates a `ContractDoc` into a Playwright Test by emitting `test('<id>: <title>', async ({ page, context }) => { ... })`. The compiler returns a string of TypeScript that a Playwright test file can `eval` via dynamic `require`, OR more cleanly, returns an in-memory test factory the runner calls programmatically.

Decision: factory function (no source emission). Each contract → one `(test, page) => Promise<void>` thunk.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { compileContract } from '../src/compile.js';

const contract: any = {
  id: 'INV-A2',
  title: 'logout blocks /agents',
  area: 'auth',
  severity: 'P0',
  preconditions: { auth_state: 'logged_in', role: 'normal_user' },
  actions: [
    { type: 'goto', path: '/lobby' },
    { type: 'click', target: { role: 'button', name_regex: 'logout' } },
    { type: 'goto', path: '/agents' },
  ],
  expected: { url: { matches: '^/login' } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
};

describe('compileContract', () => {
  it('returns a thunk that performs actions in order', async () => {
    const calls: string[] = [];
    const page = {
      goto: vi.fn(async (p: string) => calls.push(`goto:${p}`)),
      getByRole: () => ({ click: vi.fn(async () => calls.push('click')) }),
      url: () => '/login',
      waitForTimeout: vi.fn(async () => {}),
    } as any;
    const thunk = compileContract(contract);
    await thunk({ page, snapshot: async () => ({ url: '/login', localStorageKeys: [], cookies: [] }) });
    expect(calls).toEqual(['goto:/lobby', 'click', 'goto:/agents']);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { ContractDoc } from '@contractqa/core';
import type { StateSlice } from '@contractqa/oracle';

export interface CompiledContext {
  page: any;
  snapshot: () => Promise<StateSlice>;
}

export type CompiledContract = (ctx: CompiledContext) => Promise<{ before: StateSlice; after: StateSlice }>;

export function compileContract(c: ContractDoc): CompiledContract {
  return async (ctx) => {
    const before = await ctx.snapshot();
    for (const a of c.actions) {
      if (a.type === 'goto') {
        await ctx.page.goto(a.path);
      } else if (a.type === 'click') {
        const opts: { name?: RegExp } = {};
        if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
        await ctx.page.getByRole(a.target.role ?? 'button', opts).click();
      } else if (a.type === 'fill') {
        const opts: { name?: RegExp } = {};
        if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
        await ctx.page.getByRole(a.target.role ?? 'textbox', opts).fill(a.value);
      } else if (a.type === 'wait') {
        await ctx.page.waitForTimeout(a.ms);
      }
    }
    if (c.verification.wait_ms > 0) await ctx.page.waitForTimeout(c.verification.wait_ms);
    const after = await ctx.snapshot();
    return { before, after };
  };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(runner): compile contract YAML into Playwright thunk"
```

---

## Task 23: Playwright test entrypoint + reporter

**Files:**
- Create: `packages/runner/src/playwright-entry.ts` (consumed by host project's `playwright.config.ts`), `packages/runner/src/reporter.ts`, `packages/runner/tests/reporter.test.ts`

The entrypoint registers one Playwright `test()` per loaded contract. The reporter implements Playwright's `Reporter` interface and writes evidence bundles via `@contractqa/evidence`.

- [ ] **Step 1: Write failing test (reporter unit)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ContractQAReporter } from '../src/reporter.js';

describe('ContractQAReporter', () => {
  it('writes a bundle on test failure with attached evidence', async () => {
    const writer = vi.fn().mockResolvedValue({ bundle_id: 'b', files: [] });
    const r = new ContractQAReporter({ artifactsRoot: '/tmp', writer });
    const fakeResult = {
      status: 'failed',
      errors: [{ message: 'INV-A2 violated' }],
      attachments: [
        { name: 'evidence:state-diff', path: '/tmp/sd.json', contentType: 'application/json' },
        { name: 'evidence:trace', path: '/tmp/trace.zip', contentType: 'application/zip' },
      ],
    };
    const fakeTest = { title: 'INV-A2: logout' };
    await (r as any).onTestEnd(fakeTest, fakeResult);
    expect(writer).toHaveBeenCalled();
    const arg = writer.mock.calls[0][0];
    expect(arg.contractId).toBe('INV-A2');
    expect(Object.keys(arg.files)).toContain('diffs/state-diff.json');
    expect(Object.keys(arg.files)).toContain('trace.zip');
  });

  it('skips PASS tests', async () => {
    const writer = vi.fn();
    const r = new ContractQAReporter({ artifactsRoot: '/tmp', writer });
    await (r as any).onTestEnd({ title: 'INV-A2: ok' }, { status: 'passed', attachments: [] });
    expect(writer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement reporter**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { writeEvidenceBundle, type WriteBundleInput } from '@contractqa/evidence';

export interface ReporterOptions {
  artifactsRoot: string;
  writer?: (i: WriteBundleInput) => Promise<unknown>;
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
  constructor(private opts: ReporterOptions) {
    this.writer = opts.writer ?? writeEvidenceBundle;
  }

  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    if (result.status !== 'failed' && result.status !== 'timedOut') return;
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
```

- [ ] **Step 4: Implement `playwright-entry.ts`**

```ts
import { test } from '@playwright/test';
import { loadContractsFromDir } from './loader.js';
import { compileContract } from './compile.js';

export async function registerContracts(dir: string): Promise<void> {
  const contracts = await loadContractsFromDir(dir);
  for (const c of contracts) {
    const thunk = compileContract(c);
    test(`${c.id}: ${c.title}`, async ({ page, context }) => {
      const snapshot = async () => ({
        url: page.url(),
        localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
        cookies: (await context.cookies()).map((x) => x.name),
      });
      await thunk({ page, snapshot });
      // Verdict + evidence emission happens via reporter; oracle runs in fixture hook (Task 24).
    });
  }
}
```

- [ ] **Step 5: Run, expect pass. Commit.**

```bash
git commit -am "feat(runner): Playwright reporter + contract registration entrypoint"
```

---

## Task 24: Playwright fixture — oracle hook + evidence attachments

**Files:**
- Create: `packages/runner/src/fixtures.ts`, `packages/runner/tests/fixtures.test.ts`

Wires the oracle to each contract test, attaches state-diff JSON and snapshots so the reporter can pick them up.

- [ ] **Step 1: Write failing test (uses Playwright `test.extend` mocked)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runOracle } from '../src/fixtures.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NOISE = {
  project: 'x',
  generated_at: '2026-05-14T00:00:00Z',
  ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [] },
};

describe('runOracle', () => {
  it('returns FAIL and attaches state-diff when expectations violated', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cqa-fx-'));
    const attach = vi.fn();
    const r = await runOracle({
      contract: {
        id: 'INV-A2', title: 'x', area: 'auth', severity: 'P0',
        risk_tags: [], preconditions: {},
        actions: [], expected: { url: { matches: '^/login$' } },
        verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
      },
      before: { url: '/x', localStorageKeys: [], cookies: [] },
      after: { url: '/agents', localStorageKeys: [], cookies: [] },
      noise: NOISE,
      missingCapabilities: [],
      attach,
      tmpDir: dir,
    });
    expect(r.verdict).toBe('FAIL');
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'evidence:state-diff', path: expect.any(String) }),
    );
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContractDoc, NoiseProfile } from '@contractqa/core';
import { computeStateDiff, classifyDiff, computeVerdict } from '@contractqa/oracle';
import type { StateSlice } from '@contractqa/oracle';

export interface RunOracleInput {
  contract: ContractDoc;
  before: StateSlice;
  after: StateSlice;
  noise: NoiseProfile;
  missingCapabilities: string[];
  attach: (info: { name: string; path: string; contentType: string }) => void;
  tmpDir: string;
}

export async function runOracle(input: RunOracleInput) {
  const diff = computeStateDiff(input.before, input.after);
  const classified = classifyDiff(diff, input.contract.expected as never, input.noise);
  const verdict = computeVerdict({
    runs: [{ failContributions: classified.failContributions, evidence: { state_diff: true } }],
    requiredEvidence: input.contract.verification.evidence_required,
    missingCapabilities: input.missingCapabilities,
    severity: input.contract.severity,
  });

  const diffPath = path.join(input.tmpDir, 'state-diff.json');
  writeFileSync(diffPath, JSON.stringify({ diff, classified, verdict }, null, 2));
  input.attach({ name: 'evidence:state-diff', path: diffPath, contentType: 'application/json' });
  return verdict;
}
```

- [ ] **Step 4: Update `packages/runner/src/index.ts`** to re-export the runner public surface:

```ts
export { loadContractsFromDir } from './loader.js';
export { compileContract, type CompiledContract, type CompiledContext } from './compile.js';
export { verifiedAction, type VerifiedActionInput, type VerifiedActionResult, type ExpectedEffect } from './verified-action.js';
export { ContractQAReporter } from './reporter.js';
export { runOracle, type RunOracleInput } from './fixtures.js';
export { defineConfig, type ContractQAConfig } from './config.js';
export { registerContracts } from './playwright-entry.js';
```

- [ ] **Step 5: Run, expect pass. Commit.**

```bash
git commit -am "feat(runner): oracle fixture hook with evidence attachments + public exports"
```

---

## Task 25: `@contractqa/repro` — minimal repro generator

**Files:**
- Create: `packages/repro/package.json`, `tsconfig.json`, `src/index.ts`, `src/generator.ts`, `tests/generator.test.ts`

Implements §12. Generates `repro.spec.ts` from a `ContractDoc` + run-time data (login role, evidence path). Asserts invariants — never the buggy actual.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { generateRepro } from '../src/generator.js';

const c: any = {
  id: 'INV-A2',
  title: 'logout blocks /agents',
  area: 'auth',
  severity: 'P0',
  preconditions: { auth_state: 'logged_in', role: 'normal_user' },
  actions: [
    { type: 'goto', path: '/lobby' },
    { type: 'click', target: { role: 'button', name_regex: 'logout' } },
    { type: 'goto', path: '/agents' },
  ],
  expected: { url: { matches: '^/login' }, auth_state: { fully_logged_out: true } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
};

describe('generateRepro', () => {
  it('emits Playwright test asserting expected, not actual', () => {
    const src = generateRepro({ contract: c, authProvider: 'supabase' });
    expect(src).toContain("import { test, expect } from '@playwright/test'");
    expect(src).toContain("loginAs(page, 'normal_user')");
    expect(src).toContain("await page.goto('/lobby')");
    expect(src).toContain("await page.goto('/agents')");
    expect(src).toContain("await expect(page).toHaveURL(/^\\/login/)");
    expect(src).toContain("expect.poll");
    expect(src).not.toContain('// FIXME');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { ContractDoc, AuthProviderName } from '@contractqa/core';

export interface GenerateReproInput {
  contract: ContractDoc;
  authProvider: AuthProviderName;
}

export function generateRepro(input: GenerateReproInput): string {
  const c = input.contract;
  const role = c.preconditions.role ?? 'normal_user';
  const steps: string[] = [];

  for (const a of c.actions) {
    if (a.type === 'goto') steps.push(`  await page.goto(${JSON.stringify(a.path)});`);
    else if (a.type === 'click')
      steps.push(
        `  await page.getByRole(${JSON.stringify(a.target.role ?? 'button')}, { name: ${
          a.target.name_regex ? `/${a.target.name_regex}/i` : `'click'`
        } }).click();`,
      );
    else if (a.type === 'fill')
      steps.push(
        `  await page.getByRole(${JSON.stringify(
          a.target.role ?? 'textbox',
        )}, { name: ${a.target.name_regex ? `/${a.target.name_regex}/i` : `'field'`} }).fill(${JSON.stringify(a.value)});`,
      );
    else if (a.type === 'wait') steps.push(`  await page.waitForTimeout(${a.ms});`);
  }

  const assertions: string[] = [];
  if (c.expected.url?.matches) {
    assertions.push(`  await expect(page).toHaveURL(/${c.expected.url.matches}/);`);
  }
  if (c.expected.localStorage?.no_key_matches) {
    assertions.push(
      `  await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter((k) => /${c.expected.localStorage!.no_key_matches}/.test(k)))).toEqual([]);`,
    );
  }
  if (c.expected.auth_state?.fully_logged_out) {
    assertions.push(`  // auth_state.fully_logged_out is verified by the @contractqa/adapters AuthAdapter (${input.authProvider})`);
    assertions.push(`  const { ${input.authProvider === 'supabase' ? 'SupabaseAuthAdapter' : 'ClerkAuthAdapter'} } = await import('@contractqa/adapters');`);
    assertions.push(
      `  const __auth = new ${input.authProvider === 'supabase' ? 'SupabaseAuthAdapter({ url: process.env.SUPABASE_URL!, anonKey: process.env.SUPABASE_ANON_KEY! })' : 'ClerkAuthAdapter()'};`,
    );
    assertions.push(`  const __r = await __auth.expectFullyLoggedOut(page);`);
    assertions.push(`  expect(__r.fullyLoggedOut, __r.reasons.join('; ')).toBe(true);`);
  }

  return `import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test('${c.id}: ${c.title}', async ({ page }) => {
  await loginAs(page, '${role}');
${steps.join('\n')}
${assertions.join('\n')}
});
`;
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(repro): minimal Playwright repro generator (§12)"
```

---

## Task 26: Reproducer stability gate (2/3 rule)

**Files:**
- Create: `packages/repro/src/stabilizer.ts`, `packages/repro/tests/stabilizer.test.ts`

Implements §12.2.5 — repro must fail ≥ 2/3 runs to be considered stable.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { assertReproducible } from '../src/stabilizer.js';

describe('assertReproducible', () => {
  it('passes when ≥2/3 runs fail', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ failed: true })
      .mockResolvedValueOnce({ failed: false })
      .mockResolvedValueOnce({ failed: true });
    const r = await assertReproducible(run, 3, 2);
    expect(r.stable).toBe(true);
    expect(r.failures).toBe(2);
  });
  it('fails when only 1/3 runs fail', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ failed: false })
      .mockResolvedValueOnce({ failed: true })
      .mockResolvedValueOnce({ failed: false });
    const r = await assertReproducible(run, 3, 2);
    expect(r.stable).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
export interface RunOutcome { failed: boolean }

export async function assertReproducible(
  run: () => Promise<RunOutcome>,
  total: number,
  required: number,
): Promise<{ stable: boolean; failures: number }> {
  let failures = 0;
  for (let i = 0; i < total; i++) {
    const r = await run();
    if (r.failed) failures++;
  }
  return { stable: failures >= required, failures };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(repro): reproducibility 2/3 gate"
```

---

**End of Phase 1b.** Checkpoint: probe, oracle, evidence, runner, repro all green.

Run: `pnpm -r typecheck && pnpm -r test`

---

# Phase 1c — Orchestrator / Dashboard / End-to-End

## Task 27: INVARIANTS.md generator from YAML

**Files:**
- Create: `packages/cli/package.json`, `tsconfig.json`, `bin/contractqa.ts`, `src/commands/invariants-gen.ts`, `tests/invariants-gen.test.ts`

Implements §23.1 "INVARIANTS.md auto-generated from YAML (single source of truth in YAML)".

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderInvariantsMd } from '../src/commands/invariants-gen.js';

describe('renderInvariantsMd', () => {
  it('groups contracts by area with id and title bullets', () => {
    const md = renderInvariantsMd([
      { id: 'INV-A1', title: 'logout clears sb-* keys', area: 'auth', severity: 'P0' } as any,
      { id: 'INV-A2', title: 'protected route redirects', area: 'auth', severity: 'P0' } as any,
      { id: 'INV-L1', title: 'create table broadcasts', area: 'lobby', severity: 'P1' } as any,
    ]);
    expect(md).toMatch(/^# Product Invariants/m);
    expect(md).toMatch(/^## Auth/m);
    expect(md).toMatch(/- INV-A1: logout clears sb-\* keys/);
    expect(md).toMatch(/## Lobby/);
  });
});
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "contractqa",
  "version": "0.1.0",
  "type": "module",
  "bin": { "contractqa": "./dist/bin/contractqa.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src bin tests",
    "test": "vitest run"
  },
  "dependencies": {
    "@contractqa/core": "workspace:*",
    "@contractqa/adapters": "workspace:*",
    "@contractqa/runner": "workspace:*",
    "@contractqa/orchestrator": "workspace:*",
    "@contractqa/repro": "workspace:*",
    "@contractqa/evidence": "workspace:*",
    "@contractqa/probes": "workspace:*",
    "@contractqa/oracle": "workspace:*",
    "commander": "^12.1.0",
    "yaml": "^2.6.1"
  }
}
```

- [ ] **Step 3: Implement renderer**

```ts
import type { ContractDoc } from '@contractqa/core';

const TITLES: Record<string, string> = {
  auth: 'Auth', lobby: 'Lobby', billing: 'Billing', admin: 'Admin', routes: 'Routes',
};

export function renderInvariantsMd(contracts: ContractDoc[]): string {
  const byArea = new Map<string, ContractDoc[]>();
  for (const c of contracts) {
    if (!byArea.has(c.area)) byArea.set(c.area, []);
    byArea.get(c.area)!.push(c);
  }
  const out: string[] = ['# Product Invariants', '', '> Generated from `qa/contracts/*.yml`. Do not edit by hand.', ''];
  for (const [area, list] of [...byArea.entries()].sort()) {
    out.push(`## ${TITLES[area] ?? area}`, '');
    for (const c of list.sort((a, b) => a.id.localeCompare(b.id))) {
      out.push(`- ${c.id}: ${c.title}`);
    }
    out.push('');
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Wire CLI command in `bin/contractqa.ts`**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { loadContractsFromDir } from '@contractqa/runner';
import { renderInvariantsMd } from '../src/commands/invariants-gen.js';

const program = new Command('contractqa');
program
  .command('invariants:gen')
  .option('--contracts <dir>', 'YAML contracts dir', 'qa/contracts')
  .option('--out <path>', 'Output path', 'qa/INVARIANTS.md')
  .action(async (opts) => {
    const contracts = await loadContractsFromDir(opts.contracts);
    await writeFile(opts.out, renderInvariantsMd(contracts));
    console.log(`Wrote ${opts.out} from ${contracts.length} contracts`);
  });

program.parseAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Run test, expect pass. Commit.**

```bash
git add packages/cli
git commit -m "feat(cli): invariants:gen renders INVARIANTS.md from YAML"
```

---

## Task 28: CLI `run` command — runs contracts via Playwright Test

**Files:**
- Create: `packages/cli/src/commands/run.ts`, `packages/cli/tests/run.test.ts`

`contractqa run --changed` and `--all` invoke `playwright test` as a child process, passing the contract dir and reporter through env vars. Phase 1's selection logic for `--changed` is a thin wrapper around `git diff --name-only base...HEAD` that maps changed files to contract IDs via a `risk_tags`/area heuristic (full Risk Engine is Phase 2).

- [ ] **Step 1: Write failing test (selection logic only — child process is integration tested in T34)**

```ts
import { describe, it, expect } from 'vitest';
import { selectChangedContracts } from '../src/commands/run.js';

const contracts: any[] = [
  { id: 'INV-A2', area: 'auth', risk_tags: ['auth', 'protected-route'] },
  { id: 'INV-L1', area: 'lobby', risk_tags: ['lobby'] },
  { id: 'INV-B1', area: 'billing', risk_tags: ['billing'] },
];

describe('selectChangedContracts', () => {
  it('returns auth contracts when src/auth/ changed', () => {
    const sel = selectChangedContracts(contracts, ['src/auth/AuthProvider.tsx']);
    expect(sel.map((c) => c.id)).toEqual(['INV-A2']);
  });
  it('returns all when no files changed (safety default)', () => {
    expect(selectChangedContracts(contracts, []).length).toBe(3);
  });
  it('returns multi-area when several paths changed', () => {
    const sel = selectChangedContracts(contracts, ['src/auth/x.ts', 'app/lobby/page.tsx']);
    expect(sel.map((c) => c.id).sort()).toEqual(['INV-A2', 'INV-L1']);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement selection + run wrapper**

```ts
import { spawn } from 'node:child_process';
import type { ContractDoc } from '@contractqa/core';

const PATH_AREA_MAP: Array<{ pattern: RegExp; area: string }> = [
  { pattern: /(^|\/)auth/i, area: 'auth' },
  { pattern: /lobby/i, area: 'lobby' },
  { pattern: /billing|stripe|subscription/i, area: 'billing' },
  { pattern: /admin/i, area: 'admin' },
  { pattern: /route|middleware/i, area: 'routes' },
];

export function selectChangedContracts(
  contracts: ContractDoc[],
  changedFiles: string[],
): ContractDoc[] {
  if (changedFiles.length === 0) return contracts;
  const areas = new Set<string>();
  for (const f of changedFiles) {
    for (const m of PATH_AREA_MAP) if (m.pattern.test(f)) areas.add(m.area);
  }
  if (areas.size === 0) return contracts;
  return contracts.filter((c) => areas.has(c.area));
}

export async function runContracts(opts: {
  contractsDir: string;
  artifactsRoot: string;
  changedFiles?: string[];
  baseUrl?: string;
}): Promise<{ exitCode: number }> {
  const env = {
    ...process.env,
    CONTRACTQA_CONTRACTS_DIR: opts.contractsDir,
    CONTRACTQA_ARTIFACTS_ROOT: opts.artifactsRoot,
    CONTRACTQA_CHANGED_FILES: opts.changedFiles?.join(',') ?? '',
    ...(opts.baseUrl ? { CONTRACTQA_BASE_URL: opts.baseUrl } : {}),
  };
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'playwright', 'test', '--config=playwright.config.ts'], {
      env, stdio: 'inherit',
    });
    child.on('exit', (code) => resolve({ exitCode: code ?? 1 }));
  });
}
```

- [ ] **Step 4: Wire into `bin/contractqa.ts`**

```ts
program
  .command('run')
  .option('--changed', 'Only contracts impacted by git diff', false)
  .option('--contracts <dir>', 'YAML contracts dir', 'qa/contracts')
  .option('--artifacts <dir>', 'Artifacts root', 'artifacts')
  .action(async (opts) => {
    const changed = opts.changed
      ? require('node:child_process')
          .execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' })
          .split('\n')
          .filter(Boolean)
      : [];
    const r = await (await import('../src/commands/run.js')).runContracts({
      contractsDir: opts.contracts,
      artifactsRoot: opts.artifacts,
      changedFiles: changed,
    });
    process.exit(r.exitCode);
  });
```

- [ ] **Step 5: Run unit test, expect pass. Commit.**

```bash
git commit -am "feat(cli): contractqa run with --changed selection"
```

---

## Task 29: `contractqa init` and `contractqa scan` skeletons

**Files:**
- Create: `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/scan.ts`, `packages/cli/tests/init.test.ts`

Phase 1 scope: `init` writes the qa/ skeleton and `contractqa.config.ts` template; `scan` enumerates Next.js routes and outputs a candidate `routes.yml` (auth/permissions mining is Phase 2 — leave a `TODO scan: auth-mining (Phase 2)` doc string).

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/commands/init.js';

describe('initProject', () => {
  it('creates qa/ skeleton + config template', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-'));
    await initProject({ cwd: dir, provider: 'supabase' });
    await stat(path.join(dir, 'qa', 'INVARIANTS.md'));
    await stat(path.join(dir, 'qa', 'contracts'));
    await stat(path.join(dir, 'qa', 'noise-profile.yml'));
    const cfg = await readFile(path.join(dir, 'contractqa.config.ts'), 'utf8');
    expect(cfg).toContain("provider: 'supabase'");
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `initProject`** (writes files literally, no template engine):

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthProviderName } from '@contractqa/core';

export async function initProject(opts: { cwd: string; provider: AuthProviderName }): Promise<void> {
  const qa = path.join(opts.cwd, 'qa');
  await mkdir(path.join(qa, 'contracts'), { recursive: true });
  await mkdir(path.join(qa, 'adapters'), { recursive: true });
  await writeFile(path.join(qa, 'INVARIANTS.md'), '# Product Invariants\n\n_(generated, run `contractqa invariants:gen`)_\n');
  await writeFile(
    path.join(qa, 'noise-profile.yml'),
    `project: ${path.basename(opts.cwd)}\ngenerated_at: ${new Date().toISOString()}\nignore: {}\n`,
  );
  await writeFile(
    path.join(opts.cwd, 'contractqa.config.ts'),
    `import { defineConfig } from '@contractqa/runner';
export default defineConfig({
  app: { baseUrl: 'http://localhost:3000', healthCheckUrl: 'http://localhost:3000/api/health' },
  auth: { provider: '${opts.provider}' },
  contracts: { dir: 'qa/contracts', invariants: 'qa/INVARIANTS.md', noiseProfile: 'qa/noise-profile.yml' },
  artifacts: { root: 'artifacts', s3: null },
  pipelines: {
    critical_path: { blocking: true, timeoutSeconds: 300 },
    shadow_fix: { blocking: false, timeoutSeconds: 1800, maxFixAttempts: 3 },
  },
});
`,
  );
}
```

- [ ] **Step 4: Add `defineConfig` to `@contractqa/runner`**

`packages/runner/src/config.ts`:
```ts
import type { AuthProviderName } from '@contractqa/core';
export interface ContractQAConfig {
  app: { baseUrl: string; startCommand?: string; healthCheckUrl: string };
  auth: { provider: AuthProviderName };
  contracts: { dir: string; invariants: string; noiseProfile: string };
  artifacts: { root: string; s3: { bucket: string; endpoint?: string } | null };
  pipelines: {
    critical_path: { blocking: boolean; timeoutSeconds: number };
    shadow_fix: { blocking: boolean; timeoutSeconds: number; maxFixAttempts: number };
  };
}
export function defineConfig(c: ContractQAConfig): ContractQAConfig { return c; }
```

Add to `runner/src/index.ts`:
```ts
export { defineConfig, type ContractQAConfig } from './config.js';
```

- [ ] **Step 5: Run test, expect pass. Commit.**

```bash
git commit -am "feat(cli): contractqa init + defineConfig helper"
```

---

## Task 30: `@contractqa/orchestrator` — git worktree isolation

**Files:**
- Create: `packages/orchestrator/package.json`, `tsconfig.json`, `src/index.ts`, `src/worktree.ts`, `tests/worktree.test.ts`

Per §13.2 and §17.0.2 — each fix attempt runs in its own isolated worktree.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFixWorktree } from '../src/worktree.js';

describe('createFixWorktree', () => {
  it('invokes git worktree add with isolated branch name', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const r = await createFixWorktree({
      repoRoot: '/repo',
      issueId: 'AUTH-LOGOUT-001',
      worktreeRoot: '/tmp/cqa-wt',
      baseBranch: 'main',
      exec,
    });
    const cmds = exec.mock.calls.map((c) => c[0]);
    expect(cmds.some((c) => c.includes('worktree add'))).toBe(true);
    expect(cmds.some((c) => c.includes('contractqa-fix/AUTH-LOGOUT-001'))).toBe(true);
    expect(r.path).toContain('AUTH-LOGOUT-001');
    expect(r.branch).toBe('contractqa-fix/AUTH-LOGOUT-001');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import path from 'node:path';
import { exec as nodeExec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(nodeExec);

export interface FixWorktree {
  path: string;
  branch: string;
  remove: () => Promise<void>;
}

export interface CreateFixWorktreeInput {
  repoRoot: string;
  issueId: string;
  worktreeRoot: string;
  baseBranch: string;
  exec?: (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;
}

export async function createFixWorktree(input: CreateFixWorktreeInput): Promise<FixWorktree> {
  const run = input.exec ?? ((c, o) => execAsync(c, o) as any);
  const branch = `contractqa-fix/${input.issueId}`;
  const dest = path.join(input.worktreeRoot, input.issueId);
  await run(`git worktree add -b ${branch} ${dest} ${input.baseBranch}`, { cwd: input.repoRoot });
  return {
    path: dest,
    branch,
    remove: async () => {
      await run(`git worktree remove --force ${dest}`, { cwd: input.repoRoot });
      await run(`git branch -D ${branch}`, { cwd: input.repoRoot }).catch(() => undefined);
    },
  };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git add packages/orchestrator
git commit -m "feat(orchestrator): isolated git worktree per fix attempt"
```

---

## Task 31: Claude Code subprocess wrapper

**Files:**
- Create: `packages/orchestrator/src/claude-code.ts`, `packages/orchestrator/tests/claude-code.test.ts`

Implements §13.2 — `claude --bare -p <prompt> --allowedTools "Read,Edit,Bash,Grep,Glob" --output-format json`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runClaudeFix } from '../src/claude-code.js';

describe('runClaudeFix', () => {
  it('spawns claude with --bare, allowed tools, prompt from issue bundle', async () => {
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        root_cause: 'session cleanup missing',
        files_changed: ['src/auth.ts'],
        tests_run: ['repro'],
        validation_result: 'PASS',
      }),
    });
    const r = await runClaudeFix({
      promptPath: '/tmp/fix-prompt.md',
      cwd: '/tmp/wt',
      allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
      spawn,
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      expect.arrayContaining(['--bare', '-p', '/tmp/fix-prompt.md', '--allowedTools', 'Read,Edit,Bash,Grep,Glob', '--output-format', 'json']),
      expect.objectContaining({ cwd: '/tmp/wt' }),
    );
    expect(r.validation_result).toBe('PASS');
  });

  it('returns parse error when stdout is not JSON', async () => {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'not json' });
    const r = await runClaudeFix({ promptPath: '/p', cwd: '/c', allowedTools: ['Read'], spawn });
    expect(r.validation_result).toBe('PARSE_ERROR');
  });

  it('returns FAIL when exit code non-zero', async () => {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 2, stdout: '' });
    const r = await runClaudeFix({ promptPath: '/p', cwd: '/c', allowedTools: ['Read'], spawn });
    expect(r.validation_result).toBe('FAIL');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import { spawn as nodeSpawn } from 'node:child_process';

export interface ClaudeFixInput {
  promptPath: string;
  cwd: string;
  allowedTools: string[];
  spawn?: (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ exitCode: number; stdout: string }>;
  claudeBin?: string;
}

export interface ClaudeFixResult {
  root_cause?: string;
  files_changed?: string[];
  tests_run?: string[];
  validation_result: 'PASS' | 'FAIL' | 'PARSE_ERROR';
  proposed_contract_revision?: unknown;
  raw_stdout: string;
}

export async function runClaudeFix(i: ClaudeFixInput): Promise<ClaudeFixResult> {
  const run = i.spawn ?? defaultSpawn;
  const args = ['--bare', '-p', i.promptPath, '--allowedTools', i.allowedTools.join(','), '--output-format', 'json'];
  const { exitCode, stdout } = await run(i.claudeBin ?? 'claude', args, { cwd: i.cwd });
  if (exitCode !== 0) return { validation_result: 'FAIL', raw_stdout: stdout };
  try {
    const parsed = JSON.parse(stdout);
    return { ...parsed, validation_result: parsed.validation_result ?? 'PASS', raw_stdout: stdout };
  } catch {
    return { validation_result: 'PARSE_ERROR', raw_stdout: stdout };
  }
}

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string }) {
  return new Promise<{ exitCode: number; stdout: string }>((resolve) => {
    const proc = nodeSpawn(cmd, args, { cwd: opts.cwd });
    let stdout = '';
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.on('exit', (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(orchestrator): Claude Code --bare wrapper with JSON output"
```

---

## Task 32: Fix-loop with maxFixAttempts

**Files:**
- Create: `packages/orchestrator/src/fix-loop.ts`, `packages/orchestrator/tests/fix-loop.test.ts`

Implements §13.2 `maxFixAttempts: 3` and §13.1.1 contract-revision escape valve.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runFixLoop } from '../src/fix-loop.js';

describe('runFixLoop', () => {
  it('returns SUCCESS on first attempt when validation_result PASS', async () => {
    const fix = vi.fn().mockResolvedValue({ validation_result: 'PASS', raw_stdout: '' });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.attempts).toBe(1);
  });

  it('retries until PASS within maxAttempts', async () => {
    const fix = vi.fn()
      .mockResolvedValueOnce({ validation_result: 'FAIL', raw_stdout: '' })
      .mockResolvedValueOnce({ validation_result: 'FAIL', raw_stdout: '' })
      .mockResolvedValueOnce({ validation_result: 'PASS', raw_stdout: '' });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.attempts).toBe(3);
  });

  it('returns EXHAUSTED after maxAttempts FAIL', async () => {
    const fix = vi.fn().mockResolvedValue({ validation_result: 'FAIL', raw_stdout: '' });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('EXHAUSTED');
    expect(r.attempts).toBe(3);
  });

  it('returns CONTRACT_REVISION_NEEDED and stops when escape valve emitted', async () => {
    const fix = vi.fn().mockResolvedValue({
      validation_result: 'FAIL',
      proposed_contract_revision: { invariant_id: 'INV-L2' },
      raw_stdout: '',
    });
    const r = await runFixLoop({ maxAttempts: 3, fix });
    expect(r.outcome).toBe('CONTRACT_REVISION_NEEDED');
    expect(r.attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type { ClaudeFixResult } from './claude-code.js';

export interface FixLoopInput {
  maxAttempts: number;
  fix: (attempt: number) => Promise<ClaudeFixResult>;
}

export type FixOutcome = 'SUCCESS' | 'EXHAUSTED' | 'CONTRACT_REVISION_NEEDED' | 'PARSE_ERROR';

export interface FixLoopResult {
  outcome: FixOutcome;
  attempts: number;
  history: ClaudeFixResult[];
}

export async function runFixLoop(i: FixLoopInput): Promise<FixLoopResult> {
  const history: ClaudeFixResult[] = [];
  for (let a = 1; a <= i.maxAttempts; a++) {
    const r = await i.fix(a);
    history.push(r);
    if (r.proposed_contract_revision) return { outcome: 'CONTRACT_REVISION_NEEDED', attempts: a, history };
    if (r.validation_result === 'PARSE_ERROR') return { outcome: 'PARSE_ERROR', attempts: a, history };
    if (r.validation_result === 'PASS') return { outcome: 'SUCCESS', attempts: a, history };
  }
  return { outcome: 'EXHAUSTED', attempts: i.maxAttempts, history };
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(orchestrator): fix loop with escape valve for contract revision"
```

---

## Task 33: Shadow Fix Pipeline assembly + fix-prompt template

**Files:**
- Create: `packages/orchestrator/src/shadow-pipeline.ts`, `packages/orchestrator/src/fix-prompt.ts`, `packages/orchestrator/tests/shadow-pipeline.test.ts`

Glues worktree + claude-code + fix-loop + PR opening into one entrypoint (§17.0.2).

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runShadowFix } from '../src/shadow-pipeline.js';

describe('runShadowFix', () => {
  it('happy path: creates worktree, runs claude, opens fix-PR, removes worktree', async () => {
    const create = vi.fn().mockResolvedValue({ path: '/wt', branch: 'cqa/x', remove: vi.fn() });
    const fix = vi.fn().mockResolvedValue({ validation_result: 'PASS', files_changed: ['src/auth.ts'], raw_stdout: '' });
    const openPR = vi.fn().mockResolvedValue({ url: 'https://github.com/x/pr/1' });
    const r = await runShadowFix({
      issueId: 'AUTH-LOGOUT-001',
      bundlePath: '/art/runs/x',
      baseBranch: 'main',
      repoRoot: '/repo',
      worktreeRoot: '/tmp',
      maxAttempts: 3,
      createWorktree: create,
      runClaude: fix,
      openFixPR: openPR,
      writePromptFile: vi.fn().mockResolvedValue('/tmp/p.md'),
    });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.prUrl).toBe('https://github.com/x/pr/1');
    expect(create).toHaveBeenCalledOnce();
  });

  it('on EXHAUSTED: comments root-cause on original PR, does not open fix-PR', async () => {
    const comment = vi.fn().mockResolvedValue(undefined);
    const r = await runShadowFix({
      issueId: 'x', bundlePath: '/x', baseBranch: 'main', repoRoot: '/r',
      worktreeRoot: '/t', maxAttempts: 3,
      createWorktree: vi.fn().mockResolvedValue({ path: '/wt', branch: 'b', remove: vi.fn() }),
      runClaude: vi.fn().mockResolvedValue({ validation_result: 'FAIL', raw_stdout: '' }),
      openFixPR: vi.fn(),
      commentOnPR: comment,
      originalPrNumber: 42,
      writePromptFile: vi.fn().mockResolvedValue('/p'),
    });
    expect(r.outcome).toBe('EXHAUSTED');
    expect(comment).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`src/fix-prompt.ts`:
```ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFixPromptFile(bundlePath: string, dest: string): Promise<string> {
  const issue = await readFile(path.join(bundlePath, 'issue.json'), 'utf8');
  const body = `You are fixing a product invariant violation.

Rules:
1. Read the issue bundle first.
2. Run the failing repro before editing.
3. Fix production code, not the repro, unless the repro contradicts INVARIANTS.md.
4. Do not weaken product invariants. If the invariant itself is wrong, emit a proposed_contract_revision JSON block (see §13.1.1) and STOP — do not modify product code.
5. Keep the patch minimal.
6. After patching, run:
   - the failing repro
   - related unit tests
   - affected e2e tests
7. Return JSON with root_cause, files_changed, tests_run, validation_result.

Issue bundle:
- issue: ${path.join(bundlePath, 'issue.json')}
- repro: ${path.join(bundlePath, 'repro.spec.ts')}
- state diff: ${path.join(bundlePath, 'diffs', 'state-diff.json')}
- trace: ${path.join(bundlePath, 'trace.zip')}

issue.json contents:
${issue}
`;
  await writeFile(dest, body);
  return dest;
}
```

`src/shadow-pipeline.ts`:
```ts
import path from 'node:path';
import type { FixOutcome } from './fix-loop.js';
import { runFixLoop } from './fix-loop.js';

export interface ShadowFixInput {
  issueId: string;
  bundlePath: string;
  baseBranch: string;
  repoRoot: string;
  worktreeRoot: string;
  maxAttempts: number;
  originalPrNumber?: number;
  createWorktree: (i: { repoRoot: string; issueId: string; worktreeRoot: string; baseBranch: string }) => Promise<{ path: string; branch: string; remove: () => Promise<void> }>;
  runClaude: (i: { promptPath: string; cwd: string; allowedTools: string[] }) => Promise<{ validation_result: 'PASS' | 'FAIL' | 'PARSE_ERROR'; proposed_contract_revision?: unknown; files_changed?: string[]; raw_stdout: string }>;
  openFixPR: (i: { branch: string; baseBranch: string; issueId: string; filesChanged: string[]; originalPrNumber?: number }) => Promise<{ url: string }>;
  commentOnPR?: (i: { prNumber: number; body: string }) => Promise<void>;
  writePromptFile: (bundlePath: string, dest: string) => Promise<string>;
}

export interface ShadowFixResult {
  outcome: FixOutcome;
  prUrl?: string;
  attempts: number;
}

export async function runShadowFix(i: ShadowFixInput): Promise<ShadowFixResult> {
  const wt = await i.createWorktree({
    repoRoot: i.repoRoot, issueId: i.issueId, worktreeRoot: i.worktreeRoot, baseBranch: i.baseBranch,
  });
  try {
    const promptPath = await i.writePromptFile(i.bundlePath, path.join(wt.path, '.contractqa-fix-prompt.md'));
    const loop = await runFixLoop({
      maxAttempts: i.maxAttempts,
      fix: async () => i.runClaude({
        promptPath, cwd: wt.path, allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
      }),
    });
    if (loop.outcome === 'SUCCESS') {
      const pr = await i.openFixPR({
        branch: wt.branch, baseBranch: i.baseBranch, issueId: i.issueId,
        filesChanged: loop.history.at(-1)?.files_changed ?? [],
        originalPrNumber: i.originalPrNumber,
      });
      return { outcome: 'SUCCESS', prUrl: pr.url, attempts: loop.attempts };
    }
    if (loop.outcome === 'EXHAUSTED' && i.originalPrNumber && i.commentOnPR) {
      await i.commentOnPR({
        prNumber: i.originalPrNumber,
        body: `ContractQA shadow-fix exhausted (${loop.attempts}/${i.maxAttempts}). Latest stdout:\n\n\`\`\`\n${loop.history.at(-1)?.raw_stdout ?? ''}\n\`\`\``,
      });
    }
    return { outcome: loop.outcome, attempts: loop.attempts };
  } finally {
    await wt.remove();
  }
}
```

- [ ] **Step 4: Run, expect pass. Commit.**

```bash
git commit -am "feat(orchestrator): shadow fix pipeline assembly + fix-prompt template"
```

---

## Task 34: Dashboard scaffold + Run Overview page (§15.1)

**Files:**
- Create: `apps/dashboard/package.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/runs/page.tsx`, `lib/db.ts`, `drizzle/schema.ts`, `drizzle.config.ts`, `docker/docker-compose.yml`, `docker/seed.sql`

Implements §15.1 Run Overview: trigger type, totals (pass/fail/flaky/inconclusive), cost, duration, browser matrix.

- [ ] **Step 1: Write docker-compose (postgres + minio)**

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: contractqa
      POSTGRES_PASSWORD: contractqa
      POSTGRES_DB: contractqa
    ports: ['5432:5432']
    volumes: ['./seed.sql:/docker-entrypoint-initdb.d/seed.sql']
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ['9000:9000', '9001:9001']
```

- [ ] **Step 2: Write `seed.sql`** matching §18 data model.

```sql
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  repo_url TEXT,
  default_branch TEXT DEFAULT 'main',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  trigger_type TEXT NOT NULL,
  commit_sha TEXT,
  branch TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  totals JSONB
);
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES runs(id),
  title TEXT,
  severity TEXT,
  confidence NUMERIC,
  status TEXT,
  issue_json_path TEXT
);
CREATE TABLE IF NOT EXISTS fix_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES issues(id),
  agent TEXT,
  branch TEXT,
  status TEXT,
  patch_summary TEXT,
  tests_run TEXT[],
  cost_usd NUMERIC
);
```

- [ ] **Step 3: Write `apps/dashboard/package.json`**

```json
{
  "name": "@contractqa/dashboard",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "drizzle-orm": "^0.36.4",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/node": "^22.10.0",
    "drizzle-kit": "^0.28.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 4: Write `lib/db.ts`** (Drizzle client connecting to local postgres).

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://contractqa:contractqa@localhost:5432/contractqa' });
export const db = drizzle(pool, { schema });
```

`drizzle/schema.ts`:
```ts
import { pgTable, uuid, text, timestamp, jsonb, numeric } from 'drizzle-orm/pg-core';

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  triggerType: text('trigger_type').notNull(),
  commitSha: text('commit_sha'),
  branch: text('branch'),
  status: text('status'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  totals: jsonb('totals'),
});

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id'),
  title: text('title'),
  severity: text('severity'),
  confidence: numeric('confidence'),
  status: text('status'),
  issueJsonPath: text('issue_json_path'),
});
```

- [ ] **Step 5: Write `app/runs/page.tsx`**

```tsx
import Link from 'next/link';
import { db } from '../../lib/db.js';
import { runs } from '../../drizzle/schema.js';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const rows = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(50);
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>ContractQA — Recent Runs</h1>
      <table style={{ width: '100%', marginTop: 16 }}>
        <thead>
          <tr>
            <th>Started</th><th>Trigger</th><th>Branch</th><th>Status</th><th>Totals</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.startedAt?.toISOString()}</td>
              <td>{r.triggerType}</td>
              <td>{r.branch}</td>
              <td>{r.status}</td>
              <td>{JSON.stringify(r.totals)}</td>
              <td><Link href={`/issues?run=${r.id}`}>issues</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 6: Write `app/page.tsx`** to redirect to `/runs`:

```tsx
import { redirect } from 'next/navigation';
export default function Home() { redirect('/runs'); }
```

- [ ] **Step 7: Start postgres + minio, verify dashboard boots**

Run:
```bash
docker compose -f docker/docker-compose.yml up -d
pnpm --filter @contractqa/dashboard dev
```

Open `http://localhost:3000/runs` — expected: empty table (no runs yet).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard docker
git commit -m "feat(dashboard): Run Overview page + postgres/minio docker compose"
```

---

## Task 35: Dashboard Issue Detail page (§15.2) + StateDiffViewer

**Files:**
- Create: `apps/dashboard/app/issues/[id]/page.tsx`, `apps/dashboard/components/StateDiffViewer.tsx`, `apps/dashboard/components/EvidenceLinks.tsx`, `apps/dashboard/tests/state-diff-viewer.test.tsx`
- Add deps: `@testing-library/react`, `jsdom`

Implements §15.2: expected vs actual, timeline, state-diff viewer, screenshot/video/trace links, minimal repro, fix attempts.

- [ ] **Step 1: Write failing test (component)**

```tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StateDiffViewer } from '../components/StateDiffViewer.js';

describe('StateDiffViewer', () => {
  it('renders before/after url and grouped localStorage adds/removes', () => {
    render(
      <StateDiffViewer
        diff={{
          url: { before: '/lobby', after: '/agents', changed: true },
          localStorage: { added: ['posthog-id'], removed: ['theme'] },
          cookies: { added: [], removed: ['app_sid'] },
        }}
      />,
    );
    expect(screen.getByText(/url/i)).toBeTruthy();
    expect(screen.getByText('/lobby')).toBeTruthy();
    expect(screen.getByText('/agents')).toBeTruthy();
    expect(screen.getByText(/posthog-id/)).toBeTruthy();
    expect(screen.getByText(/app_sid/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `StateDiffViewer.tsx`**

```tsx
import type { ReactElement } from 'react';

export interface StateDiff {
  url: { before: string; after: string; changed: boolean };
  localStorage: { added: string[]; removed: string[] };
  cookies: { added: string[]; removed: string[] };
}

export function StateDiffViewer({ diff }: { diff: StateDiff }): ReactElement {
  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>State Diff</h3>
      <table>
        <tbody>
          <tr><th>url</th><td>{diff.url.before}</td><td>→</td><td>{diff.url.after}</td></tr>
        </tbody>
      </table>
      <h4>localStorage</h4>
      <ul>{diff.localStorage.added.map((k) => <li key={`a${k}`}>+ {k}</li>)}</ul>
      <ul>{diff.localStorage.removed.map((k) => <li key={`r${k}`}>− {k}</li>)}</ul>
      <h4>cookies</h4>
      <ul>{diff.cookies.added.map((k) => <li key={`ca${k}`}>+ {k}</li>)}</ul>
      <ul>{diff.cookies.removed.map((k) => <li key={`cr${k}`}>− {k}</li>)}</ul>
    </section>
  );
}
```

- [ ] **Step 4: Implement `EvidenceLinks.tsx`**

```tsx
export interface IssueEvidence {
  trace?: string;
  state_diff?: string;
  repro?: string;
  screenshot?: string;
  video?: string;
}
export function EvidenceLinks({ evidence, basePath }: { evidence: IssueEvidence; basePath: string }) {
  const entries = Object.entries(evidence).filter(([, v]) => !!v) as Array<[string, string]>;
  return (
    <ul>
      {entries.map(([k, v]) => (
        <li key={k}><a href={`${basePath}/${v}`} target="_blank" rel="noreferrer">{k}</a></li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Implement `app/issues/[id]/page.tsx`**

```tsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StateDiffViewer } from '../../../components/StateDiffViewer.js';
import { EvidenceLinks } from '../../../components/EvidenceLinks.js';
import { db } from '../../../lib/db.js';
import { issues } from '../../../drizzle/schema.js';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function IssuePage({ params }: { params: { id: string } }) {
  const [row] = await db.select().from(issues).where(eq(issues.id, params.id));
  if (!row) return <main style={{ padding: 24 }}>Not found</main>;
  const issueDir = path.dirname(row.issueJsonPath ?? '');
  const issueJson = JSON.parse(await readFile(row.issueJsonPath!, 'utf8'));
  const diffJson = JSON.parse(
    await readFile(path.join(issueDir, 'diffs', 'state-diff.json'), 'utf8'),
  );
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>{issueJson.title}</h1>
      <p>severity={issueJson.severity} confidence={issueJson.confidence}</p>
      <section>
        <h2>Expected vs Actual</h2>
        <pre>{JSON.stringify({ expected: issueJson.expected, actual: issueJson.actual }, null, 2)}</pre>
      </section>
      <StateDiffViewer diff={diffJson.diff} />
      <h2>Evidence</h2>
      <EvidenceLinks evidence={issueJson.artifacts} basePath={`/artifacts/${path.basename(issueDir)}`} />
      <h2>Minimal Repro</h2>
      <pre>{await readFile(path.join(issueDir, issueJson.artifacts.repro), 'utf8')}</pre>
    </main>
  );
}
```

- [ ] **Step 6: Run test, expect pass. Commit.**

```bash
git commit -am "feat(dashboard): Issue Detail page with StateDiffViewer and EvidenceLinks"
```

---

## Task 36: Fixture app — Next.js + Supabase reproducing the §24 Logout Bug

**Files:**
- Create: `apps/fixture-app/package.json`, `next.config.ts`, `app/login/page.tsx`, `app/lobby/page.tsx`, `app/agents/page.tsx`, `app/api/health/route.ts`, `lib/supabase.ts`, `middleware.ts`

The fixture intentionally ships a Logout Bug: clicking Logout calls `supabase.auth.signOut()` BUT the protected `/agents` route reads from a stale React context that doesn't observe storage clears, AND the middleware doesn't strip the `sb-*` cookie. Outcome: clicking logout, then navigating to `/agents`, leaves you on `/agents` with `sb-*` localStorage still present — exactly the bug ContractQA must catch.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@contractqa/fixture-app",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "next dev -p 4000",
    "build": "next build",
    "start": "next start -p 4000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@supabase/supabase-js": "^2.46.0"
  },
  "devDependencies": { "typescript": "^5.7.2", "@types/react": "^19.0.0" }
}
```

- [ ] **Step 2: Write `lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true } },
);
```

- [ ] **Step 3: Write `app/login/page.tsx`** with email/password form calling `supabase.auth.signInWithPassword`.

- [ ] **Step 4: Write `app/lobby/page.tsx`** with a Logout button that calls `supabase.auth.signOut()` BUT does not also `router.replace('/login')` — the bug is the missing redirect AND the missing client-context refresh.

- [ ] **Step 5: Write `app/agents/page.tsx`** as a "protected" route that reads from a `useUserContext()` hook. The hook is *intentionally* implemented to read from React state initialized at mount and never re-checked, so after logout the page still renders user content.

- [ ] **Step 6: Write `middleware.ts`** that *should* gate `/agents` on Supabase session cookie. Phase 1 fixture leaves it commented out / deliberately broken — the contract will fail because of this.

- [ ] **Step 7: Write `app/api/health/route.ts`** returning `{ ok: true }`.

- [ ] **Step 8: Boot and smoke**

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm --filter @contractqa/fixture-app dev &
curl http://localhost:4000/api/health   # expects {"ok":true}
```

- [ ] **Step 9: Commit**

```bash
git add apps/fixture-app
git commit -m "feat(fixture-app): Next.js + Supabase fixture with deliberate logout bug"
```

---

## Task 37: ContractQA self-contracts (the §24 case)

**Files:**
- Create: `qa/contracts/auth.yml`, `qa/noise-profile.yml`, `qa/INVARIANTS.md` (generated), `qa/adapters/fixture-app.adapter.ts`, `playwright.config.ts`

- [ ] **Step 1: Write `qa/contracts/auth.yml`** matching §7.2 with the v1.2 update (auth_state.fully_logged_out instead of `sb-*`):

```yaml
id: INV-A2
title: Logged-out users cannot access protected routes
area: auth
severity: P0
owner: platform
risk_tags: [auth, protected-route, session]

preconditions:
  auth_state: logged_in
  role: normal_user

actions:
  - { type: goto, path: /lobby }
  - type: click
    target: { role: button, name_regex: "logout|sign out|退出|登出" }
  - { type: goto, path: /agents }

expected:
  url: { matches: "^/login" }
  auth_state: { fully_logged_out: true }

verification:
  wait_ms: 3000
  retries: 2
  evidence_required: [state_diff, trace, screenshot, console, network]
```

- [ ] **Step 2: Generate INVARIANTS.md**

```bash
pnpm exec contractqa invariants:gen --contracts qa/contracts --out qa/INVARIANTS.md
```

Verify file contains `- INV-A2: Logged-out users cannot access protected routes`.

- [ ] **Step 3: Write fixture adapter** wiring `SupabaseAuthAdapter.loginAs` to programmatic login against the fixture app.

`qa/adapters/fixture-app.adapter.ts`:
```ts
import { SupabaseAuthAdapter, DefaultAppAdapter } from '@contractqa/adapters';

export const app = new DefaultAppAdapter({
  baseUrl: 'http://localhost:4000',
  healthCheckUrl: 'http://localhost:4000/api/health',
});

export class FixtureSupabaseAuth extends SupabaseAuthAdapter {
  override async loginAs(role: string, page: any): Promise<void> {
    await page.goto(`${app.baseUrl}/login`);
    await page.getByRole('textbox', { name: /email/i }).fill(`${role}@fixture.test`);
    await page.getByRole('textbox', { name: /password/i }).fill('test-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/lobby/);
  }
}

export const auth = new FixtureSupabaseAuth({
  url: process.env.SUPABASE_URL ?? 'http://localhost:54321',
  anonKey: process.env.SUPABASE_ANON_KEY ?? 'anon',
});
```

- [ ] **Step 4: Write root `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: Math.max(1, Math.min(4, require('node:os').cpus().length)),
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.CONTRACTQA_BASE_URL ?? 'http://localhost:4000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['list'],
    [path.resolve('packages/runner/dist/reporter.js'), { artifactsRoot: 'artifacts' }],
  ],
});
```

- [ ] **Step 5: Write `e2e/helpers/auth.ts`** so generated repros (which import `../helpers/auth`) actually run:

```ts
import type { Page } from '@playwright/test';
import { auth } from '../../qa/adapters/fixture-app.adapter.js';

export async function loginAs(page: Page, role: string): Promise<void> {
  await auth.loginAs(role, page);
}
```

- [ ] **Step 6: Commit**

```bash
git add qa playwright.config.ts e2e/helpers
git commit -m "chore(qa): self-contract for §24 Logout Bug + fixture adapter + repro auth helper"
```

---

## Task 38: End-to-end Phase 1 acceptance — Logout Bug captured

**Files:**
- Create: `e2e/phase1-acceptance.spec.ts`

This is the integration test that ties everything together: boot fixture, login, click logout, navigate to protected route, expect contract FAIL, expect evidence bundle on disk.

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadContractsFromDir, compileContract } from '@contractqa/runner';
import { runOracle } from '@contractqa/runner';
import { app, auth } from '../qa/adapters/fixture-app.adapter.js';
import { writeEvidenceBundle } from '@contractqa/evidence';
import { parse } from 'yaml';
import { readFileSync as rf } from 'node:fs';

test.beforeAll(async () => {
  // assumes `pnpm --filter @contractqa/fixture-app dev` running on :4000
  const res = await fetch(app.healthCheckUrl);
  expect(res.ok).toBe(true);
});

test('§24 Logout Bug is captured as FAIL with full evidence', async ({ page, context }) => {
  const contracts = await loadContractsFromDir('qa/contracts');
  const inv = contracts.find((c) => c.id === 'INV-A2');
  expect(inv).toBeTruthy();

  await auth.loginAs('normal_user', page);

  const snapshot = async () => ({
    url: page.url(),
    localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
    cookies: (await context.cookies()).map((c) => c.name),
  });

  const thunk = compileContract(inv!);
  const { before, after } = await thunk({ page, snapshot });

  const noise = parse(rf('qa/noise-profile.yml', 'utf8'));
  const attachments: Array<{ name: string; path: string; contentType: string }> = [];
  const verdict = await runOracle({
    contract: inv!,
    before, after,
    noise: { ...noise, ignore: { localStorage_keys: [], sessionStorage_keys: [], cookies: [], network_url_patterns: [], console_patterns: [], ...(noise.ignore ?? {}) } },
    missingCapabilities: [],
    attach: (a) => attachments.push(a),
    tmpDir: 'artifacts/tmp',
  });

  expect(verdict.verdict).toBe('FAIL');
  expect(verdict.violations.some((v) => v.message.includes('url'))).toBe(true);

  const bundle = await writeEvidenceBundle({
    runId: `phase1_${Date.now()}`,
    contractId: 'INV-A2',
    artifactsRoot: 'artifacts',
    files: Object.fromEntries(
      attachments.map((a) => [
        a.name === 'evidence:state-diff' ? 'diffs/state-diff.json' : a.name,
        readFileSync(a.path),
      ]),
    ),
  });
  expect(existsSync(path.join('artifacts', 'runs', bundle.run_id, 'manifest.json'))).toBe(true);
  expect(existsSync(path.join('artifacts', 'runs', bundle.run_id, 'diffs', 'state-diff.json'))).toBe(true);
});
```

- [ ] **Step 2: Boot fixture and run**

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm -r build
pnpm --filter @contractqa/fixture-app dev &
sleep 5
pnpm exec playwright install chromium
pnpm exec playwright test e2e/phase1-acceptance.spec.ts
```

Expected: FAIL the contract (verdict=FAIL), but the **Playwright test itself PASSES** because that's what it asserts. Artifacts written under `artifacts/runs/phase1_<ts>/`.

- [ ] **Step 3: Verify evidence bundle on disk**

```bash
ls artifacts/runs/phase1_*/
# Expected: manifest.json, diffs/state-diff.json (at minimum)
cat artifacts/runs/phase1_*/manifest.json | jq '.contract_id'
# Expected: "INV-A2"
```

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test(e2e): Phase 1 acceptance - §24 Logout Bug captured with evidence"
```

---

## Task 39: Repro generation and shadow-fix dry run on the Logout Bug

**Files:**
- Modify: `e2e/phase1-acceptance.spec.ts` (extend) OR new `e2e/phase1-fix-dryrun.spec.ts`

Verifies the §24.4 closed-loop: repro generated → claude-code stub invoked → fix-PR opened (mocked git provider).

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadContractsFromDir } from '@contractqa/runner';
import { generateRepro } from '@contractqa/repro';
import { runShadowFix } from '@contractqa/orchestrator';

test('repro generator + shadow pipeline mocked end-to-end', async () => {
  const contracts = await loadContractsFromDir('qa/contracts');
  const inv = contracts.find((c) => c.id === 'INV-A2')!;
  const src = generateRepro({ contract: inv, authProvider: 'supabase' });
  expect(src).toContain("test('INV-A2:");
  expect(src).toContain("toHaveURL(/^\\/login/)");

  const dir = mkdtempSync(path.join(tmpdir(), 'cqa-fix-'));
  writeFileSync(path.join(dir, 'issue.json'), JSON.stringify({ issue_id: 'AUTH-LOGOUT-001' }));
  writeFileSync(path.join(dir, 'repro.spec.ts'), src);

  const r = await runShadowFix({
    issueId: 'AUTH-LOGOUT-001',
    bundlePath: dir,
    baseBranch: 'main',
    repoRoot: process.cwd(),
    worktreeRoot: path.join(tmpdir(), 'cqa-wt'),
    maxAttempts: 1,
    createWorktree: async () => ({ path: dir, branch: 'cqa/x', remove: async () => {} }),
    runClaude: async () => ({
      validation_result: 'PASS',
      files_changed: ['apps/fixture-app/middleware.ts'],
      raw_stdout: '{}',
    }),
    openFixPR: async () => ({ url: 'https://example.com/pr/1' }),
    writePromptFile: async (_b, dest) => { writeFileSync(dest, '# fix prompt'); return dest; },
  });
  expect(r.outcome).toBe('SUCCESS');
  expect(r.prUrl).toBe('https://example.com/pr/1');
});
```

- [ ] **Step 2: Run, expect pass.** Commit.

```bash
git commit -am "test(e2e): shadow-fix mocked closed loop on §24"
```

---

## Task 40: Phase 1 acceptance dry-run script + smoke

**Files:**
- Create: `scripts/phase1-acceptance.sh`

Single script that runs the entire Phase 1 acceptance checklist from §23.1.

- [ ] **Step 1: Write script**

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "== ContractQA Phase 1 acceptance =="

echo "--- typecheck"
pnpm -r typecheck

echo "--- unit tests"
pnpm -r test

echo "--- build"
pnpm -r build

echo "--- boot infra"
docker compose -f docker/docker-compose.yml up -d
sleep 3

echo "--- boot fixture app"
pnpm --filter @contractqa/fixture-app build
(pnpm --filter @contractqa/fixture-app start &) ; sleep 5
curl -sf http://localhost:4000/api/health > /dev/null

echo "--- generate INVARIANTS.md"
pnpm exec contractqa invariants:gen --contracts qa/contracts --out qa/INVARIANTS.md
grep -q "INV-A2" qa/INVARIANTS.md

echo "--- run contract suite"
pnpm exec playwright install chromium
pnpm exec playwright test

echo "--- evidence bundle exists"
test -d artifacts/runs
test "$(ls artifacts/runs | wc -l)" -gt 0
for d in artifacts/runs/*; do
  test -f "$d/manifest.json"
  test -f "$d/diffs/state-diff.json"
done

echo "--- dashboard build"
pnpm --filter @contractqa/dashboard build

echo "OK — Phase 1 acceptance passed."
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x scripts/phase1-acceptance.sh
./scripts/phase1-acceptance.sh
```

Expected: prints `OK — Phase 1 acceptance passed.`

- [ ] **Step 3: Commit**

```bash
git add scripts/phase1-acceptance.sh
git commit -m "chore: phase1 acceptance smoke script"
```

---

## Task 41: README + acceptance checklist mapping to §23.1

**Files:**
- Create: `README.md`

Phase 1 README enumerates the §23.1 acceptance bullets and maps each to the task that delivered it.

- [ ] **Step 1: Write README**

Sections:
- What is ContractQA (one-paragraph version of §0)
- Quick start (`pnpm install`, `docker compose up -d`, `pnpm --filter @contractqa/fixture-app dev`, `pnpm exec playwright test`)
- Phase 1 acceptance checklist (mirrors §23.1 with checkbox per bullet)
- Layout overview pointing to package boundaries
- Pointer to `docs/superpowers/plans/2026-05-14-contractqa-phase-1.md`

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README + Phase 1 acceptance checklist"
```

---

**End of Phase 1c.** Final checkpoint runs `scripts/phase1-acceptance.sh` from a clean checkout; all green = Phase 1 ships.

---

## Phase 1 acceptance criteria (mapped from §23.1)

| § 23.1 bullet | Delivered by tasks |
|---|---|
| INVARIANTS.md auto-generated from YAML | T27 |
| machine-readable contracts + Zod + safe regex | T3 |
| Playwright Test–based runner (custom test type + reporter) | T21–T24 |
| AppAdapter + AuthAdapter (Supabase / Clerk / NextAuth / Auth0) | T6–T10 |
| Browser state snapshot + streamed write + noise profile | T13–T14 |
| state diff oracle (4-state verdict) | T15–T17 |
| evidence bundle + S3 upload + manifest.json | T18–T19 |
| minimal repro generator (≥ 2/3 reproducibility) | T25–T26 |
| Claude Code fix handoff (Shadow Fix Pipeline §17.0.2) | T30–T33 |
| Dashboard Run Overview + Issue Detail | T34–T35 |
| End-to-end on 5+ real Next.js + supported-auth products | Phase 2 follow-up (fixture proves the loop; T36–T40 lock the case) |

## Out of Phase 1 (documented for reviewer reassurance)

- BackendAdapter (L2): types exist in core (T4) but no implementation — Phase 2.
- Persona Dogfood Engine, Property/Model-based: Phase 3/4.
- Dashboard §15.3–§15.6 (Invariant Editor, Route Graph, Learning Inbox, Audit): Phase 2/5.
- OpenClaw: permanently optional, kill candidate.
- Adapter API open to third parties: internal until v0.5+ per §7.6.5.

## Risk register (for executor)

| Risk | Mitigation in plan |
|---|---|
| Playwright Test version drift breaks reporter API | Pin `^1.49.0`; reporter unit-tested in isolation (T23). |
| Supabase SDK changes session key shape | Patterns live in `SupabaseAuthAdapter` (T7); contracts reference `auth_state.fully_logged_out`, not raw `sb-*`. |
| ReDoS through user YAML | `assertSafeRegex` enforced in core schema (T3) and noise profile (T5). |
| Shadow Pipeline race conditions on shared worktrees | One worktree per `issueId` (T30); cleaned up in `finally`. |
| Dashboard not gated by auth in Phase 1 | Phase 1 dashboard is dev-local only; explicit "do not deploy" note in README. |



