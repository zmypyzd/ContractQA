# ContractQA Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the hybrid-auth scanner anchor (`contractqa scan --detect-auth` with per-provider evidence + session-owner suggestion + suggested `composeAuth` config snippet), plus close the 5 minor follow-ups from Phase 5's final review, then release v0.6.0.

**Architecture:** Three parts, same shape as Phase 5.

- **Part A — Hybrid-auth scanner.** Add `--detect-auth` flag to the `scan` command. When set, inspect the file list (already gathered by `walk()`) for concrete auth-wiring files (e.g., `app/api/auth/[...nextauth]/route.ts`, `middleware.ts`, `lib/supabase/*`) and emit a structured `AuthDiagnostic[]` per detected provider. When ≥2 providers are present, render a "## Hybrid auth" section in the markdown report with per-provider evidence, a heuristic-picked session owner, and a `composeAuth` config snippet the user can paste. No file-content parsing — path-presence only. No deps changes.
- **Part B — QA pass: 5 minor follow-ups.** Each is a small, well-scoped commit. Bundle in one part to match the Phase 5 pattern.
- **Part C — Release.** Phase 6 acceptance script (parameterized TARGET — applies B2 cleanup), `dogfood/FINDINGS.md` close-out, `CHANGELOG` v0.6.0, version bump, tag.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. No new runtime deps.

---

## Required reading (before starting)

