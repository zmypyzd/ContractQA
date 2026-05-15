# ContractQA Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Maintenance release — close a recurring `apps/dashboard build` failure (the dangling `.js` extension imports in a webpack-resolved Next.js package), plus 4 follow-ups from Phase 6's opus final review. Anchor-less by design; Phase 6 just shipped a feature, Phase 7 hardens the surrounding edges.

**Architecture:** Three parts.

- **Part A — Dashboard build unblock.** Drop the `.js` suffix from 7 relative imports under `apps/dashboard/` so Next.js's webpack resolver can find the `.tsx`/`.ts` sources. The TypeScript ESM convention of explicit `.js` extensions clashes with the `moduleResolution: bundler` setup in Next 15 + webpack. The other packages in this monorepo use plain `tsc` and resolve `.js` extensions fine; only the dashboard goes through webpack.
- **Part B — QA pass.** Four Phase 6 final-review follow-ups: NextAuth v5 route-group regex, `custom-cookie` AuthSignal status note, semver-aware `findPnpmPkgDir`, extract `renderHybridSection` from `scan.ts`.
- **Part C — Release v0.7.0.** Acceptance script, FINDINGS, CHANGELOG, version bump, tag.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest. No new runtime deps. `semver` may be added for B3 (lightweight).

---

## Required reading (before starting)

