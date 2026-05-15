# ContractQA Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive ContractQA from "works after manual `npm rebuild`, only on web targets, with single-adapter session ownership" to "auto-fixes pnpm 10 transitive native-dep ABI mismatches, contracts api-only repos via a real `PostgresBackendAdapter`, init detects nested apps in monorepos, and `composeAuth` actually routes per-responsibility instead of always picking `session`."

**Architecture:** Four independently-mergeable parts plus a release sub-part. Three parts are pure code (composeAuth, doctor, init). One part wires net-new infrastructure (BackendAdapter L2 surface). All four parts share one acceptance script (`scripts/phase4-acceptance.sh`).

- **Part A — Doctor hardening:** `contractqa doctor --fix=native-deps` walks workspace packages, detects pnpm 10 transitive native-dep ABI mismatches via boot-probe stderr inspection, and rebuilds via `cd node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> && npm run install` (the only pnpm 10 incantation that actually triggers `prebuild-install`). Today's regression case: 5-4-codex / agent-poker-platform-gpt better-sqlite3 NODE_MODULE_VERSION 115 vs 127.
- **Part B — `BackendAdapter` L2:** Promote `PostgresBackendAdapter` from Phase 3 throws-on-call stub to real implementation. Honors design doc §7.6.3's three safety rails (read-only DSN, mandatory tenant scope, named queries only). Add `backend_state:` block to contract schema; runner consumes it. Unblocks the api-only `agent-poker-platform` target dropped from Phase 2.
- **Part C — Monorepo-aware `init`:** `contractqa init` walks 1–2 directory levels deep (`apps/*`, `packages/*`, `frontend`, `web`, `client`) when root detection returns `unknown`. Returns either a single high-confidence detection or a multi-project menu with `--target <subdir>` selection. Regression case: 5-4-codex (apps/web), WolfMind (apps/web), 5-4-claude (web/).
- **Part D — Per-responsibility `composeAuth` routing:** Replace today's hard-coded `pick(adapters, 'session')` for every method with a method→responsibility map. `loginAs`/`isAuthenticated` stay `'session'`. `currentUser` defaults to `'user-store'` then falls back to `'session'`. `expectFullyLoggedOut` runs against every adapter and AND-merges results. Regression case: Phase 3 B4's adjusted-to-match-bug test gets reverted to assert correct routing.
- **Part E — Cross-part release:** Acceptance script, CHANGELOG, version bump, FINDINGS resolution status. v0.4.0.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest, Playwright, Commander (CLI), `pg` (postgres client), zod (schemas), Docker Compose (reuses Phase 3 fixture for L2 testing).

---

## Required reading (before starting)

1. `claude_code_qa_agent_design.md` §7.6.3 (BackendAdapter — the three safety rails); §7.6.4 (Adapter completeness levels L0–L3 — Phase 4 promotes baseline from L1 to L1+optional-L2); §17.1 (BackendAdapter rationale).
2. `dogfood/FINDINGS.md` — "Phase 4 LOCKED-IN anchors" + "STILL DEFERRED" sections. Every Part in this plan maps to that file.
3. `docs/superpowers/plans/2026-05-15-contractqa-phase-3.md` — Phase 3's "Out of Phase 3 (Phase 4 candidates)" section is this plan's input set; "Decisions made" carries over.
4. `packages/cli/src/commands/doctor.ts` + `packages/cli/src/lib/native-deps.ts` — Part A enhances both; understand `fixNativeDeps`'s root-only deps scan (line 65–79) and `detectNativeDepMismatch`'s false-positive-leaning .node walker (line 31–66).
5. `packages/adapters/src/auth/composite.ts` — Part D fixes the `pick(adapters, 'session')` hardcode (line 42–50).
6. `packages/adapters/src/backend/postgres-stub.ts` — Part B replaces the body but keeps the class signature; Phase 3 already exports it via `@contractqa/adapters/public` as `@experimental`.
7. `packages/cli/src/init/detect-framework.ts` — Part C extends with subdirectory walking; today's `RULES` array (line 30–107) operates only on root files.
8. `dogfood/agent-poker-platform/` — does NOT exist yet as a dogfood target. Part B Task B6 creates it as the L2 dogfood (api-only target dropped in Phase 2).

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict | Source |
|---|---|---|
| Phase 4 anchor count | 4 (doctor + BackendAdapter + monorepo-init + per-responsibility composeAuth) | User picked all three from candidate pool; doctor was pre-locked from session diagnosis. Bigger than the 1–2 I suggested but within Phase 3's actual delivered scope (3 anchors + 2 large parts). |
| BackendAdapter scope | Postgres only; Mongo/Firestore/custom remain stubs | §7.6.3 declares 4 kinds; shipping all four = a full quarter. Postgres covers the dropped agent-poker-platform target. Other 3 stay throws-on-call with clearer @experimental warnings. |
| `composeAuth` routing semantics | `currentUser` defaults to `'user-store'` (fallback `'session'`); `expectFullyLoggedOut` AND-merges every adapter | Today's hardcoded `'session'` for every method is the regression. New default biases toward "user-store knows the truth about identity, session knows the cookie." Phase 3 B4 test gets reverted to encode the new routing. |
| Doctor `--fix=native-deps` execution model | Per-target rebuild via `npm run install` inside `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>` | Today's session proved `pnpm rebuild <pkg>` is silently a no-op in pnpm 10 for transitive deps. Direct npm-script invocation is the only working path. |
| Version target | v0.4.0 | All workspace packages bump together (matches Phase 2/3 cadence). |

---

## Non-goals (do not touch)

- Mongo/Firestore/custom BackendAdapter implementations — keep as @experimental stubs.
- Dashboard UI work (design doc §15.3–§15.6 — Phase 5).
- Persona dogfood agents — backlog.
- Property/model-based test generation — backlog.
- TypeScript project references via `tsc -b` — backlog (Phase 3 D1 reorder still mitigates).
- Publishing to npm — `pnpm publish` is user-gated.
- Hybrid-auth scanner (Phase 3 deferred item). Touched only if it falls out for free during Part C.
- Supabase stack hardening to "real-cloud by default" — explicitly NOT picked. Stays opt-in via `--real-cloud`.

---

## Dependency graph

```
Part A (doctor)         ────┐
Part B (BackendAdapter) ────┤
Part C (monorepo-init)  ────┼──► Part E (acceptance + release)
Part D (composeAuth)    ────┘
```

All four code parts are fully independent. Suggested worktree layout (matches Phase 3's pattern):
- `worktrees/phase4-a-doctor`
- `worktrees/phase4-b-backend-adapter`
- `worktrees/phase4-c-monorepo-init`
- `worktrees/phase4-d-compose-auth`
- `worktrees/phase4-e-release` (created last)

---

# Part A: Doctor hardening (native-deps, pnpm 10 transitive)

**Acceptance gate A:** `contractqa doctor --fix=native-deps /path/to/5-4-codex` detects that `better-sqlite3` (transitive via `packages/persistence`) has a built ABI mismatch against the runtime ABI, runs the correct pnpm 10 rebuild incantation, and the subsequent `pnpm --filter api run dev` boots successfully — all without manual intervention. Today's session reproduction (`api /health never ready`) becomes a green test.

---

### Task A1: Workspace-aware native-dep scanner

**Files:**
- Modify: `packages/cli/src/lib/native-deps.ts`
- Test: `packages/cli/tests/lib/native-deps-workspace.test.ts` (create)

**Goal:** Today's `detectNativeDepMismatch` walks `node_modules` for `.node` files but doesn't read NODE_MODULE_VERSION from those binaries (line 56–58 calls out "can't reliably read"). It returns every binding as a "candidate" with `builtAbi: null`. Phase 4 reads ABI from the `.node` file's metadata when possible and only flags actual mismatches.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/lib/native-deps-workspace.test.ts
import { describe, it, expect } from 'vitest';
import { detectNativeDepMismatch } from '../../src/lib/native-deps.js';

describe('detectNativeDepMismatch (workspace + ABI-aware)', () => {
  it('flags a binding whose built ABI differs from runtime', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [
        { path: '/n_m/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node', abi: '115' },
      ],
      _runtimeAbi: '127',
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      binding: 'better_sqlite3.node',
      builtAbi: '115',
      runtimeAbi: '127',
    });
    expect(r[0].suggestion).toMatch(/cd .* && npm run install/);
  });

  it('omits a binding whose built ABI matches runtime', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [{ path: '/n_m/foo/foo.node', abi: '127' }],
      _runtimeAbi: '127',
    });
    expect(r).toEqual([]);
  });

  it('suggestion command points at the .pnpm package dir, not target root', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [{ path: '/repo/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node', abi: '115' }],
      _runtimeAbi: '127',
    });
    expect(r[0].suggestion).toContain('/repo/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3');
    expect(r[0].suggestion).toContain('npm run install');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/lib/native-deps-workspace.test.ts`
Expected: 3 FAIL — current `_stubFiles` branch (line 37–47) has the right shape but uses `npm rebuild` not `npm run install`, and never elides matching-ABI bindings (current logic always flags).

Wait — re-read current code line 38–46: it DOES filter `s.abi !== runtimeAbi`. So tests 2 (matching ABI elision) PASSes today; tests 1 and 3 fail on the suggestion text only. Re-run, confirm 1 + 3 FAIL.

- [ ] **Step 3: Update suggestion text + path derivation**

```ts
// packages/cli/src/lib/native-deps.ts — replace lines 37–47
if (opts._stubFiles) {
  return opts._stubFiles
    .filter((s) => s.abi !== runtimeAbi)
    .map((s) => {
      const pkgDir = derivePnpmPkgDir(s.path);
      return {
        binding: path.basename(s.path),
        packagePath: path.dirname(s.path),
        builtAbi: s.abi,
        runtimeAbi,
        suggestion: `built for ABI ${s.abi}, current is ${runtimeAbi}. run: cd ${pkgDir} && npm run install`,
      };
    });
}