1. `docs/superpowers/plans/2026-05-15-contractqa-phase-5.md` — particularly the "post-recon scope amendment" pattern and Self-review notes.
2. `packages/cli/src/init/detect-framework.ts` — already exports `AuthSignal = 'next-auth' | 'supabase' | 'clerk' | 'auth0' | 'custom-cookie'` and detects via `AUTH_RULES` (deps-only). Phase 6 builds the file-level layer on top.
3. `packages/cli/src/commands/scan.ts` — current `scanProject` shape. Returns `ScanReport` with `authSignals: readonly string[]`. Markdown renders `Auth signals: ${authSignals.join(', ')}`.
4. `packages/adapters/src/auth/compose.ts` (or wherever `composeAuth` lives) — the suggested-config target. The scanner's "suggested snippet" should be valid input to `composeAuth`.
5. Final-review minor findings from the Phase 5 reviewer (captured in this plan's Part B).

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict | Source |
|---|---|---|
| Phase 6 anchor count | 1 (hybrid-auth scanner) + "QA pass" mini-part | User explicitly chose the "1 anchor + 小尾巴" package (option A). |
| File inspection depth | **Path-presence only**, no file-content parsing | Path-presence catches NextAuth route, Supabase SSR helpers, Clerk middleware reliably without taking on a parser dependency. False negatives are acceptable — the scanner is advisory, not authoritative. |
| `--detect-auth` flag default | OFF — opt-in. When omitted, scan behaves identically to v0.5.0. | Phase 6 is additive; don't bend existing CI. |
| Hybrid section trigger | `authSignals.length >= 2` AND `--detect-auth` set | Single-provider repos shouldn't pay for inspection. |
| Session-owner heuristic | First provider with `middleware.ts` match wins; if tie, NextAuth > Clerk > Supabase > Auth0 > custom-cookie | Pragmatic default. Doc states "best-guess; user may override in composeAuth". |
| `composeAuth` snippet output | Markdown code block, TypeScript-shaped (matches existing `composeAuth` example in `packages/adapters/STABILITY.md`) | Copy-paste UX. |
| Part B follow-ups: scope | Only the 5 minor items the Phase 5 final reviewer surfaced. Don't expand. | Phase 5 pattern. |
| `findPnpmPkgDir` Phase 5 follow-up | **Fix comment to match behavior** (NOT add semver parsing) | Smaller change. Semver awareness can be Phase 7 if real users complain. |
| Postgres CTE false-positive follow-up | **Add JSDoc warning, no behavior change** | Defer real parser to Phase 7+. |
| Acceptance script TARGET parameterization | Applies to NEW `scripts/phase6-acceptance.sh`. Do NOT retroactively touch `phase5-acceptance.sh`. | Forward-only. Phase 5 already shipped. |
| Version target | v0.6.0 | All workspace packages bump together; tag annotated like v0.5.0. |
| External repo PRs | Still NO | Same as Phase 5 decision 1. |

---

## Non-goals (do not touch)

- B5 HTTP-API contract surface — still **deferred** (no Postgres-wired api-only target identified yet).
- File-content parsing for auth detection (e.g., reading `auth.ts` to identify providers) — path-presence only.
- Mongo / Firestore / custom `BackendAdapter` implementations.
- Persona dogfood agents, property/model-based test generation, dashboard §15.3–§15.6, TypeScript project references.
- Publishing to npm — `pnpm publish` stays user-gated.
- Refactoring `scanProject` beyond the minimum needed for hybrid output.
- Adding a CLI for "auto-generate composeAuth call" — scanner outputs a snippet, user pastes it. Don't write codegen for composeAuth.

---

## File structure (what lands where)

**New files (Part A):**
- `packages/cli/src/init/inspect-auth.ts` — `inspectAuthWiring(scanRoot, files, signals): AuthDiagnostic[]`. Path-presence logic per provider. Pure function (no I/O beyond what was already done in `walk()`).
- `packages/cli/tests/inspect-auth.test.ts` — unit tests for the inspector.
- `packages/cli/tests/scan-hybrid.test.ts` — integration: scan a tmp dir with both NextAuth + Supabase, assert hybrid section appears.

**Modified files (Part A):**
- `packages/cli/src/commands/scan.ts` — accept `detectAuth?: boolean`; when true and ≥2 signals, run `inspectAuthWiring` and append the "## Hybrid auth" markdown section. Add `authDiagnostics?: readonly AuthDiagnostic[]` to `ScanReport`.
- `packages/cli/bin/contractqa.ts` (or wherever the CLI binds flags) — register `--detect-auth` boolean flag for `scan`.

**New file (Part C):**
- `scripts/phase6-acceptance.sh` — parameterizes `TARGET` via `${PHASE_TARGET:-/Users/zmy/intership/5/5-4-codex}` (applies B2 cleanup); otherwise identical to phase5-acceptance.

**Modified files (Part B and C):**
- `packages/cli/src/commands/doctor.ts` — comment fix on `findPnpmPkgDir` (B1).
- `packages/cli/src/init/detect-framework.ts` — diagnostic message when a symlink is skipped during walk (B3).
- `packages/adapters/src/backend/postgres.ts` — JSDoc warning on the FORBIDDEN_DML_DDL regex (B4).
- `packages/cli/tests/lib/host-probe-bounded.test.ts` — bump 100ms threshold to 250ms (B5).
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, all 9 `packages/*/package.json`, `packages/adapters/templates/third-party/package.json` (C2, C3).

---

## Dependency graph

```
Part A (hybrid-auth) ────┐
                         ├──► Part C (acceptance + release)
Part B (QA pass)     ────┘
```

Parts A and B are independent. Suggested worktree layout (matches Phase 4/5):
- `.claude/worktrees/phase6-exec`

---

# Part A: Hybrid-auth scanner

**Acceptance gate A:** `pnpm --filter contractqa exec vitest run tests/scan-hybrid.test.ts` passes — a scan over a fixture with both `next-auth` and `@supabase/ssr` in deps AND `app/api/auth/[...nextauth]/route.ts` AND `middleware.ts` produces a markdown report containing a `## Hybrid auth` section listing both providers with their evidence files, a suggested session owner, and a `composeAuth({...})` snippet.

---

### Task A1: Define `AuthDiagnostic` type + path-presence rules

**Files:**
- Create: `packages/cli/src/init/inspect-auth.ts`
- Create: `packages/cli/tests/inspect-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/inspect-auth.test.ts
import { describe, it, expect } from 'vitest';
import { inspectAuthWiring } from '../src/init/inspect-auth.js';

describe('inspectAuthWiring — path-presence per provider', () => {
  it('flags next-auth when app/api/auth/[...nextauth]/route.ts exists', () => {
    const r = inspectAuthWiring({
      files: ['app/api/auth/[...nextauth]/route.ts', 'package.json'],
      signals: ['next-auth'],
    });
    expect(r).toEqual([
      {
        provider: 'next-auth',
        depEvidence: true,
        wiringFiles: ['app/api/auth/[...nextauth]/route.ts'],
        hasMiddleware: false,
      },
    ]);
  });

  it('flags supabase via lib/supabase/server.ts + middleware.ts', () => {
    const r = inspectAuthWiring({
      files: ['lib/supabase/server.ts', 'lib/supabase/client.ts', 'middleware.ts'],
      signals: ['supabase'],
    });
    expect(r).toEqual([
      {
        provider: 'supabase',
        depEvidence: true,
        wiringFiles: ['lib/supabase/client.ts', 'lib/supabase/server.ts'],
        hasMiddleware: true,
      },
    ]);
  });

  it('returns one entry per signal even when no wiring file matches', () => {
    const r = inspectAuthWiring({
      files: ['src/main.tsx'],
      signals: ['clerk'],
    });
    expect(r).toEqual([
      { provider: 'clerk', depEvidence: true, wiringFiles: [], hasMiddleware: false },
    ]);
  });

  it('detects NextAuth pages-router route too', () => {
    const r = inspectAuthWiring({
      files: ['pages/api/auth/[...nextauth].ts'],
      signals: ['next-auth'],
    });
    expect(r[0]!.wiringFiles).toEqual(['pages/api/auth/[...nextauth].ts']);
  });
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm --filter contractqa exec vitest run tests/inspect-auth.test.ts` — all 4 FAIL (module not found).

- [ ] **Step 3: Implement `inspect-auth.ts`**

```ts
// packages/cli/src/init/inspect-auth.ts
import type { AuthSignal } from './detect-framework.js';

export interface AuthDiagnostic {
  provider: AuthSignal;
  depEvidence: boolean;
  wiringFiles: string[];
  hasMiddleware: boolean;
}

interface InspectInput {
  files: readonly string[];
  signals: readonly AuthSignal[];
}

// Path-presence rules per provider. Patterns are matched against the relative
// file path (forward slashes, no leading ./).
const WIRING_RULES: Record<AuthSignal, RegExp[]> = {
  'next-auth': [
    /^(src\/)?app\/api\/auth\/\[\.\.\.nextauth\]\/route\.(ts|tsx|js|jsx|mjs)$/,
    /^(src\/)?pages\/api\/auth\/\[\.\.\.nextauth\]\.(ts|tsx|js|jsx|mjs)$/,
    /^(src\/)?auth\.(ts|tsx|js|jsx|mjs)$/,
    /^(src\/)?lib\/auth\.(ts|tsx|js|jsx|mjs)$/,
  ],
  supabase: [
    /^(src\/)?lib\/supabase\//,
    /^(src\/)?utils\/supabase\//,
    /^(src\/)?app\/api\/auth\/callback\/route\.(ts|js|mjs)$/,
  ],
  clerk: [
    /^(src\/)?app\/sign-in\//,
    /^(src\/)?app\/sign-up\//,
  ],
  auth0: [
    /^(src\/)?app\/api\/auth\/\[auth0\]\/route\.(ts|js|mjs)$/,
    /^(src\/)?pages\/api\/auth\/\[\.\.\.auth0\]\.(ts|js|mjs)$/,
  ],
  'custom-cookie': [],
};

const MIDDLEWARE_RE = /^(src\/)?middleware\.(ts|tsx|js|jsx|mjs)$/;

export function inspectAuthWiring(input: InspectInput): AuthDiagnostic[] {
  const hasMiddleware = input.files.some((f) => MIDDLEWARE_RE.test(f));
  return input.signals.map((provider) => {
    const rules = WIRING_RULES[provider] ?? [];
    const wiringFiles = input.files.filter((f) => rules.some((re) => re.test(f))).sort();
    return {
      provider,
      depEvidence: true, // signal came from AUTH_RULES, which gates on deps
      wiringFiles,
      hasMiddleware: wiringFiles.length > 0 && hasMiddleware,
    };
  });
}
```

NOTE: `hasMiddleware` is per-diagnostic and gated on the provider having any wiring file. This lets the session-owner heuristic in Task A3 use "first provider with middleware wiring" without confusing the case where middleware exists but isn't for this provider.

- [ ] **Step 4: Verify PASS** — `pnpm --filter contractqa exec vitest run tests/inspect-auth.test.ts` — 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/inspect-auth.ts packages/cli/tests/inspect-auth.test.ts
git commit -m "feat(scan): inspectAuthWiring — path-presence rules per provider"
```

---

### Task A2: Wire `--detect-auth` flag through `scanProject`

**Files:**
- Modify: `packages/cli/src/commands/scan.ts`
- Modify: `packages/cli/bin/contractqa.ts` (or wherever the CLI scan handler lives; inspect `bin/contractqa.ts` for the actual binding pattern)
- Modify: `packages/cli/tests/scan.test.ts` (add a test for the flag pass-through)

- [ ] **Step 1: Inspect the existing scan CLI binding**

```bash
grep -n "scan\|--target" packages/cli/bin/contractqa.ts | head
```

Identify how `--target` is registered today — `--detect-auth` will follow the same pattern.

- [ ] **Step 2: Write failing test in `tests/scan.test.ts`**

Append:

```ts
it('scanProject passes detectAuth through and produces authDiagnostics when set', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-detect-auth-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
  }));
  await mkdir(path.join(root, 'app/api/auth/[...nextauth]'), { recursive: true });
  await writeFile(path.join(root, 'app/api/auth/[...nextauth]/route.ts'), '');
  await mkdir(path.join(root, 'lib/supabase'), { recursive: true });
  await writeFile(path.join(root, 'lib/supabase/server.ts'), '');
  await writeFile(path.join(root, 'middleware.ts'), '');

  const r = await scanProject({ cwd: root, detectAuth: true });
  expect(r.authDiagnostics).toBeDefined();
  expect(r.authDiagnostics).toHaveLength(2);
  const providers = r.authDiagnostics!.map((d) => d.provider).sort();
  expect(providers).toEqual(['next-auth', 'supabase']);
});