1. `docs/superpowers/plans/2026-05-15-contractqa-phase-6.md` — last phase's plan; scope-decision pattern.
2. Opus final review of Phase 6 (in this session's transcript) — items #1 (route groups), #2 (custom-cookie), #3 (acceptance script), #4 (composeAuth snippet wording). Item #3 was already closed in Phase 6 C1; items #1, #2, #4 carry to Phase 7.
3. `apps/dashboard/app/issues/[id]/page.tsx`, `apps/dashboard/app/runs/page.tsx`, `apps/dashboard/lib/db.ts` — the 3 source files containing the 7 broken imports.
4. `packages/cli/src/init/inspect-auth.ts` — WIRING_RULES; B1 adds route-group regex.
5. `packages/cli/src/init/detect-framework.ts` — `AuthSignal` union; B2 adds JSDoc.
6. `packages/cli/src/commands/doctor.ts` — `findPnpmPkgDir`; B3 adds semver-aware selection.
7. `packages/cli/src/commands/scan.ts` — `renderHybridSection` extraction target (B4).

---

## Scope decisions (CEO 鸭 verdict 2026-05-15)

| Decision | Verdict |
|---|---|
| Phase 7 anchor count | 0 (anchor-less maintenance release) |
| Dashboard build approach | Drop `.js` extensions in dashboard's relative imports (NOT change tsconfig moduleResolution) |
| Route-group regex | Add ONE more pattern alongside existing app-router rule; don't over-fit |
| custom-cookie AuthSignal | KEEP in the union; add JSDoc "no detector yet — reserved" (Phase 6 reviewer's call) |
| semver-aware findPnpmPkgDir | Add `semver` dep, sort by parsed version (descending — newest first), fall back to lexicographic when parse fails. Doctor multi-version test asserts `11.10.0` still picked over `9.6.0` (now for the RIGHT reason: real semver, not ASCII accident) |
| Extract `renderHybridSection` | Yes — pull into a private helper in `scan.ts` (NOT a new file); keep scan.ts readable |
| Version target | v0.7.0 (consistent rhythm with v0.5.0 / v0.6.0) |
| External repo PRs | Still NO |

---

## Non-goals (do not touch)

- B5 HTTP-API contract surface — still deferred.
- Mongo / Firestore BackendAdapter — Phase 8 candidate.
- TypeScript project references (`tsc -b`) — not the right fix; dashboard build issue is webpack-vs-TS-ESM resolution, NOT cross-package type graph.
- Persona dogfood agents, property/model-based test generation, dashboard §15.3–§15.6.
- File-content parsing for auth detection (still path-presence only).
- Publishing to npm.
- Refactoring `composeAuth` snippet wording in scan.ts beyond what B4 demands.

---

## File structure

**Modified files (Part A):**
- `apps/dashboard/app/issues/[id]/page.tsx`
- `apps/dashboard/app/runs/page.tsx`
- `apps/dashboard/lib/db.ts`

**Modified files (Part B):**
- `packages/cli/src/init/inspect-auth.ts` (B1)
- `packages/cli/src/init/detect-framework.ts` (B2)
- `packages/cli/src/commands/doctor.ts` (B3)
- `packages/cli/src/commands/scan.ts` (B4)
- `packages/cli/package.json` (B3 — add `semver` dep)
- `packages/cli/tests/inspect-auth.test.ts` (B1 — route-group test)
- `packages/cli/tests/doctor-multi-version.test.ts` (B3 — extend assertion)

**Modified files (Part C):**
- `scripts/phase7-acceptance.sh` (NEW; copy phase6's, relabel)
- `dogfood/FINDINGS.md`, `CHANGELOG.md`, 9 `packages/*/package.json`, third-party template peer.

---

## Dependency graph

```
Part A (dashboard) ────┐
                       ├──► Part C (acceptance + release)
Part B (QA pass)   ────┘
```

Suggested worktree: `.claude/worktrees/phase7-exec`.

---

# Part A: Dashboard build unblock

**Acceptance gate A:** `pnpm --filter @contractqa/dashboard run build` exits 0 (or, if that's still flaky for unrelated reasons, the dangling-import error specifically is gone — confirm via error log).

### Task A1: Drop `.js` extensions from dashboard internal imports

**Files (7 imports across 3 files):**
- `apps/dashboard/app/issues/[id]/page.tsx` — lines 3-6 (StateDiffViewer.js, EvidenceLinks.js, db.js, schema.js)
- `apps/dashboard/app/runs/page.tsx` — lines 2-3 (db.js, schema.js)
- `apps/dashboard/lib/db.ts` — line 3 (schema.js)

- [ ] **Step 1: Survey**

```bash
grep -rn "\.js'" apps/dashboard/app apps/dashboard/components apps/dashboard/lib
```

Confirm exactly 7 hits (or whatever count is current).

- [ ] **Step 2: Replace each `.js'` with `'` in those three files**

```bash
sed -i '' "s|\.js';|';|g" apps/dashboard/app/issues/\[id\]/page.tsx
sed -i '' "s|\.js';|';|g" apps/dashboard/app/runs/page.tsx
sed -i '' "s|\.js';|';|g" apps/dashboard/lib/db.ts
```

Verify no `.js'` imports remain:

```bash
grep -rn "\.js'" apps/dashboard/app apps/dashboard/components apps/dashboard/lib
```

Expected: zero hits.

- [ ] **Step 3: Verify dashboard builds**

```bash
pnpm --filter @contractqa/dashboard run build 2>&1 | tail -15
```

Expected: build completes successfully, OR if it fails for a different reason, that reason is NOT a "Module not found: Can't resolve '../components/...'" error. Capture the result.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/issues/\[id\]/page.tsx apps/dashboard/app/runs/page.tsx apps/dashboard/lib/db.ts
git commit -m "fix(dashboard): drop .js extensions on internal imports (webpack resolver)"
```

---

# Part B: QA pass (4 follow-ups)

### Task B1: NextAuth v5 route-group regex in inspect-auth

**Files:**
- `packages/cli/src/init/inspect-auth.ts`
- `packages/cli/tests/inspect-auth.test.ts`

NextAuth v5 supports route groups: `app/(auth)/api/auth/[...nextauth]/route.ts` is a valid wiring location. Existing regex only matches `app/api/auth/...` directly.

- [ ] **Step 1: Append a failing test**

```ts
it('detects next-auth with App Router route-groups', () => {
  const r = inspectAuthWiring({
    files: ['app/(auth)/api/auth/[...nextauth]/route.ts'],
    signals: ['next-auth'],
  });
  expect(r[0]!.wiringFiles).toEqual(['app/(auth)/api/auth/[...nextauth]/route.ts']);
});
```

- [ ] **Step 2: Verify FAIL** — current regex doesn't match.

- [ ] **Step 3: Add a new regex to the `next-auth` rules array**

```ts
/^(src\/)?app\/(\([^)]+\)\/)?api\/auth\/\[\.\.\.nextauth\]\/route\.(ts|tsx|js|jsx|mjs)$/,
```

This optional `(\([^)]+\)\/)?` segment allows ONE route-group prefix between `app/` and `api/`. Don't over-engineer for nested groups (rare).

- [ ] **Step 4: Verify PASS** — existing 4 tests + new 1 = 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/inspect-auth.ts packages/cli/tests/inspect-auth.test.ts
git commit -m "feat(scan): inspect-auth recognizes NextAuth App Router route-groups"
```

---

### Task B2: `custom-cookie` AuthSignal — JSDoc status note

**File:** `packages/cli/src/init/detect-framework.ts`

The `custom-cookie` member of `AuthSignal` has no detector (Phase 6 reviewer flagged this). Keep it in the union (it's part of the public API), but document.

- [ ] **Step 1: Locate the type**

```bash
grep -n "AuthSignal" packages/cli/src/init/detect-framework.ts | head -3
```

- [ ] **Step 2: Add JSDoc above the export**

```ts
/**
 * Auth provider signals detected via package.json deps.
 *
 * `'custom-cookie'` is reserved for future use — no automatic detector exists yet
 * (would need an opinionated heuristic like co-occurrence of `bcrypt`/`bcryptjs` +
 * Next.js `cookies()` usage). Consumers may construct `AuthDiagnostic` with this
 * signal manually if they have their own detection logic. Phase 8 candidate.
 */
export type AuthSignal = 'next-auth' | 'supabase' | 'clerk' | 'auth0' | 'custom-cookie';
```

- [ ] **Step 3: Verify** — existing tests stay green: `pnpm --filter contractqa exec vitest run 2>&1 | tail -5`.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/init/detect-framework.ts
git commit -m "docs(scan): AuthSignal — note custom-cookie has no detector yet"
```

---

### Task B3: Semver-aware `findPnpmPkgDir` selection

**Files:**
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/package.json` (add `semver` dep)
- `packages/cli/tests/doctor-multi-version.test.ts` (extend assertion)

Phase 5 introduced multi-version `.pnpm` handling that "luckily" picks the newest by lexicographic accident (`'1' < '9'`). Phase 7 makes it deterministic by parsing semver.

- [ ] **Step 1: Add `semver` dep**

```bash
pnpm --filter contractqa add semver @types/semver
```

Verify in `packages/cli/package.json` that `semver` (and `@types/semver` in devDeps) are now present.

- [ ] **Step 2: Strengthen the existing test**

In `packages/cli/tests/doctor-multi-version.test.ts`, the current test asserts `fix!.detail` matches `/11\.10\.0/`. That assertion holds under both lexicographic and semver-aware logic. To prove semver-aware behavior, add a second version pair where lex order DISAGREES with semver order — e.g., `10.0.0` vs `9.99.0`. Lex would pick `10.0.0`; semver also picks `10.0.0`. So they agree there. Try `1.0.0` vs `10.0.0`: lex picks `1.0.0` (alphabetic), semver picks `10.0.0`. That's the differentiating case.

Add a NEW test that creates `1.0.0` + `10.0.0` versions and asserts `10.0.0` is selected (which only semver gets right):

```ts
it('selects highest semver version, not lexicographic max (10.0.0 > 1.0.0)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cqa-semver-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { 'better-sqlite3': '^10.0.0' },
  }));
  for (const v of ['1.0.0', '10.0.0']) {
    const dir = path.join(root, 'node_modules/.pnpm', `better-sqlite3@${v}/node_modules/better-sqlite3`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'better-sqlite3', version: v, scripts: {},
    }));
  }
  const r = await doctor({ targetRoot: root, skipBootProbe: true, fix: ['native-deps'] });
  const fix = r.fixesAttempted.find((f) => f.name === 'native-deps');
  expect(fix!.detail).toMatch(/10\.0\.0/);
  expect(fix!.detail).not.toMatch(/^.*1\.0\.0[^0-9]/); // make sure 1.0.0 wasn't picked
});
```

- [ ] **Step 3: Verify FAIL** under the current lexicographic logic.

- [ ] **Step 4: Modify `findPnpmPkgDir`**

Read the current function (likely near the top of doctor.ts). After collecting `matches: string[]` (dir names like `better-sqlite3@1.0.0`), replace the lexicographic sort with a semver-aware sort. Example shape:

```ts
import { rcompare, valid } from 'semver';

// ...inside findPnpmPkgDir, before pick:
matches.sort((a, b) => {
  const va = a.split('@').pop() ?? '';
  const vb = b.split('@').pop() ?? '';
  if (valid(va) && valid(vb)) return rcompare(va, vb); // newest first
  return b.localeCompare(a); // fallback: lex descending (matches old behavior for the existing test)
});
const pick = matches[0];
```

Update the surrounding comment (set in Phase 6 B1) to reflect the new behavior:

```ts
// Sort by parsed semver (descending — newest first); fall back to lexicographic
// when semver parse fails (preserves Phase 5/6 behavior for non-semver dir names).
```

- [ ] **Step 5: Verify PASS** — both old + new tests pass: `pnpm --filter contractqa exec vitest run tests/doctor-multi-version.test.ts 2>&1 | tail -10`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/package.json packages/cli/tests/doctor-multi-version.test.ts
git commit -m "feat(doctor): semver-aware findPnpmPkgDir selection"
```

(Also commit the `pnpm-lock.yaml` change if pnpm modified it; check `git status` and add if needed.)

---

### Task B4: Extract `renderHybridSection` helper from `scan.ts`

**File:** `packages/cli/src/commands/scan.ts`

After Phase 6, `scan.ts` is ~170 lines with a fat Hybrid-auth rendering block inline. Extract into a private helper inside the same file (NOT a new file — that's over-engineering for one helper).

- [ ] **Step 1: Inspect current shape**

```bash
wc -l packages/cli/src/commands/scan.ts
grep -n "## Hybrid auth\|renderHybridSection\|pickSessionOwner\|adapterIdentifier" packages/cli/src/commands/scan.ts
```

- [ ] **Step 2: Extract the entire `if (authDiagnostics && authDiagnostics.length >= 2) { ... }` block** into a helper `function renderHybridSection(authDiagnostics: readonly AuthDiagnostic[]): string[]`. The helper returns the markdown lines (array of strings).

```ts
function renderHybridSection(authDiagnostics: readonly AuthDiagnostic[]): string[] {
  const lines: string[] = [];
  const owner = pickSessionOwner(authDiagnostics);
  lines.push(
    '',
    '## Hybrid auth',
    '',
    'Two or more auth providers detected. Use `composeAuth` from `@contractqa/adapters` to route per-responsibility.',
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
    `// Each adapter declares its own responsibilities. The adapter you give`,
    `// responsibilities: ['session'] (currently suggested: ${owner}) becomes the session owner.`,
    `const auth = composeAuth([`,
    ...authDiagnostics.map((d) => {
      const resps = d.provider === owner ? `['session', 'user-store']` : `['user-store']`;
      return `  ${adapterIdentifier(d.provider)}, // responsibilities: ${resps}`;
    }),
    `]);`,
    '```',
    '',
  );
  return lines;
}
```

Replace the inline block in `scanProject` with:

```ts
if (authDiagnostics && authDiagnostics.length >= 2) {
  lines.push(...renderHybridSection(authDiagnostics));
}
```

- [ ] **Step 3: Verify ALL hybrid tests still pass** (no behavior change — just code organization):

```bash
pnpm --filter contractqa exec vitest run tests/scan-hybrid.test.ts 2>&1 | tail -10  # 4 PASS
pnpm --filter contractqa exec vitest run 2>&1 | tail -5                             # full cli green
```

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/scan.ts
git commit -m "refactor(scan): extract renderHybridSection helper from scanProject"
```

---

# Part C: Release v0.7.0

### Task C1: `scripts/phase7-acceptance.sh`

Copy `scripts/phase6-acceptance.sh` → `scripts/phase7-acceptance.sh`. Relabel headers (Phase 6 → Phase 7). Update the comment block to note this is the maintenance release (dashboard build fix + Phase 6 QA follow-ups; no new anchor surface).

```bash
chmod +x scripts/phase7-acceptance.sh
git add scripts/phase7-acceptance.sh
git commit -m "chore: scripts/phase7-acceptance.sh — maintenance release (Phase 7)"
```

### Task C2: `dogfood/FINDINGS.md`

Add a new section after Phase 6 resolution:

```markdown
## Phase 7 resolution status (v0.7.0)

Maintenance release. Anchor-less by design.

Findings RESOLVED in Phase 7:
- **`apps/dashboard` build was failing on dangling `.js`-suffixed imports.** Next.js webpack resolver can't find `.tsx` sources when imports use the TypeScript ESM `.js` extension convention. Dropped `.js` suffixes from 7 internal dashboard imports.

4 Phase 6 final-review follow-ups RESOLVED:
- NextAuth v5 App Router route-group support: `inspect-auth.ts` recognizes `app/(scope)/api/auth/[...nextauth]/route.ts`.
- `custom-cookie` AuthSignal JSDoc: documents the missing detector and points to a Phase 8 heuristic candidate.
- Semver-aware `findPnpmPkgDir`: added `semver` dep; sorts descending by parsed version; lex fallback when parse fails.
- `renderHybridSection` extracted from `scanProject` into a private helper.

Findings STILL DEFERRED to Phase 8:
- HTTP-API contract surface (B5) — still no Postgres-wired target identified.
- Mongo / Firestore BackendAdapter.
- `custom-cookie` detector (bcrypt + cookies heuristic).
- Persona dogfood agents, property/model-based test generation, dashboard §15.3–§15.6.
- pnpm-version-aware spawn helper.
- File-content parsing for auth detection.
- Dynamic `$session.userId` resolution.
- Publishing to npm (still user-gated).
```

Rename the Phase 7 deferred sub-header (set in Phase 6 as "STILL DEFERRED to Phase 7") to "STILL DEFERRED to Phase 8".

```bash
git add dogfood/FINDINGS.md
git commit -m "docs(findings): record Phase 7 deliverables; reroll deferred list to Phase 8"
```

### Task C3: CHANGELOG + version bump → v0.7.0

In `CHANGELOG.md`, add a v0.7.0 section BEFORE v0.6.0:

```markdown
## v0.7.0 — 2026-05-15 (Phase 7 — maintenance release)

Anchor-less maintenance release. Unblocks `apps/dashboard` build + closes 4 final-review follow-ups from Phase 6.

### Added

- **NextAuth v5 App Router route-group support.** `inspect-auth.ts` now matches `app/(scope)/api/auth/[...nextauth]/route.ts` — common in NextAuth v5 setups that group auth routes.
- **Semver-aware `findPnpmPkgDir`.** Added `semver` dependency; multi-version `.pnpm` selection sorts descending by parsed version (newest first), with lexicographic fallback when parse fails. Replaces Phase 5's lucky-lexicographic behavior. Closes the comment-vs-behavior gap surfaced by Phase 5's final reviewer.

### Changed

- **No breaking changes.** Public API surface unchanged.
- `apps/dashboard` builds: dropped 7 dangling `.js` suffixes from internal imports (Next.js webpack resolver). Affected files: `app/issues/[id]/page.tsx`, `app/runs/page.tsx`, `lib/db.ts`.
- `AuthSignal['custom-cookie']` annotated with JSDoc explaining the missing detector (Phase 8 candidate).
- `scan.ts` refactored: `renderHybridSection` extracted into a private helper for readability. Output unchanged.

### Still deferred (Phase 8 candidates)

- HTTP-API contract surface (B5).
- Mongo / Firestore / custom `BackendAdapter` implementations.
- `custom-cookie` detector heuristic.
- Persona dogfood agents.
- Property/model-based test generation.
- Dashboard §15.3–§15.6.
- TypeScript project references (`tsc -b`).
- File-content parsing for auth detection.
- pnpm-version-aware spawn helper.
- Dynamic `$session.userId` resolution.
- Publishing to npm.
```

Then bump versions:

```bash
for f in packages/*/package.json; do
  sed -i '' 's/"version": "0.6.0"/"version": "0.7.0"/' "$f"
done
sed -i '' 's/"@contractqa\/adapters": "\^0.6.0"/"@contractqa\/adapters": "^0.7.0"/' packages/adapters/templates/third-party/package.json
grep '"version"' packages/*/package.json   # verify 9 → 0.7.0
```

Commit:

```bash
git add CHANGELOG.md packages/*/package.json packages/adapters/templates/third-party/package.json
git commit -m "chore: bump to v0.7.0 + CHANGELOG (Phase 7 maintenance)"
```

Do NOT tag — controller tags after final review + FF-merge.

---

## Self-review notes

1. **Spec coverage:** Part A (1 task) + Part B (4 tasks) + Part C (3 tasks) = 8 tasks. Each item from the opus Phase 6 final-review list is covered or explicitly deferred (B5, Mongo, etc. stay in Phase 8 candidates).
2. **Type consistency:** `AuthDiagnostic` and `AuthSignal` unchanged; B2 only adds JSDoc above `AuthSignal`.
3. **Risk:** B3 changes `findPnpmPkgDir` ordering. The Phase 5/6 doctor-multi-version test asserts `11.10.0` over `9.6.0`; that's still correct under semver (`11.10.0 > 9.6.0`). New test (`10.0.0` vs `1.0.0`) covers the differentiating case.
4. **Risk:** A1 changes 7 imports. If `pnpm --filter @contractqa/dashboard build` still fails for an unrelated reason after the fix, document and don't block Phase 7 release on it.

---

## Execution Handoff

Plan complete. Save state if needed; resume via `/resume-session-handoff` next session.

Execution: `superpowers:subagent-driven-development` with `.claude/worktrees/phase7-exec` worktree (same pattern as Phase 5/6).

Estimated size: ~8 tasks, ~1 hour focused session.