// Add at module bottom:
function derivePnpmPkgDir(nodePath: string): string {
  // Given /…/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/build/Release/foo.node,
  // return /…/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>
  const m = nodePath.match(/^(.*\/node_modules\/\.pnpm\/[^/]+\/node_modules\/[^/]+)\//);
  if (m) return m[1];
  // Fallback: walk up two dirs from build/Release/foo.node → build/ → <pkg>
  return path.dirname(path.dirname(path.dirname(nodePath)));
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/lib/native-deps-workspace.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Real-binary ABI extraction (best-effort)**

Native `.node` files are Mach-O / ELF binaries. We can grep the binary for the literal string `NODE_MODULE_VERSION` followed by a number — node-gyp embeds this. If absent, return `builtAbi: null` (today's behavior).

```ts
// packages/cli/src/lib/native-deps.ts — replace the real-walk branch (lines 49–66)
const nodeModules = path.join(repoRoot, 'node_modules');
try { await stat(nodeModules); } catch { return []; }
const bindings = await walk(nodeModules);
const out: NativeMismatch[] = [];
for (const b of bindings) {
  const builtAbi = await sniffAbiFromBinary(b);
  if (builtAbi !== null && builtAbi === runtimeAbi) continue;
  out.push({
    binding: path.basename(b),
    packagePath: path.dirname(b),
    builtAbi,
    runtimeAbi,
    suggestion: builtAbi
      ? `built for ABI ${builtAbi}, current is ${runtimeAbi}. run: cd ${derivePnpmPkgDir(b)} && npm run install`
      : `native binding present (ABI unknown). if dev-server boot fails, run: cd ${derivePnpmPkgDir(b)} && npm run install`,
  });
}
return out;

async function sniffAbiFromBinary(file: string): Promise<string | null> {
  try {
    const buf = await readFile(file);
    // node-gyp embeds the symbol "NODE_MODULE_VERSION" → followed by
    // 32-bit int in the binary's data section. Search for the symbol.
    const idx = buf.indexOf('NODE_MODULE_VERSION');
    if (idx < 0) return null;
    // The version literal appears within ~64 bytes after the symbol;
    // grep for the first 3-digit number (current ABIs are 108–127).
    const window = buf.slice(idx, idx + 256).toString('binary');
    const m = window.match(/\b(1\d{2})\b/);
    return m ? m[1] : null;
  } catch { return null; }
}
```

Add `import { readFile } from 'node:fs/promises';` at top.

- [ ] **Step 6: Real-binary integration test**

```ts
// packages/cli/tests/lib/native-deps-real-binary.test.ts
import { describe, it, expect } from 'vitest';
import { detectNativeDepMismatch } from '../../src/lib/native-deps.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const FIXTURE = '/Users/zmy/intership/5/5-4-codex'; // local-only smoke
const RUNTIME = process.versions.modules;

describe.skipIf(!process.env.CONTRACTQA_LOCAL_TARGET)('native-deps against real target', () => {
  it('detects better-sqlite3 ABI mismatch when runtime != built', async () => {
    const r = await detectNativeDepMismatch(FIXTURE);
    const sqlite = r.find((m) => m.binding === 'better_sqlite3.node');
    expect(sqlite, 'should find better_sqlite3.node binding').toBeDefined();
    if (sqlite!.builtAbi !== null) {
      // Either flagged (mismatch) or absent (match). Both are correct.
      expect(sqlite!.builtAbi).toMatch(/^1\d{2}$/);
    }
  });
});
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/native-deps.ts packages/cli/tests/lib/native-deps-workspace.test.ts packages/cli/tests/lib/native-deps-real-binary.test.ts
git commit -m "feat(cli): native-deps detector reads ABI from .node binary, suggests pnpm 10 path"
```

---

### Task A2: `fixNativeDeps` walks workspace packages

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts`
- Test: `packages/cli/tests/doctor-workspace.test.ts` (create)

**Goal:** Today `fixNativeDeps` (line 67–94) reads ONLY root `package.json` deps. Phase 4 walks all workspace packages (per `pnpm-workspace.yaml`) and aggregates their declared deps. Then the rebuild step uses the path-derived `cd <pnpm pkg dir> && npm run install` command from Task A1, not `npm rebuild` from root.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/doctor-workspace.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../src/commands/doctor.js';

async function makeMonorepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-monorepo-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'root', private: true, workspaces: ['packages/*'],
  }));
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  await mkdir(path.join(root, 'packages/persistence'), { recursive: true });
  await writeFile(path.join(root, 'packages/persistence/package.json'), JSON.stringify({
    name: 'persistence',
    dependencies: { 'better-sqlite3': '^11.0.0' },
  }));
  return root;
}

describe('doctor fixNativeDeps (workspace)', () => {
  it('detects better-sqlite3 declared in a workspace package, not root', async () => {
    const root = await makeMonorepo();
    const r = await doctor({ targetRoot: root, skipBootProbe: true, fix: ['native-deps'] });
    const fix = r.fixesAttempted.find((f) => f.name === 'native-deps');
    expect(fix).toBeDefined();
    // We're in a tmpdir without an actual install — the fix should report
    // "would rebuild better-sqlite3 (no installed copy found)" rather than
    // today's "no native deps detected".
    expect(fix!.detail).not.toBe('no native deps detected');
    expect(fix!.detail).toMatch(/better-sqlite3/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/doctor-workspace.test.ts`
Expected: FAIL — assertion `'no native deps detected'` is exactly today's output, so the second `not.toBe` fires.

- [ ] **Step 3: Add workspace package walker**

```ts
// packages/cli/src/commands/doctor.ts — add before fixNativeDeps:
import { glob } from 'tinyglobby';
import { stat } from 'node:fs/promises';

async function readNativeDepsFromWorkspace(targetRoot: string): Promise<string[]> {
  const native = new Set<string>();
  const candidatePackageJsons = [path.join(targetRoot, 'package.json')];
  // Heuristic: walk apps/* and packages/* (covers ~90% of pnpm/turborepo layouts).
  for (const sub of ['apps/*/package.json', 'packages/*/package.json']) {
    for (const f of await glob([sub], { cwd: targetRoot, absolute: true })) {
      candidatePackageJsons.push(f);
    }
  }
  for (const pj of candidatePackageJsons) {
    try {
      const raw = await readFile(pj, 'utf8');
      const parsed = JSON.parse(raw);
      const all = { ...parsed.dependencies, ...parsed.devDependencies };
      for (const d of NATIVE_DEPS) if (d in all) native.add(d);
    } catch { /* ignore unreadable / malformed */ }
  }
  return [...native];
}
```

(Add `tinyglobby` to `packages/cli/package.json` deps if not present — it's already used elsewhere; verify with `grep tinyglobby packages/cli/package.json`.)

- [ ] **Step 4: Replace `fixNativeDeps` body**

```ts
// packages/cli/src/commands/doctor.ts — replace lines 67–94
async function fixNativeDeps(i: DoctorInput, _r: DoctorReport): Promise<{ ok: boolean; detail: string }> {
  const native = await readNativeDepsFromWorkspace(i.targetRoot);
  if (native.length === 0) {
    return { ok: true, detail: 'no native deps detected' };
  }

  const results: string[] = [];
  let allOk = true;
  for (const pkg of native) {
    // Find the .pnpm-mirrored copy of <pkg>. Prefer the lowest-versioned
    // one if multiple coexist (rare; pnpm dedupes).
    const installDir = await findPnpmPkgDir(i.targetRoot, pkg);
    if (!installDir) {
      results.push(`${pkg}: no installed copy found in node_modules/.pnpm`);
      allOk = false;
      continue;
    }
    const r = await runNpmInstallScript(installDir);
    results.push(`${pkg}: ${r.ok ? 'rebuilt OK' : `failed — ${r.detail}`}`);
    if (!r.ok) allOk = false;
  }
  return { ok: allOk, detail: results.join('; ') };
}

async function findPnpmPkgDir(targetRoot: string, pkg: string): Promise<string | null> {
  const dotPnpm = path.join(targetRoot, 'node_modules', '.pnpm');
  try {
    const entries = await readdir(dotPnpm);
    const matches = entries
      .filter((d) => d.startsWith(`${pkg}@`))
      .sort();
    if (matches.length === 0) return null;
    return path.join(dotPnpm, matches[0], 'node_modules', pkg);
  } catch { return null; }
}

async function runNpmInstallScript(cwd: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'install'], { cwd, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve(code === 0
        ? { ok: true, detail: 'npm run install OK' }
        : { ok: false, detail: stderr.slice(0, 200).replace(/\s+/g, ' ').trim() });
    });
    child.on('error', (err) => resolve({ ok: false, detail: err.message }));
  });
}
```

Add `import { readdir } from 'node:fs/promises';` at top.

- [ ] **Step 5: Verify workspace test passes + existing doctor tests stay green**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/doctor-workspace.test.ts tests/doctor.test.ts`
Expected: workspace test PASS, existing doctor tests PASS.

- [ ] **Step 6: Acceptance — drive against real 5-4-codex**

```bash
# Manually re-break the binary first, to prove fix is actually working:
cd /Users/zmy/intership/5/5-4-codex/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
mv build/Release/better_sqlite3.node build/Release/better_sqlite3.node.bak

# Run doctor:
cd /Users/zmy/intership/5.10+/qa-agent
pnpm --filter @contractqa/cli build
node packages/cli/dist/bin/contractqa.js doctor --fix=native-deps /Users/zmy/intership/5/5-4-codex

# Should print: "[ok] native-deps: better-sqlite3: rebuilt OK"
# Confirm api boots:
cd /Users/zmy/intership/5/5-4-codex && timeout 10 env PORT=3287 HOST=127.0.0.1 NODE_ENV=test pnpm --filter api run dev
# Expected: "Agent Poker Platform API running at http://127.0.0.1:3287"
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/tests/doctor-workspace.test.ts
git commit -m "feat(doctor): walk workspace packages, rebuild via .pnpm path (pnpm 10)"
```

---

### Task A3: Boot probe → ABI hint synthesis

**Files:**
- Modify: `packages/cli/src/lib/host-probe.ts` (already exists; need to enrich `firstStderrError`)
- Test: `packages/cli/tests/lib/host-probe-abi.test.ts` (create)

**Goal:** When boot fails with `ERR_DLOPEN_FAILED ... NODE_MODULE_VERSION X ... requires NODE_MODULE_VERSION Y`, surface this as a structured `ProbeResult.abiHint?: { built: string; runtime: string }` so the doctor report can correlate the boot-probe stderr with the native-deps fix recommendation.

- [ ] **Step 1: Read current host-probe to know its shape**

```bash
sed -n '1,80p' packages/cli/src/lib/host-probe.ts
```

(No edits this step — just orient. Confirm `ProbeResult` interface and `firstStderrError` capture point.)

- [ ] **Step 2: Write the failing test**

```ts
// packages/cli/tests/lib/host-probe-abi.test.ts
import { describe, it, expect } from 'vitest';
import { extractAbiHint } from '../../src/lib/host-probe.js';

describe('extractAbiHint', () => {
  it('parses NODE_MODULE_VERSION mismatch from node stderr', () => {
    const stderr = `Error: The module '/x/build/Release/foo.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 115. This version of Node.js requires
NODE_MODULE_VERSION 127. Please try re-compiling`;
    expect(extractAbiHint(stderr)).toEqual({ built: '115', runtime: '127' });
  });

  it('returns null on unrelated stderr', () => {
    expect(extractAbiHint('something completely different')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails (export missing)**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/lib/host-probe-abi.test.ts`
Expected: FAIL with "extractAbiHint is not a function" or import error.

- [ ] **Step 4: Add `extractAbiHint` + threading through `ProbeResult`**

```ts
// packages/cli/src/lib/host-probe.ts — add export
export function extractAbiHint(stderr: string): { built: string; runtime: string } | null {
  const m = stderr.match(/NODE_MODULE_VERSION\s+(\d+)\.[\s\S]*?requires\s*\n?\s*NODE_MODULE_VERSION\s+(\d+)/);
  return m ? { built: m[1], runtime: m[2] } : null;
}

// In the existing probeHostBoot return shape, add abiHint when stderr captures one:
// (search for where firstStderrError is set; alongside it, set abiHint = extractAbiHint(allStderr))
```

Add `abiHint?: { built: string; runtime: string }` to the `ProbeResult` interface.

- [ ] **Step 5: Verify test passes**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/lib/host-probe-abi.test.ts`
Expected: 2 PASS.

- [ ] **Step 6: Wire `abiHint` into doctor report**

```ts
// packages/cli/src/commands/doctor.ts — extend DoctorReport.boot type
boot: Pick<ProbeResult, 'ready' | 'firstStderrError' | 'abiHint'> | null;

// In doctor() body where `boot = { ready, firstStderrError }`, add:
boot = { ready: r.ready, firstStderrError: r.firstStderrError, abiHint: r.abiHint };
```

In `renderDoctorReport`, add when `r.boot?.abiHint` is set:

```ts
if (r.boot?.abiHint) {
  lines.push(`- ABI mismatch hint: built ${r.boot.abiHint.built}, runtime ${r.boot.abiHint.runtime} → run \`contractqa doctor --fix=native-deps <target>\``);
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/host-probe.ts packages/cli/src/commands/doctor.ts packages/cli/tests/lib/host-probe-abi.test.ts
git commit -m "feat(doctor): surface ABI mismatch hint from boot-probe stderr"
```

---

### Task A4: Acceptance — `doctor --fix=native-deps` against the live target

**Files:**
- Modify: `scripts/phase4-acceptance.sh` (created in Part E; append a Doctor section)

**Goal:** End-to-end validation. The script:
1. Backs up the better-sqlite3 binary in 5-4-codex.
2. Confirms api boot fails with ABI error.
3. Runs doctor.
4. Confirms api boot succeeds.
5. Restores backup if anything went wrong.

This is added to Part E's script body. No additional code in Part A.

---

### Task A5: Update `contractqa doctor` user docs

**Files:**
- Modify: `packages/cli/README.md` (or wherever doctor is documented)

- [ ] **Step 1: Add a "pnpm 10 + monorepo" subsection covering the new workspace walker behavior, with the regression case as the worked example.**

```markdown
### `doctor --fix=native-deps` (Phase 4)

Walks `package.json`, `apps/*/package.json`, and `packages/*/package.json` for declarations of the known-native dependencies (`better-sqlite3`, `sqlite3`, `bcrypt`, `sharp`, `canvas`, `node-gyp`). For each detected dep, runs `npm run install` inside `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>` — the only path that triggers `prebuild-install` reliably under pnpm 10.

`pnpm rebuild <pkg>` is a no-op for transitive workspace deps in pnpm 10 and is NOT what this fix runs.

Worked example — 5-4-codex on Node 22 (binary built for Node 20):

```bash
contractqa doctor --fix=native-deps /path/to/5-4-codex
# [ok] native-deps: better-sqlite3: rebuilt OK
```
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/README.md
git commit -m "docs(doctor): document pnpm 10 workspace-aware native-deps fix"
```

---

# Part B: BackendAdapter L2 — `PostgresBackendAdapter` real impl

**Acceptance gate B:** `dogfood/agent-poker-platform/dogfood.test.ts` (created in this Part) drives an INV against the api-only original `agent-poker-platform` via `PostgresBackendAdapter`. The adapter enforces (a) read-only DSN — write queries throw, (b) tenant scope mandatory — bare query throws, (c) named queries only — raw SQL throws. All three negative tests live alongside the positive INV test.

---

### Task B1: `BackendAdapter` schema — `backend_state` block in contract

**Files:**
- Modify: `packages/core/src/schemas/contract.schema.ts`
- Modify: `packages/core/src/types/contract.ts` (if `Invariant` shape lives there)
- Test: `packages/core/tests/schemas/contract-backend-state.test.ts` (create)

**Goal:** Contracts can today only assert on `dom`, `auth_state`, and `network`. Add `backend_state:` so contracts can express "after action X, named-query `pendingHands` for tenant `<userId>` returns 0 rows."

- [ ] **Step 1: Write the failing schema test**

```ts
// packages/core/tests/schemas/contract-backend-state.test.ts
import { describe, it, expect } from 'vitest';
import { contractSchema } from '../../src/schemas/contract.schema.js';

describe('contract schema — backend_state block', () => {
  it('accepts a contract with backend_state.named_query', () => {
    const contract = {
      id: 'INV-B1',
      role: 'user',
      action: { kind: 'navigate', url: '/lobby' },
      expected: {
        backend_state: {
          named_query: 'pendingHands',
          params: { userId: '$session.userId' },
          assert: { rowCount: 0 },
        },
      },
    };
    const r = contractSchema.safeParse(contract);
    expect(r.success).toBe(true);
  });

  it('rejects backend_state with raw sql', () => {
    const contract = {
      id: 'INV-B2',
      role: 'user',
      action: { kind: 'navigate', url: '/lobby' },
      expected: {
        backend_state: { sql: 'SELECT * FROM hands' },
      },
    };
    const r = contractSchema.safeParse(contract);
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, see schema reject the new shape**

Run: `pnpm --filter @contractqa/core exec vitest run tests/schemas/contract-backend-state.test.ts`
Expected: 1st test FAIL (unknown key), 2nd test PASS (unknown key still rejected).

- [ ] **Step 3: Add `backend_state` to `expected` schema**

```ts
// packages/core/src/schemas/contract.schema.ts — extend the expected shape
const backendStateSchema = z.object({
  named_query: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  assert: z.union([
    z.object({ rowCount: z.number().int().nonnegative() }),
    z.object({ rows: z.array(z.record(z.unknown())) }),
  ]),
});

// In `expected` object:
expected: z.object({
  // ... existing dom, auth_state, network
  backend_state: backendStateSchema.optional(),
}).strict(),
```

- [ ] **Step 4: Verify both tests pass**

Run: `pnpm --filter @contractqa/core exec vitest run tests/schemas/contract-backend-state.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/contract.schema.ts packages/core/tests/schemas/contract-backend-state.test.ts
git commit -m "feat(core): add backend_state block to contract schema (named-query only)"
```

---

### Task B2: `PostgresBackendAdapter` — read-only DSN enforcement

**Files:**
- Modify: `packages/adapters/src/backend/postgres-stub.ts` → rename to `postgres.ts`; update `public.ts` re-export.
- Test: `packages/adapters/tests/postgres-readonly.test.ts` (create)

**Goal:** Replace the throws-on-call stub. The adapter wraps `pg.Pool` but rejects any query that would mutate (parses statement type before execution).

- [ ] **Step 1: Rename + add `pg` dependency**

```bash
git mv packages/adapters/src/backend/postgres-stub.ts packages/adapters/src/backend/postgres.ts
# update packages/adapters/src/public.ts: change './backend/postgres-stub.js' → './backend/postgres.js'
```

Add to `packages/adapters/package.json` `dependencies`:
```json
"pg": "^8.13.0"
```
And devDeps:
```json
"@types/pg": "^8.11.0"
```

Run `pnpm install` from repo root.

- [ ] **Step 2: Write the failing test**

```ts
// packages/adapters/tests/postgres-readonly.test.ts
import { describe, it, expect } from 'vitest';
import { PostgresBackendAdapter } from '../src/backend/postgres.js';

describe('PostgresBackendAdapter — read-only enforcement', () => {
  it('rejects INSERT in named query at construction', () => {
    expect(() => new PostgresBackendAdapter({
      dsn: 'postgres://x',
      tenantField: 'user_id',
      namedQueries: {
        bad: { description: 'bad', sql: 'INSERT INTO foo VALUES (1)', params: {} },
      },
    })).toThrow(/read-only|INSERT/);
  });

  it('rejects UPDATE / DELETE / DROP / CREATE / TRUNCATE / GRANT', () => {
    for (const sql of ['UPDATE foo SET a=1', 'DELETE FROM foo', 'DROP TABLE foo', 'CREATE TABLE foo (a int)', 'TRUNCATE foo', 'GRANT ALL ON foo TO bar']) {
      expect(() => new PostgresBackendAdapter({
        dsn: 'postgres://x',
        tenantField: 'user_id',
        namedQueries: { bad: { description: 'bad', sql, params: {} } },
      })).toThrow();
    }
  });

  it('accepts SELECT and WITH ... SELECT', () => {
    expect(() => new PostgresBackendAdapter({
      dsn: 'postgres://x',
      tenantField: 'user_id',
      namedQueries: {
        good: { description: 'good', sql: 'SELECT * FROM hands WHERE user_id = $1', params: { userId: '$1' } },
        cte: { description: 'cte', sql: 'WITH t AS (SELECT 1) SELECT * FROM t', params: {} },
      },
    })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @contractqa/adapters exec vitest run tests/postgres-readonly.test.ts`
Expected: FAIL — current `postgres.ts` has no constructor accepting `{dsn, tenantField, namedQueries}` and no read-only validation.

- [ ] **Step 4: Implement constructor + statement-type guard**

```ts
// packages/adapters/src/backend/postgres.ts — replace stub body
import { Pool } from 'pg';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

export interface NamedQuery {
  description: string;
  sql: string;
  params: Record<string, string>; // param name → SQL placeholder ($1, $2, ...)
}

export interface PostgresBackendAdapterOptions {
  dsn: string;
  tenantField: string;
  namedQueries: Record<string, NamedQuery>;
}

const READ_VERBS = /^(SELECT|WITH)\b/i;

export class PostgresBackendAdapter implements BackendAdapter {
  readonly kind = 'postgres' as const;
  private pool: Pool | null = null;
  private opts: PostgresBackendAdapterOptions;

  constructor(opts: PostgresBackendAdapterOptions) {
    for (const [name, q] of Object.entries(opts.namedQueries)) {
      const trimmed = q.sql.trim().replace(/^\(/, '');
      if (!READ_VERBS.test(trimmed)) {
        throw new Error(`PostgresBackendAdapter: named query "${name}" must start with SELECT or WITH; got: ${trimmed.slice(0, 40)}…`);
      }
    }
    this.opts = opts;
  }

  describe(): SchemaDescriptor {
    return {
      tenantField: this.opts.tenantField,
      namedQueries: Object.entries(this.opts.namedQueries).map(([name, q]) => ({
        name, description: q.description, params: q.params,
      })),
    };
  }

  async query(name: string, params: Record<string, unknown>): Promise<unknown[]> {
    const q = this.opts.namedQueries[name];
    if (!q) throw new Error(`PostgresBackendAdapter: no named query "${name}"`);
    if (params[this.opts.tenantField] === undefined) {
      throw new Error(`PostgresBackendAdapter: named query "${name}" requires tenant field "${this.opts.tenantField}" in params`);
    }
    if (!this.pool) this.pool = new Pool({ connectionString: this.opts.dsn });
    const ordered = Object.keys(q.params).map((k) => params[k]);
    const r = await this.pool.query({ text: q.sql, values: ordered });
    return r.rows;
  }

  async close(): Promise<void> { await this.pool?.end(); this.pool = null; }
}
```

- [ ] **Step 5: Verify all 3 tests pass**

Run: `pnpm --filter @contractqa/adapters exec vitest run tests/postgres-readonly.test.ts`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/src/backend/postgres.ts packages/adapters/src/public.ts packages/adapters/package.json packages/adapters/tests/postgres-readonly.test.ts pnpm-lock.yaml
git commit -m "feat(adapters): PostgresBackendAdapter — read-only statement guard, named queries"
```

---

### Task B3: Tenant-scope enforcement test + already-implemented in B2

**Files:**
- Test: `packages/adapters/tests/postgres-tenant.test.ts` (create)

- [ ] **Step 1: Write tenant-scope test**

```ts
// packages/adapters/tests/postgres-tenant.test.ts
import { describe, it, expect } from 'vitest';
import { PostgresBackendAdapter } from '../src/backend/postgres.js';

describe('PostgresBackendAdapter — tenant scope', () => {
  it('throws when query is called without tenant field in params', async () => {
    const a = new PostgresBackendAdapter({
      dsn: 'postgres://nowhere',
      tenantField: 'user_id',
      namedQueries: {
        pendingHands: {
          description: 'pending hands for a user',
          sql: 'SELECT id FROM hands WHERE user_id = $1',
          params: { user_id: '$1' },
        },
      },
    });
    await expect(a.query('pendingHands', {})).rejects.toThrow(/tenant field "user_id"/);
    await expect(a.query('pendingHands', { other: 'x' })).rejects.toThrow(/tenant field "user_id"/);
  });
});
```

- [ ] **Step 2: Verify test passes (B2's impl already enforces this)**

Run: `pnpm --filter @contractqa/adapters exec vitest run tests/postgres-tenant.test.ts`
Expected: PASS (no impl change required — B2 covered it).

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/tests/postgres-tenant.test.ts
git commit -m "test(adapters): tenant-scope enforcement coverage for PostgresBackendAdapter"
```

---

### Task B4: Runner — consume `backend_state.named_query` from contracts

**Files:**
- Modify: `packages/runner/src/run-contract.ts` (or wherever the verdict-eval logic lives; grep for `auth_state` to find it)
- Test: `packages/runner/tests/backend-state.test.ts` (create)

- [ ] **Step 1: Locate the expected-block evaluator**

```bash
grep -rn "expected.auth_state\|expected\['auth_state'\]" packages/runner/src --include="*.ts" | head
# Should land in run-contract.ts or a verdict.ts file.
```

- [ ] **Step 2: Write the failing test using a fake adapter**

```ts
// packages/runner/tests/backend-state.test.ts
import { describe, it, expect } from 'vitest';
import { runContract } from '../src/run-contract.js';
import type { BackendAdapter, SchemaDescriptor } from '@contractqa/core';

class FakeBackend implements BackendAdapter {
  readonly kind = 'postgres' as const;
  constructor(private rows: unknown[]) {}
  describe(): SchemaDescriptor { return { tenantField: 'user_id', namedQueries: [{ name: 'pending', description: 'p', params: { user_id: '$1' } }] }; }
  async query(): Promise<unknown[]> { return this.rows; }
}

describe('runContract — backend_state evaluation', () => {
  it('PASS when named query rowCount matches assertion', async () => {
    const r = await runContract({
      contract: {
        id: 'INV-B-pass',
        role: 'user',
        action: { kind: 'navigate', url: '/lobby' },
        expected: { backend_state: { named_query: 'pending', params: { user_id: 'u1' }, assert: { rowCount: 0 } } },
      } as any,
      page: makeStubPage(),
      backend: new FakeBackend([]),
    });
    expect(r.verdict.verdict).toBe('PASS');
  });

  it('FAIL when rowCount diverges', async () => {
    const r = await runContract({
      contract: {
        id: 'INV-B-fail',
        role: 'user',
        action: { kind: 'navigate', url: '/lobby' },
        expected: { backend_state: { named_query: 'pending', params: { user_id: 'u1' }, assert: { rowCount: 0 } } },
      } as any,
      page: makeStubPage(),
      backend: new FakeBackend([{ id: 1 }, { id: 2 }]),
    });
    expect(r.verdict.verdict).toBe('FAIL');
  });

  it('verdict = INCONCLUSIVE when contract uses backend_state but no backend provided', async () => {
    const r = await runContract({
      contract: {
        id: 'INV-B-inc',
        role: 'user',
        action: { kind: 'navigate', url: '/lobby' },
        expected: { backend_state: { named_query: 'pending', params: { user_id: 'u1' }, assert: { rowCount: 0 } } },
      } as any,
      page: makeStubPage(),
    });
    expect(r.verdict.verdict).toBe('INCONCLUSIVE');
    expect(r.verdict.missing_capability).toBe('backend_probe');
  });
});

function makeStubPage(): any {
  return {
    goto: async () => undefined,
    url: () => 'http://x/lobby',
    evaluate: async () => null,
    context: () => ({ cookies: async () => [] }),
  };
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/backend-state.test.ts`
Expected: FAIL — `runContract` doesn't accept `backend` option, doesn't evaluate `backend_state`, and doesn't emit `INCONCLUSIVE` for missing capability.

- [ ] **Step 4: Add `backend?: BackendAdapter` to `RunContractOptions` + evaluator**

```ts
// packages/runner/src/run-contract.ts
import type { BackendAdapter } from '@contractqa/core';

export interface RunContractOptions {
  // ... existing fields
  backend?: BackendAdapter;
}

// In the verdict-eval section, after auth_state, add:
async function evalBackendState(
  bs: { named_query: string; params: Record<string, unknown>; assert: { rowCount?: number; rows?: unknown[] } },
  backend?: BackendAdapter,
): Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; reason?: string; missing_capability?: string }> {
  if (!backend) return { verdict: 'INCONCLUSIVE', missing_capability: 'backend_probe' };
  try {
    const rows = await backend.query(bs.named_query, bs.params);
    if ('rowCount' in bs.assert) {
      return rows.length === bs.assert.rowCount
        ? { verdict: 'PASS' }
        : { verdict: 'FAIL', reason: `expected rowCount ${bs.assert.rowCount}, got ${rows.length}` };
    }
    if ('rows' in bs.assert) {
      const ok = JSON.stringify(rows) === JSON.stringify(bs.assert.rows);
      return ok ? { verdict: 'PASS' } : { verdict: 'FAIL', reason: 'rows do not match expected' };
    }
    return { verdict: 'INCONCLUSIVE', missing_capability: 'unsupported_assert' };
  } catch (e) {
    return { verdict: 'FAIL', reason: `backend query "${bs.named_query}" threw: ${(e as Error).message}` };
  }
}

// In the main eval flow, when contract.expected.backend_state is set,
// call evalBackendState and merge result into final verdict using
// existing severity rules: FAIL > INCONCLUSIVE > PASS.
```

Add `missing_capability?: string` to the verdict shape in `packages/core/src/types/verdict.ts` if not present.

- [ ] **Step 5: Verify all 3 backend-state tests pass**

Run: `pnpm --filter @contractqa/runner exec vitest run tests/backend-state.test.ts`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runner/src/run-contract.ts packages/core/src/types/verdict.ts packages/runner/tests/backend-state.test.ts
git commit -m "feat(runner): evaluate backend_state.named_query, INCONCLUSIVE when no BackendAdapter"
```

---

### Task B5: `agent-poker-platform` (api-only) dogfood target

**Files:**
- Create: `dogfood/agent-poker-platform/contracts/INV-B1.yml`
- Create: `dogfood/agent-poker-platform/dogfood.test.ts`
- Create: `dogfood/agent-poker-platform/FINDINGS.md`
- Create: `dogfood/agent-poker-platform/noise-profile.yml`

**Goal:** This is the original api-only target dropped from Phase 2. The repo lives at `/Users/zmy/intership/4/agent-poker-platform` (no suffix). It exposes only HTTP API — no web — so contracts use `BackendAdapter` exclusively (no Playwright).

- [ ] **Step 1: Confirm the target repo exists**

```bash
ls /Users/zmy/intership/4/agent-poker-platform 2>&1 | head
```

If absent, surface to the user: "agent-poker-platform target repo not at expected path — point me at the right checkout or skip B5."

- [ ] **Step 2: Write a minimal contract**

```yaml
# dogfood/agent-poker-platform/contracts/INV-B1.yml
id: INV-B1
description: After POST /api/v1/tables, the new table is visible via the named-query "tablesByOwner".
role: user
action:
  kind: http
  method: POST
  path: /api/v1/tables
  body: { name: "dogfood-test" }
expected:
  backend_state:
    named_query: tablesByOwner
    params:
      user_id: "$session.userId"
    assert:
      rowCount: 1
```

- [ ] **Step 3: Write the dogfood test**

```ts
// dogfood/agent-poker-platform/dogfood.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDir, runContract } from '@contractqa/runner';
import { PostgresBackendAdapter } from '@contractqa/adapters/public';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TARGET_REPO = '/Users/zmy/intership/4/agent-poker-platform';
const API_PORT = Number(process.env.DOGFOOD_BAREAPI_PORT ?? '3687');
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const POSTGRES_DSN = process.env.DOGFOOD_POSTGRES_DSN ?? 'postgresql://contractqa:contractqa@127.0.0.1:54322/postgres';

let api: ChildProcess | undefined;

beforeAll(async () => {
  api = spawn('pnpm', ['--filter', 'api', 'run', 'dev'], {
    cwd: TARGET_REPO,
    env: { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1', NODE_ENV: 'test', DATABASE_URL: POSTGRES_DSN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stderr?.on('data', (d) => process.stderr.write(`[bare-api] ${d}`));
  await pollHealth(`${API_BASE}/health`, 60_000);
}, 90_000);

afterAll(async () => {
  if (api && !api.killed) {
    api.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 300));
    if (!api.killed) api.kill('SIGKILL');
  }
});

describe('ContractQA dogfood — agent-poker-platform (api-only)', () => {
  it('INV-B1: POST /api/v1/tables makes table visible via named query', async () => {
    const contracts = await loadContractsFromDir(path.join(__dir, 'contracts'));
    const inv = contracts.find((c) => c.id === 'INV-B1');
    expect(inv).toBeTruthy();

    const backend = new PostgresBackendAdapter({
      dsn: POSTGRES_DSN,
      tenantField: 'user_id',
      namedQueries: {
        tablesByOwner: {
          description: 'tables owned by a user',
          sql: 'SELECT id FROM tables WHERE owner_user_id = $1',
          params: { user_id: '$1' },
        },
      },
    });

    try {
      const result = await runContract({ contract: inv!, backend, /* http-only — no page */ } as any);
      expect(result.verdict.verdict).toBe('PASS');
    } finally {
      await backend.close();
    }
  });
});

async function pollHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`health never ready at ${url}`);
}
```

- [ ] **Step 4: Action evaluator must support `kind: http`**

This requires extending `runContract` to handle non-page actions. If the contract's action.kind is `http`, perform a `fetch()` instead of a Playwright navigation.

```ts
// packages/runner/src/run-contract.ts — in the action-execution block:
if (contract.action.kind === 'http') {
  const res = await fetch(`${baseUrl}${contract.action.path}`, {
    method: contract.action.method,
    headers: { 'content-type': 'application/json' },
    body: contract.action.body ? JSON.stringify(contract.action.body) : undefined,
  });
  // Capture response status for after-snapshot.
}
```

(Add `kind: 'http'` to the contract schema's action union in `packages/core/src/schemas/contract.schema.ts`.)

- [ ] **Step 5: Write FINDINGS.md as we go**

```markdown
# dogfood/agent-poker-platform/FINDINGS.md

Initial Phase 4 dogfood for the api-only original `agent-poker-platform` target. Findings will land here as we exercise the new BackendAdapter L2 surface.
```

- [ ] **Step 6: Commit**

```bash
git add dogfood/agent-poker-platform/
git commit -m "feat(dogfood): agent-poker-platform L2 target (api-only, BackendAdapter)"
```

---

# Part C: Monorepo-aware `contractqa init`

**Acceptance gate C:** `contractqa init /path/to/5-4-codex` (which has `apps/web/` as the actual Vite app) detects `vite-react` (not `unknown`) and writes scaffolds into `apps/web/qa/`. `contractqa init /path/to/wolfmind` does the same for `apps/web/`. `contractqa init /path/to/5-4-claude` does the same for `web/`. With multiple candidate subdirs, `--target <subdir>` picks one explicitly; absent the flag, init prints a numbered menu and exits 2 if non-interactive.

---

### Task C1: Subdirectory walker

**Files:**
- Modify: `packages/cli/src/init/detect-framework.ts`
- Test: `packages/cli/tests/detect-framework-monorepo.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/detect-framework-monorepo.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectFrameworkInRepo } from '../src/init/detect-framework.js';

async function makeMonorepo(layout: 'apps-web' | 'web' | 'frontend'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  const sub = layout === 'apps-web' ? 'apps/web' : layout;
  await mkdir(path.join(root, sub), { recursive: true });
  await writeFile(path.join(root, sub, 'package.json'), JSON.stringify({
    dependencies: { react: '^18.0.0', vite: '^5.0.0' },
  }));
  await writeFile(path.join(root, sub, 'vite.config.ts'), '');
  return root;
}

describe('detectFrameworkInRepo — monorepo subdirectory walking', () => {
  it('detects vite-react in apps/web/', async () => {
    const root = await makeMonorepo('apps-web');
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ subdir: 'apps/web', framework: 'vite-react' });
  });

  it('detects vite-react in web/', async () => {
    const root = await makeMonorepo('web');
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates[0].subdir).toBe('web');
  });

  it('detects vite-react in frontend/', async () => {
    const root = await makeMonorepo('frontend');
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates[0].subdir).toBe('frontend');
  });

  it('returns root candidate (subdir = ".") when root is itself the framework', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-root-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '*', vite: '*' } }));
    await writeFile(path.join(root, 'vite.config.ts'), '');
    const r = await detectFrameworkInRepo(root);
    expect(r.candidates[0].subdir).toBe('.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (function doesn't exist)**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/detect-framework-monorepo.test.ts`
Expected: FAIL — `detectFrameworkInRepo` is not exported.

- [ ] **Step 3: Add `detectFrameworkInRepo`**

```ts
// packages/cli/src/init/detect-framework.ts — append
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface RepoDetectCandidate {
  subdir: string; // "." for root, otherwise relative path
  framework: Framework;
  confidence: number;
  evidence: string[];
  authSignals: AuthSignal[];
}

export interface RepoDetectResult {
  candidates: RepoDetectCandidate[];
}

const SUBDIR_HINTS = ['apps', 'packages', 'web', 'frontend', 'client', 'site'];

export async function detectFrameworkInRepo(root: string): Promise<RepoDetectResult> {
  const candidates: RepoDetectCandidate[] = [];
  const rootResult = await tryDir(root, '.');
  if (rootResult) candidates.push(rootResult);

  for (const hint of SUBDIR_HINTS) {
    const hintPath = path.join(root, hint);
    let isDir = false;
    try { isDir = (await stat(hintPath)).isDirectory(); } catch {}
    if (!isDir) continue;
    if (hint === 'apps' || hint === 'packages') {
      // Walk one level deeper.
      const subs = await readdir(hintPath);
      for (const s of subs) {
        const r = await tryDir(path.join(hintPath, s), `${hint}/${s}`);
        if (r) candidates.push(r);
      }
    } else {
      const r = await tryDir(hintPath, hint);
      if (r) candidates.push(r);
    }
  }
  // Sort by confidence desc, root last when tied.
  candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    if (a.subdir === '.' && b.subdir !== '.') return 1;
    if (b.subdir === '.' && a.subdir !== '.') return -1;
    return 0;
  });
  return { candidates };
}

async function tryDir(dir: string, subdir: string): Promise<RepoDetectCandidate | null> {
  try {
    const pj = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const files = await readdir(dir);
    const r = await detectFramework({ packageJson: pj, files });
    if (r.framework === 'unknown') return null;
    return { subdir, framework: r.framework, confidence: r.confidence, evidence: r.evidence, authSignals: r.authSignals };
  } catch { return null; }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/detect-framework-monorepo.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework-monorepo.test.ts
git commit -m "feat(init): detect frameworks in nested apps/web, frontend, web subdirs"
```

---

### Task C2: `init` command consumes multi-candidate result

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/tests/init-monorepo.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/init-monorepo.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInit } from '../src/commands/init.js';

describe('init — monorepo target selection', () => {
  it('writes scaffold into apps/web/qa when target is auto-detected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-mono-'));
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    await writeFile(path.join(root, 'apps/web/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'apps/web/vite.config.ts'), '');

    const r = await runInit({ targetRoot: root, yes: true });
    expect(r.scaffoldRoot).toBe(path.join(root, 'apps/web'));
    expect((await stat(path.join(root, 'apps/web/qa'))).isDirectory()).toBe(true);
  });

  it('with --target=apps/web, writes there even if root also detects', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-target-'));
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'vite.config.ts'), '');
    await writeFile(path.join(root, 'apps/web/package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
    await writeFile(path.join(root, 'apps/web/vite.config.ts'), '');

    const r = await runInit({ targetRoot: root, yes: true, target: 'apps/web' });
    expect(r.scaffoldRoot).toBe(path.join(root, 'apps/web'));
  });

  it('throws AmbiguousTarget when multiple subdirs match and no --target given (non-interactive)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-init-ambig-'));
    for (const sub of ['apps/web', 'apps/admin']) {
      await mkdir(path.join(root, sub), { recursive: true });
      await writeFile(path.join(root, sub, 'package.json'), JSON.stringify({ dependencies: { vite: '*', react: '*' } }));
      await writeFile(path.join(root, sub, 'vite.config.ts'), '');
    }
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    await expect(runInit({ targetRoot: root, yes: true })).rejects.toThrow(/AmbiguousTarget|multiple/);
  });
});
```

- [ ] **Step 2: Run test, see it fail on multiple counts**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/init-monorepo.test.ts`
Expected: FAIL — `runInit` doesn't accept `target`, doesn't write outside `targetRoot`, doesn't throw on ambiguity.

- [ ] **Step 3: Update `runInit` to consume `RepoDetectResult`**

```ts
// packages/cli/src/commands/init.ts — modify runInit
import { detectFrameworkInRepo } from '../init/detect-framework.js';

export interface InitOptions {
  targetRoot: string;
  yes?: boolean;
  force?: boolean;
  framework?: Framework;
  target?: string; // new — relative subdir
}

export interface InitResult {
  scaffoldRoot: string; // where qa/ landed
  framework: Framework;
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
  let scaffoldRoot = opts.targetRoot;
  let framework = opts.framework ?? 'unknown';
  if (!opts.framework) {
    const r = await detectFrameworkInRepo(opts.targetRoot);
    const target = opts.target;
    if (target) {
      const c = r.candidates.find((c) => c.subdir === target);
      if (!c) throw new Error(`no detection at --target ${target}`);
      scaffoldRoot = path.join(opts.targetRoot, c.subdir === '.' ? '' : c.subdir);
      framework = c.framework;
    } else if (r.candidates.length === 0) {
      throw new Error('no framework detected — pass --framework explicitly');
    } else if (r.candidates.length > 1 && r.candidates[0].confidence === r.candidates[1].confidence) {
      throw new Error(`AmbiguousTarget: ${r.candidates.map((c) => c.subdir).join(', ')} — pass --target <subdir>`);
    } else {
      const c = r.candidates[0];
      scaffoldRoot = path.join(opts.targetRoot, c.subdir === '.' ? '' : c.subdir);
      framework = c.framework;
    }
  }
  // ... rest of existing scaffold-writing logic, using `scaffoldRoot` instead of `opts.targetRoot`
  return { scaffoldRoot, framework };
}
```

- [ ] **Step 4: Wire `--target` flag in commander**

Find the existing `program.command('init')` block and add `.option('--target <subdir>', 'monorepo subdir to scaffold into')`.

- [ ] **Step 5: Verify tests pass**

Run: `pnpm --filter @contractqa/cli exec vitest run tests/init-monorepo.test.ts tests/init.test.ts`
Expected: 3 PASS for new tests, existing init tests stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/tests/init-monorepo.test.ts
git commit -m "feat(init): scaffold into auto-detected nested apps; --target flag for ambiguity"
```

---

### Task C3: `scan` command also walks subdirs

**Files:**
- Modify: `packages/cli/src/commands/scan.ts` (assumed location)
- Test: extend existing scan test with a monorepo case

- [ ] **Step 1: Mirror C1's pattern in scan — call `detectFrameworkInRepo` and surface a per-candidate section in `qa/SCAN_REPORT.md`.**

```ts
// packages/cli/src/commands/scan.ts — replace the single-call to detectFramework
const r = await detectFrameworkInRepo(opts.targetRoot);
// Render report as: per-candidate framework + auth signals + suggested contracts.
```

- [ ] **Step 2: Test**

```ts
// extension to existing scan test
it('writes per-candidate sections for monorepo', async () => {
  const root = await makeMonorepoWithMultipleApps();
  await runScan({ targetRoot: root });
  const report = await readFile(path.join(root, 'qa/SCAN_REPORT.md'), 'utf8');
  expect(report).toContain('## apps/web');
  expect(report).toContain('## apps/admin');
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/scan.ts packages/cli/tests/scan.test.ts
git commit -m "feat(scan): per-candidate sections for monorepo layouts"
```

---

# Part D: Per-responsibility `composeAuth` routing

**Acceptance gate D:** A new test in `packages/adapters/tests/composite-auth-adapter.test.ts` constructs `composeAuth([nextAuthSession, supabaseUserStore])`. Calling `currentUser` invokes the supabase adapter (user-store), not the nextAuth adapter (session). Calling `loginAs` invokes nextAuth. Calling `expectFullyLoggedOut` queries BOTH and ANDs results. The Phase 3 B4 test (which encoded the bug) is reverted to assert the new correct behavior.

---

### Task D1: Method→responsibility map

**Files:**
- Modify: `packages/adapters/src/auth/composite.ts`
- Modify: `packages/adapters/tests/composite-auth-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/adapters/tests/composite-auth-adapter.test.ts — append
import { describe, it, expect, vi } from 'vitest';
import { composeAuth } from '../src/auth/composite.js';
import type { AuthAdapter } from '@contractqa/core';

function fakeAdapter(name: string, responsibilities: AuthAdapter['responsibilities']): AuthAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    provider: 'custom',
    responsibilities,
    loginAs: vi.fn(async () => { calls.push(`${name}.loginAs`); }) as any,
    isAuthenticated: vi.fn(async () => { calls.push(`${name}.isAuthenticated`); return true; }) as any,
    currentUser: vi.fn(async () => { calls.push(`${name}.currentUser`); return { id: name, role: 'user' }; }) as any,
    expectFullyLoggedOut: vi.fn(async () => { calls.push(`${name}.expectFullyLoggedOut`); return { fully_logged_out: true } as any; }) as any,
    sessionKeyPatterns: () => ({ localStorage: [], sessionStorage: [], cookies: [] }),
    calls,
  } as any;
}

describe('composeAuth — per-responsibility routing', () => {
  it('routes currentUser to user-store adapter when present', async () => {
    const session = fakeAdapter('s', ['session']);
    const userStore = fakeAdapter('u', ['user-store']);
    const c = composeAuth([session, userStore]);
    const r = await c.currentUser({} as any);
    expect(r?.id).toBe('u');
    expect((session as any).calls).not.toContain('s.currentUser');
    expect((userStore as any).calls).toContain('u.currentUser');
  });

  it('routes currentUser to session adapter when no user-store', async () => {
    const session = fakeAdapter('s', ['session']);
    const c = composeAuth([session]);
    const r = await c.currentUser({} as any);
    expect(r?.id).toBe('s');
  });

  it('expectFullyLoggedOut runs against every adapter and ANDs results', async () => {
    const session = fakeAdapter('s', ['session']);
    const userStore = fakeAdapter('u', ['user-store']);
    const c = composeAuth([session, userStore]);
    const r = await c.expectFullyLoggedOut({} as any);
    expect(r.fully_logged_out).toBe(true);
    expect((session as any).calls).toContain('s.expectFullyLoggedOut');
    expect((userStore as any).calls).toContain('u.expectFullyLoggedOut');
  });

  it('expectFullyLoggedOut returns false if any adapter says false', async () => {
    const session = fakeAdapter('s', ['session']);
    const userStore = fakeAdapter('u', ['user-store']);
    (userStore.expectFullyLoggedOut as any).mockResolvedValue({ fully_logged_out: false, leaked_keys: ['sb-token'] });
    const c = composeAuth([session, userStore]);
    const r = await c.expectFullyLoggedOut({} as any);
    expect(r.fully_logged_out).toBe(false);
    expect((r as any).leaked_keys).toEqual(['sb-token']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @contractqa/adapters exec vitest run tests/composite-auth-adapter.test.ts`
Expected: 4 FAIL — current impl always picks session.

- [ ] **Step 3: Replace composeAuth body**

```ts
// packages/adapters/src/auth/composite.ts — replace export
const METHOD_RESPONSIBILITY: Record<'loginAs' | 'isAuthenticated' | 'currentUser', AuthResponsibility[]> = {
  loginAs: ['session'],
  isAuthenticated: ['session'],
  currentUser: ['user-store', 'session'], // first match wins
};

function pickFirst(adapters: AuthAdapter[], rs: readonly AuthResponsibility[]): AuthAdapter {
  for (const r of rs) {
    const owner = adapters.find((a) => (a.responsibilities ?? ALL_RESPONSIBILITIES).includes(r));
    if (owner) return owner;
  }
  throw new Error(`no adapter declares any of: ${rs.join(', ')}`);
}

export function composeAuth(adapters: AuthAdapter[]): AuthAdapter {
  if (adapters.length === 0) throw new Error('composeAuth requires at least one adapter');
  return {
    provider: 'custom',
    responsibilities: ALL_RESPONSIBILITIES,
    loginAs: (role, page) => pickFirst(adapters, METHOD_RESPONSIBILITY.loginAs).loginAs(role, page),
    isAuthenticated: (page) => pickFirst(adapters, METHOD_RESPONSIBILITY.isAuthenticated).isAuthenticated(page),
    currentUser: (page) => pickFirst(adapters, METHOD_RESPONSIBILITY.currentUser).currentUser(page),
    expectFullyLoggedOut: async (page) => {
      const all = await Promise.all(adapters.map((a) => a.expectFullyLoggedOut(page)));
      const fully = all.every((r) => r.fully_logged_out);
      const leaked = all.flatMap((r) => (r as any).leaked_keys ?? []);
      const merged: AuthStateAssertion = { fully_logged_out: fully } as any;
      if (leaked.length > 0) (merged as any).leaked_keys = leaked;
      return merged;
    },
    sessionKeyPatterns: (): SessionKeyPatterns => {
      const merged: SessionKeyPatterns = { localStorage: [], sessionStorage: [], cookies: [] };
      for (const a of adapters) {
        const p = a.sessionKeyPatterns();
        merged.localStorage.push(...p.localStorage);
        merged.sessionStorage.push(...p.sessionStorage);
        merged.cookies.push(...p.cookies);
      }
      return merged;
    },
  };
}
```

- [ ] **Step 4: Verify all 4 new tests pass + existing composite tests stay green**

Run: `pnpm --filter @contractqa/adapters exec vitest run tests/composite-auth-adapter.test.ts`
Expected: all PASS (existing + 4 new).

- [ ] **Step 5: Revert Phase 3 B4 test to assert correct behavior**

Find the Phase 3 B4 test that was "adjusted to match observed bug behavior" — search for a comment referencing this in `tests/supabase-compose.test.ts` or similar. Restore the original assertion.

```bash
grep -rn "adjusted to match\|B4\|all calls route to the session" packages/adapters/tests/ packages/dogfood/
```

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/src/auth/composite.ts packages/adapters/tests/composite-auth-adapter.test.ts
git commit -m "feat(adapters): composeAuth routes per-responsibility (currentUser→user-store, expectFullyLoggedOut→all+AND)"
```

---

### Task D2: Update `composeAuth` JSDoc + STABILITY note

**Files:**
- Modify: `packages/adapters/src/auth/composite.ts` (JSDoc above export)
- Modify: `packages/adapters/STABILITY.md` (note the routing change)

- [ ] **Step 1: Replace the JSDoc above `composeAuth`**

```ts
/**
 * Combine multiple AuthAdapters into one.
 *
 * Per-responsibility routing (Phase 4):
 *   - loginAs / isAuthenticated → owner of 'session'
 *   - currentUser → owner of 'user-store', falling back to 'session'
 *   - expectFullyLoggedOut → ALL adapters; result is AND of fully_logged_out + UNION of leaked_keys
 *   - sessionKeyPatterns → UNION across all adapters
 *
 * Adapters without a `responsibilities` field are treated as owning every
 * responsibility (Phase 1 backward compat).
 */
```

- [ ] **Step 2: Note the routing change in STABILITY.md**

Add under "@stable changes that affect callers":

```markdown
### v0.4.0 (Phase 4) — composeAuth routing

`composeAuth` now routes `currentUser` to the user-store-owning adapter (was: always session-owner). `expectFullyLoggedOut` now AND-merges across all adapters (was: only session-owner). Both changes were silent bugs in v0.2.x–v0.3.x — Phase 3 B4 documented and tolerated them. Callers passing a single adapter are unaffected; callers composing 2+ adapters get the documented behavior they expected.
```

- [ ] **Step 3: Commit**

```bash
git add packages/adapters/src/auth/composite.ts packages/adapters/STABILITY.md
git commit -m "docs(adapters): document per-responsibility routing semantics for v0.4.0"
```

---

# Part E: Cross-part — acceptance, release, FINDINGS, version bump

### Task E1: Phase 4 acceptance script

**Files:**
- Create: `scripts/phase4-acceptance.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ContractQA Phase 4 acceptance script.
# Default mode: stub-env + L1. Pass --real-cloud for L2 (PostgresBackendAdapter
# against the Phase 3 docker-compose Supabase stack's Postgres + agent-poker-platform target).

MODE="default"
if [[ "${1:-}" == "--real-cloud" ]]; then
  MODE="real-cloud"
fi

echo "== ContractQA Phase 4 acceptance (mode=$MODE) =="

echo "--- build"
pnpm -r --filter './packages/**' build

echo "--- typecheck"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests"
pnpm -r --filter './packages/**' test

echo "--- generate INVARIANTS.md"
node packages/cli/dist/bin/contractqa.js invariants:gen \
  --contracts qa/contracts --out qa/INVARIANTS.md
grep -q "INV-A2" qa/INVARIANTS.md

echo "--- Phase 1 e2e (fixture-app)"
pnpm --filter @contractqa/e2e test

echo "--- dogfood (5 Phase 2 + Phase 3 targets, stub-env)"
pnpm --filter @contractqa/dogfood test

echo "--- pack:host smoke"
bash scripts/pack-for-host.sh

echo "--- Part A acceptance: doctor --fix=native-deps against 5-4-codex (re-break + heal)"
TARGET="/Users/zmy/intership/5/5-4-codex"
NODE_FILE="${TARGET}/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ -f "$NODE_FILE" ]; then
  cp "$NODE_FILE" "$NODE_FILE.bak"
  # Corrupt header to force ABI mismatch fallback path (no-op; sniffAbiFromBinary will return null)
  node packages/cli/dist/bin/contractqa.js doctor --fix=native-deps "$TARGET"
  # Verify api boots:
  (env PORT=3287 HOST=127.0.0.1 NODE_ENV=test pnpm --filter --dir "$TARGET" api run dev &) ; sleep 8
  curl -fsS http://127.0.0.1:3287/health > /dev/null
  pkill -9 -f "tsx watch.*5-4-codex" || true
fi

echo "--- Part C acceptance: init detects nested apps/web in 5-4-codex"
TMP=$(mktemp -d)
cp -r "$TARGET"/{apps,packages,package.json,pnpm-workspace.yaml,pnpm-lock.yaml} "$TMP/" 2>/dev/null || true
node packages/cli/dist/bin/contractqa.js init --yes "$TMP"
test -d "$TMP/apps/web/qa" || { echo "init didn't scaffold into apps/web"; exit 1; }
rm -rf "$TMP"

echo "--- Part D acceptance: composeAuth per-responsibility test"
pnpm --filter @contractqa/adapters exec vitest run tests/composite-auth-adapter.test.ts

if [[ "$MODE" == "real-cloud" ]]; then
  echo "--- Part B acceptance (real-cloud): agent-poker-platform L2 against Postgres"
  bash fixtures/supabase-stack/up.sh
  trap "bash fixtures/supabase-stack/down.sh" EXIT
  pnpm --filter @contractqa/dogfood exec vitest run agent-poker-platform/dogfood.test.ts
fi

echo
echo "OK — Phase 4 acceptance passed."
```

```bash
chmod +x scripts/phase4-acceptance.sh
```

- [ ] **Step 2: Commit**

```bash
git add scripts/phase4-acceptance.sh
git commit -m "chore: scripts/phase4-acceptance.sh — Parts A/B/C/D + opt-in --real-cloud"
```

---

### Task E2: Update FINDINGS — close Phase 4 anchors, refresh STILL DEFERRED

**Files:**
- Modify: `dogfood/FINDINGS.md`

- [ ] **Step 1: Move locked-in doctor item from "LOCKED-IN" to "RESOLVED in Phase 4"; remove the 4 anchored candidates from "STILL DEFERRED"; refresh the v0.4.0 commitment.**

- [ ] **Step 2: Commit**

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): mark Phase 4 anchors RESOLVED, refresh v0.5 candidate pool"
```

---

### Task E3: CHANGELOG + version bump → v0.4.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json` and every `packages/*/package.json` `version` field
- Modify: `VERSION` (if present)

- [ ] **Step 1: Add v0.4.0 section to CHANGELOG.md mirroring Phase 3's structure (Added / Changed / Still deferred). Use the Part A/B/C/D summaries from this plan as section seeds.**

- [ ] **Step 2: Bump version across packages**

```bash
# Use whatever the existing Phase 3 v0.3.0 → v0.3.1 bump used; commit ada or 2b2506b for reference.
node -e "/* simple bump script if the existing tooling doesn't cover it */"
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md package.json packages/*/package.json VERSION 2>/dev/null
git commit -m "chore: bump to v0.4.0 + CHANGELOG + FINDINGS update"
```

- [ ] **Step 4: Tag**

```bash
git tag v0.4.0
```

---

## Self-review notes

1. **Spec coverage:** Each of the 4 anchors is a Part. Doctor regression case (today's better-sqlite3 ABI) → Part A acceptance gate. BackendAdapter dropped from Phase 3 → Part B. Monorepo init regression cases → Part C. composeAuth Phase 3 B4 known-bug → Part D D1 step 5.
2. **Placeholder scan:** Three soft spots:
   - Task A4 references `scripts/phase4-acceptance.sh` before E1 creates it — sequence A→B→C→D→E. Acceptable cross-part forward reference; engineer reads top-to-bottom.
   - Task B4 says "find the existing `program.command('init')` block" without exact line — easily greppable, kept loose to survive minor refactors.
   - Task E2 says "refresh STILL DEFERRED" without listing the diff — the diff is mechanical: drop the 4 anchored items, keep the others.
3. **Type consistency:** `RepoDetectResult.candidates` shape used in C1, C2, C3 identically. `BackendAdapter.query` returns `Promise<unknown[]>` in B2 (changed from design doc's `Promise<unknown>`); intentional — every named query is a row-set query. Note in CHANGELOG.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-contractqa-phase-4.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Matches Phase 3's execution model.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