it('scanProject omits authDiagnostics when detectAuth is false', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-no-detect-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
  }));
  const r = await scanProject({ cwd: root });
  expect(r.authDiagnostics).toBeUndefined();
});
```

(Make sure existing imports at top of file are sufficient — `mkdtemp`, `mkdir`, `writeFile`, `os`, `path` should already be there. Add if missing.)

- [ ] **Step 3: Verify FAIL** — `pnpm --filter contractqa exec vitest run tests/scan.test.ts` — 2 FAIL (`authDiagnostics` not on ScanReport / `detectAuth` not accepted).

- [ ] **Step 4: Modify `scanProject`**

```ts
// packages/cli/src/commands/scan.ts
import { inspectAuthWiring, type AuthDiagnostic } from '../init/inspect-auth.js';

export interface ScanReport {
  // ...existing fields...
  authDiagnostics?: readonly AuthDiagnostic[];
}

export async function scanProject(opts: { cwd: string; target?: string; detectAuth?: boolean }): Promise<ScanReport> {
  // ...existing scan logic ends with `detected.authSignals`...

  let authDiagnostics: readonly AuthDiagnostic[] | undefined;
  if (opts.detectAuth && detected.authSignals.length > 0) {
    authDiagnostics = inspectAuthWiring({
      files,
      signals: detected.authSignals,
    });
  }

  // ...build markdown (Task A3 adds the hybrid section)...

  return {
    // ...existing fields...
    authDiagnostics,
  };
}
```

- [ ] **Step 5: Add `--detect-auth` flag to the CLI binding**

In `bin/contractqa.ts` (or the scan command file), follow the existing `--target` pattern:

```ts
// example shape — adapt to actual CLI lib used
.option('--detect-auth', 'inspect auth wiring; outputs a Hybrid auth section when ≥2 providers')
// ...
const report = await scanProject({ cwd: process.cwd(), target: opts.target, detectAuth: !!opts.detectAuth });
```

- [ ] **Step 6: Verify** — `pnpm --filter contractqa exec vitest run tests/scan.test.ts` — both new tests PASS; existing 2 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/scan.ts packages/cli/bin/contractqa.ts packages/cli/tests/scan.test.ts
git commit -m "feat(scan): --detect-auth flag; surface authDiagnostics on ScanReport"
```

---

### Task A3: Render "## Hybrid auth" markdown section

**Files:**
- Modify: `packages/cli/src/commands/scan.ts`
- Create: `packages/cli/tests/scan-hybrid.test.ts`

**Goal:** When `detectAuth` is set AND `authDiagnostics.length >= 2`, the markdown report gets a `## Hybrid auth` section with:
1. Per-provider block: `### <provider>` with `**Wiring files:**`, `**Has middleware:**`
2. `**Suggested session owner:**` — heuristic-picked provider
3. `**Suggested \`composeAuth\` config:**` — fenced TypeScript code block

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/cli/tests/scan-hybrid.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/commands/scan.js';

describe('scan — hybrid auth markdown', () => {
  it('renders Hybrid auth section when 2 providers + --detect-auth', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-hybrid-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    await mkdir(path.join(root, 'app/api/auth/[...nextauth]'), { recursive: true });
    await writeFile(path.join(root, 'app/api/auth/[...nextauth]/route.ts'), '');
    await mkdir(path.join(root, 'lib/supabase'), { recursive: true });
    await writeFile(path.join(root, 'lib/supabase/server.ts'), '');
    await writeFile(path.join(root, 'middleware.ts'), '');

    const r = await scanProject({ cwd: root, detectAuth: true });
    expect(r.markdown).toContain('## Hybrid auth');
    expect(r.markdown).toContain('### next-auth');
    expect(r.markdown).toContain('### supabase');
    expect(r.markdown).toMatch(/Suggested session owner:\*\* next-auth/);
    expect(r.markdown).toContain('composeAuth({');
    expect(r.markdown).toContain('app/api/auth/[...nextauth]/route.ts');
    expect(r.markdown).toContain('lib/supabase/server.ts');
  });

  it('omits Hybrid auth section when only 1 provider', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-single-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*' },
    }));
    const r = await scanProject({ cwd: root, detectAuth: true });
    expect(r.markdown).not.toContain('## Hybrid auth');
  });

  it('omits Hybrid auth section when --detect-auth is off, even with 2 providers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-scan-hybrid-off-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '*', 'next-auth': '*', '@supabase/ssr': '*' },
    }));
    const r = await scanProject({ cwd: root });
    expect(r.markdown).not.toContain('## Hybrid auth');
  });
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm --filter contractqa exec vitest run tests/scan-hybrid.test.ts` — 3 tests, first FAILs.

- [ ] **Step 3: Add the markdown rendering**

In `scanProject`, after the existing `lines.push(... 'Evidence' section ...)`, add:

```ts
// Hybrid auth section (Phase 6)
if (authDiagnostics && authDiagnostics.length >= 2) {
  const owner = pickSessionOwner(authDiagnostics);
  lines.push(
    '',
    '## Hybrid auth',
    '',
    `Two or more auth providers detected. Use \`composeAuth\` from \`@contractqa/adapters\` to route per-responsibility.`,
    '',
  );
  for (const d of authDiagnostics) {
    lines.push(
      `### ${d.provider}`,
      '',
      `**Wiring files:** ${d.wiringFiles.length ? d.wiringFiles.map((f) => `\`${f}\``).join(', ') : '(none found via path-presence)'}`,
      `**Has middleware:** ${d.hasMiddleware ? 'yes' : 'no'}`,
      '',
    );
  }
  lines.push(
    `**Suggested session owner:** ${owner}`,
    '',
    '**Suggested `composeAuth` config:**',
    '',
    '```ts',
    `import { composeAuth } from '@contractqa/adapters';`,
    `// ...import each adapter per provider above`,
    `const auth = composeAuth({`,
    `  session: '${owner}',`,
    `  adapters: [${authDiagnostics.map((d) => `/* ${d.provider}Adapter */`).join(', ')}],`,
    `});`,
    '```',
    '',
  );
}
```

And add a local helper above the function:

```ts
const SESSION_OWNER_PRIORITY: readonly AuthSignal[] = [
  'next-auth', 'clerk', 'supabase', 'auth0', 'custom-cookie',
];

function pickSessionOwner(diagnostics: readonly AuthDiagnostic[]): AuthSignal {
  // Heuristic: first provider that has middleware wiring; fall back to priority order.
  const withMw = diagnostics.find((d) => d.hasMiddleware);
  if (withMw) return withMw.provider;
  for (const p of SESSION_OWNER_PRIORITY) {
    const hit = diagnostics.find((d) => d.provider === p);
    if (hit) return hit.provider;
  }
  return diagnostics[0]!.provider;
}
```

(Adjust the `AuthSignal` import if needed.)

- [ ] **Step 4: Verify PASS** — all 3 new tests pass; existing scan tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/scan.ts packages/cli/tests/scan-hybrid.test.ts
git commit -m "feat(scan): render Hybrid auth section with composeAuth suggestion"
```

---

### Task A4: README + scan command help update

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/bin/contractqa.ts` (verify the `--detect-auth` help text is informative; tweak if needed)

- [ ] **Step 1: Add a `## Hybrid auth detection` subsection under Phase 6 status (which will be added in Part B's B1 README task — see below; this task ASSUMES B1 has already added the Phase 6 status section. If B1 hasn't run yet, add a minimal Phase 6 status section here with one bullet for hybrid-auth, then B1 will round it out)**

Suggested wording near the Phase 5 status section (insert as Phase 6):

```markdown
## Phase 6 status (hybrid-auth scanner — v0.6.0)

- [x] `contractqa scan --detect-auth` flag inspects `app/api/auth/*`, `middleware.ts`, `lib/supabase/*`, etc.
- [x] Outputs `## Hybrid auth` section with per-provider evidence, suggested session owner, and `composeAuth` config snippet
- [x] 5 minor follow-ups from Phase 5 final review closed (see Part B below)
- [ ] HTTP-API contract surface (B5) — **still deferred** pending a Postgres-wired api-only target
```

Confirm the help text for `--detect-auth` in `bin/contractqa.ts` reads: `inspect auth wiring; outputs a Hybrid auth section when ≥2 providers`. Tighten if Step 5 of Task A2 left it terse.

- [ ] **Step 2: Commit**

```bash
git add README.md packages/cli/bin/contractqa.ts
git commit -m "docs(README): Phase 6 status + scan --detect-auth help text"
```

---

# Part B: QA pass — 5 minor follow-ups from Phase 5 final review

**Acceptance gate B:** All 5 minor items closed (or explicitly deferred with a single-line rationale).

---

### Task B1: `findPnpmPkgDir` — fix comment to match behavior

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts`

The Phase 5 final review noted:
> "Comment says 'Prefer the lowest-versioned one if multiple coexist' but the implementation just does lexicographic sort and picks matches[0], which for 9.6.0 vs 11.10.0 returns 11.10.0."

Phase 5 decided NOT to add semver awareness (out of scope); Phase 6 just fixes the comment.

- [ ] **Step 1: Grep for the stale comment**

```bash
grep -n "lowest-versioned\|Prefer the" packages/cli/src/commands/doctor.ts
```

- [ ] **Step 2: Replace the comment**

Replace the misleading line with: `// Sort lexicographically and pick the first entry — deterministic across runs.`

(If there's additional explanation needed, add one more line: `// NOTE: ASCII sort puts '11.10.0' before '9.6.0'; semver-aware selection is a Phase 7 candidate.`)

- [ ] **Step 3: Verify the doctor-multi-version test still passes**

```bash
pnpm --filter contractqa exec vitest run tests/doctor-multi-version.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/doctor.ts
git commit -m "docs(doctor): clarify findPnpmPkgDir sort comment (matches actual behavior)"
```

---

### Task B2: `host-probe-bounded` test — raise threshold to 250ms

**Files:**
- Modify: `packages/cli/tests/lib/host-probe-bounded.test.ts`

Phase 5 reviewer noted the 100ms wall-clock assertion is generous locally but could flake on a cold CI runner.

- [ ] **Step 1: Edit the threshold**

```ts
expect(elapsed).toBeLessThan(250); // bounded regex; 250ms is generous for cold V8 JIT
```

- [ ] **Step 2: Verify the test still PASSes**

```bash
pnpm --filter contractqa exec vitest run tests/lib/host-probe-bounded.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/lib/host-probe-bounded.test.ts
git commit -m "test(doctor): raise host-probe-bounded threshold to 250ms for CI headroom"
```

---

### Task B3: `detectFrameworkInRepo` — diagnostic when symlinks are skipped

**Files:**
- Modify: `packages/cli/src/init/detect-framework.ts`
- Modify: `packages/cli/tests/detect-framework-monorepo.test.ts`

Phase 5 added the symlink-skip behavior; Phase 6 adds visibility: when at least one symlink was skipped during the walk, surface that fact in `evidence`.

- [ ] **Step 1: Write the failing test**

```ts
// In detect-framework-monorepo.test.ts — append a new test:
it('records symlink-skipped diagnostic in evidence', async () => {
  if (process.platform === 'win32') return; // matches existing symlink-skip test
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-symlink-evidence-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }));
  await mkdir(path.join(root, 'apps'), { recursive: true });
  await mkdir(path.join(root, 'real-pkg'), { recursive: true });
  await writeFile(path.join(root, 'real-pkg/package.json'), JSON.stringify({
    dependencies: { vite: '*', react: '*' },
  }));
  await writeFile(path.join(root, 'real-pkg/vite.config.ts'), '');
  await symlink(path.join(root, 'real-pkg'), path.join(root, 'apps/linked'));
  const r = await detectFrameworkInRepo(root);
  expect(r.evidence.some((e) => /skipped 1 symlinked/.test(e))).toBe(true);
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Modify the walker to count skipped symlinks**

In the walk loop, accumulate a counter:

```ts
let skippedSymlinks = 0;
// in the inner loops:
if (subLst.isSymbolicLink()) { skippedSymlinks++; continue; }
// likewise for scoped inner:
if (scopedLst.isSymbolicLink()) { skippedSymlinks++; continue; }
```

After the walk, if `skippedSymlinks > 0`, push an evidence line:

```ts
if (skippedSymlinks > 0) {
  evidence.push(`skipped ${skippedSymlinks} symlinked subdir${skippedSymlinks > 1 ? 's' : ''}; pass --target to inspect them explicitly`);
}
```

(Adapt `evidence` to whatever the existing accumulator is named.)

- [ ] **Step 4: Verify PASS** — new test passes; existing 7 monorepo tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts packages/cli/tests/detect-framework-monorepo.test.ts
git commit -m "feat(init): record symlink-skipped diagnostic in evidence"
```

---

### Task B4: Postgres CTE regex — JSDoc warning about false-positive risk

**Files:**
- Modify: `packages/adapters/src/backend/postgres.ts`

Phase 5 reviewer flagged that `\b(INSERT|UPDATE|DELETE|...)\b` would also reject SQL containing those words inside string literals (e.g., `WHERE message LIKE '%DELETE%'`). Phase 6 just documents this; behavior unchanged.

- [ ] **Step 1: Locate the FORBIDDEN_DML_DDL declaration**

```bash
grep -n "FORBIDDEN_DML_DDL" packages/adapters/src/backend/postgres.ts
```

- [ ] **Step 2: Add a JSDoc block above it**

```ts
/**
 * Forbidden token regex for read-only DSN guard.
 *
 * Body-wide \b-anchored match. This is intentionally a syntactic guard, not
 * a SQL parser — it WILL produce false positives for queries that legitimately
 * contain DML/DDL tokens inside string literals or column aliases (e.g.,
 * `SELECT msg FROM logs WHERE msg LIKE '%DELETE%'`). Affected queries should
 * be rewritten to avoid the token. A full Postgres parser is a Phase 7+
 * candidate if false positives become a practical pain point.
 */
const FORBIDDEN_DML_DDL = /\b(...)\b/i;
```

(Preserve the existing regex; only add the JSDoc.)

- [ ] **Step 3: Verify** — existing adapter tests still pass:

```bash
pnpm --filter @contractqa/adapters exec vitest run
```

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/src/backend/postgres.ts
git commit -m "docs(adapters): note false-positive risk in FORBIDDEN_DML_DDL regex"
```

---

### Task B5: README Phase 6 status section

**Files:**
- Modify: `README.md`

If Task A4 already added the Phase 6 status section, this task just **rounds it out** with the QA-pass items (B1–B4 + this README task). If A4 did NOT yet run, add the section from scratch.

- [ ] **Step 1: Add or update the Phase 6 status section**

```markdown
## Phase 6 status (hybrid-auth scanner + QA pass — v0.6.0)

- [x] `contractqa scan --detect-auth` flag with path-presence rules per provider
- [x] `## Hybrid auth` markdown section: per-provider evidence + suggested session owner + `composeAuth` config snippet
- [x] `findPnpmPkgDir` comment now matches lexicographic-sort behavior
- [x] `host-probe-bounded` test threshold raised to 250ms for CI headroom
- [x] `detectFrameworkInRepo` records symlink-skipped diagnostic in evidence
- [x] `FORBIDDEN_DML_DDL` regex documents false-positive risk in JSDoc
- [ ] HTTP-API contract surface (B5) — **still deferred** pending Postgres-wired api-only target
```

Also update the "Out of Phase 5 (Phase 6+)" deferred paragraph → "Out of Phase 6 (Phase 7+)" reflecting current state.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(README): Phase 6 status — hybrid-auth scanner + QA pass closed"
```

---

# Part C: Release

### Task C1: scripts/phase6-acceptance.sh — parameterized TARGET

**Files:**
- Create: `scripts/phase6-acceptance.sh`

- [ ] **Step 1: Copy `scripts/phase5-acceptance.sh` to `scripts/phase6-acceptance.sh`**

- [ ] **Step 2: Edit the header (Phase 5 → Phase 6) and parameterize TARGET**

Replace any hardcoded `TARGET="/Users/zmy/intership/5/5-4-codex"` with:

```bash
TARGET="${PHASE_TARGET:-/Users/zmy/intership/5/5-4-codex}"
```

Add a top-of-file note:

```bash
# Override the doctor-fix test target via:
#   PHASE_TARGET=/path/to/repo bash scripts/phase6-acceptance.sh
```

Also adjust the "skipped" echo to mention the env var.

Also update header text from "Phase 5 ships only the final-review QA pass" to "Phase 6 ships hybrid-auth scanner + QA pass".

- [ ] **Step 3: `chmod +x scripts/phase6-acceptance.sh`**

- [ ] **Step 4: Commit**

```bash
git add scripts/phase6-acceptance.sh
git commit -m "chore: scripts/phase6-acceptance.sh — parameterize TARGET via env var"
```

---

### Task C2: `dogfood/FINDINGS.md` close-out

**Files:**
- Modify: `dogfood/FINDINGS.md`

- [ ] **Step 1: Add a new section after the Phase 5 one**

```markdown
## Phase 6 resolution status (v0.6.0)

Findings RESOLVED in Phase 6:
- **Hybrid-auth scanner** (was: Phase 5+ deferred). `contractqa scan --detect-auth` inspects file paths (NextAuth route, Supabase SSR helpers, Clerk middleware, etc.) and emits a structured `## Hybrid auth` section with per-provider evidence, a suggested session owner, and a paste-ready `composeAuth` config snippet. Path-presence only (no file-content parsing); false negatives acceptable, scanner is advisory.

5 minor follow-ups from Phase 5 final review RESOLVED:
- `findPnpmPkgDir` comment-vs-behavior drift (comment now matches lexicographic sort)
- `host-probe-bounded` 100ms → 250ms threshold (CI flake headroom)
- `detectFrameworkInRepo` records symlink-skipped diagnostic in evidence
- `FORBIDDEN_DML_DDL` regex documents false-positive risk in JSDoc
- `scripts/phase6-acceptance.sh` parameterizes TARGET via `PHASE_TARGET` env var

Findings STILL DEFERRED to Phase 7:
- HTTP-API contract surface (B5) — still no Postgres-wired api-only target. Re-evaluate when one shows up, OR pick a different anchor.
- Mongo / Firestore BackendAdapter implementations.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- Semver-aware `findPnpmPkgDir` (currently lexicographic; works for 9.x vs 11.x by accident).
- pnpm-version-aware spawn helper.
```

Also update the "Findings STILL DEFERRED to Phase 6" header (set in Phase 5) → "Findings STILL DEFERRED to Phase 7" with appropriate edits.

- [ ] **Step 2: Commit**

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 6 deliverables; reroll deferred list to Phase 7"
```

---

### Task C3: CHANGELOG + version bump → v0.6.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: every `packages/*/package.json` `version` field
- Modify: `packages/adapters/templates/third-party/package.json` (peer to `^0.6.0`)

- [ ] **Step 1: Add v0.6.0 section to CHANGELOG.md**

Mirrors v0.5.0 structure (Added / Changed / Still deferred). Body summary:
- `contractqa scan --detect-auth` flag + path-presence rules + hybrid markdown section + composeAuth suggestion
- 5 minor Phase 5 follow-ups closed (one bullet each)
- "Still deferred (Phase 7 candidates)": B5 + Mongo/Firestore + everything else carried over from v0.5.0's deferred list, plus the new "semver-aware findPnpmPkgDir" line item.

- [ ] **Step 2: Bump versions**

```bash
for f in packages/*/package.json; do
  sed -i '' 's/"version": "0.5.0"/"version": "0.6.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.5.0"/"@contractqa\/adapters": "^0.6.0"/' packages/adapters/templates/third-party/package.json
```

Verify with `grep '"version"' packages/*/package.json`.

- [ ] **Step 3: Commit (do NOT tag — controller tags after final review + FF-merge)**

```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.6.0 + CHANGELOG (Phase 6 — hybrid-auth scanner)"
```

---

## Self-review notes

1. **Spec coverage:** Hybrid-auth scanner = A1 (rules) + A2 (flag wiring) + A3 (markdown render) + A4 (README/help). 5 minor follow-ups: B1 (doctor comment), B2 (host-probe threshold), B3 (symlink diagnostic), B4 (postgres JSDoc), B5 (README). Release: C1/C2/C3.
2. **Type consistency:** `AuthSignal` already exported from `detect-framework.ts`. New `AuthDiagnostic` type in `inspect-auth.ts`. `ScanReport.authDiagnostics` is optional and absent when `--detect-auth` is off.
3. **Risk:** Path-presence rules may miss less-common conventions (e.g., a custom auth-route path). Acceptable — scanner is advisory.
4. **Risk:** The `composeAuth` snippet is a template, not generated code. User pastes and fills in adapter imports. Documented in Task A3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-contractqa-phase-6.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Same pattern as Phase 4/5. Fresh subagent per task; combined spec/quality review per task; fix-then-merge.

**2. Inline Execution** — Smaller scope than Phase 5 (8 tasks total); could fit in one focused session if subagent dispatches are skipped for purely mechanical tasks.

Estimated size: ~8 tasks (4 Part A + 4 Part B + 3 Part C, with B5 partially overlapping A4); shippable in a single focused 1-2 hour session.
