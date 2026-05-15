# Design — `contractqa v1.0.0` Preparation (Phase 13)

**Status:** Draft v2 — pending user review (revised after independent opus review)
**Date:** 2026-05-15
**Author:** Claude (brainstorming session) + zmy
**Successor of:** Phase 12 (v0.12.0 — HTTP runner + adapter polish)

## 1. Goal

Promote `contractqa` from `v0.12.0` → `v1.0.0` as a single Phase 13.
After this phase, the monorepo is ready for `pnpm publish` to npm under any user-supplied scope; the actual publish step is user-gated and out of scope.

The phase produces a public-facing v1.0.0 release with a frozen semver surface, a documented stability policy, and a passing publish dry-run for all 9 publishable packages (8 scoped `@contractqa/*` + the `contractqa` CLI).

## 2. Non-goals

- Running `pnpm publish` against the real npm registry. The publish command stays user-gated.
- A real-Firestore-emulator integration test (kept deferred; `FirestoreBackendAdapter` ships at v1.0.0 as `@experimental`).
- An HTTP dogfood target against a Postgres-wired api-only repo (kept deferred; `runHttpContract` ships at v1.0.0 as `@experimental`).
- Other long-deferred items: `tsc -b` project references, persona dogfood agents, dashboard §15.3–§15.6, property/model-based test generation, pnpm-version-aware spawn helper, file-content `cookies()` parsing for `custom-cookie`, dynamic `$session.userId` resolution.
- Cleanup of `.claire/` directory at repo root (independent housekeeping).

## 3. Scope (deliverables)

Eleven discrete work items, executed inside a single worktree by a bundled sonnet dispatch and validated by an opus final review. The eleven items:

1. Add `publishConfig.access: "public"` + `files: ["dist", "README.md"]` to the 8 non-adapters publishable packages (`contractqa` + 7 internal `@contractqa/*`). Separately, add `engines.node: ">=18"` to all 9 publishable packages — `@contractqa/adapters` has publishConfig and files already but is missing the engines constraint.
2. **Restructure runner exports + Playwright dep classification (linked changes):**
   (a) Add `./http` subpath to `@contractqa/runner`. New file `packages/runner/src/http.ts` re-exports only `runHttpContract` and its associated types (`RunHttpContractInput`, `RunHttpContractResult`) from `./run-contract.js`. Verified by independent review: `run-contract.ts` has **zero** `@playwright` imports (its `page` parameter is structurally typed via `Parameters<typeof snapshotBrowser>[0]` from `@contractqa/probes`, which is also Playwright-free). Update `packages/runner/package.json` `exports` to register `./http`.
   (b) Move `@playwright/test` from `dependencies` to `peerDependencies` with `peerDependenciesMeta["@playwright/test"].optional = true`.
   Pair together is load-bearing: HTTP-only consumers must `import { runHttpContract } from '@contractqa/runner/http'` (not from the root barrel `@contractqa/runner`) to actually skip the Playwright runtime. The root barrel still statically imports `playwright-entry.ts` and will crash at module load without `@playwright/test` installed.
3. CLI runtime Playwright check: at the entry of browser-using CLI commands, detect `@playwright/test` and fail-fast with a one-line install hint if missing. Current CLI command list (from `packages/cli/src/commands/`): `doctor`, `init`, `invariants-gen`, `run`, `scan`. The implementer reads each `commands/*.ts` to determine which transitively `import` from `@contractqa/runner` root (browser-required) vs `@contractqa/runner/http` (HTTP-only) vs neither. Best-guess from filenames: only `run` triggers the browser path. The check is injected only into browser-required command entries. Non-browser commands (e.g., `doctor`, `scan`, `init`, `invariants-gen`) MUST NOT invoke the check.
4. Add an "internal package" warning block to the README of the 7 internal packages (`core`, `runner`, `oracle`, `evidence`, `probes`, `orchestrator`, `repro`). The block tells consumers to install `contractqa` (CLI) or `@contractqa/adapters` instead.
5. Create the repo-root `STABILITY.md` containing: public/internal package classification, `@stable` vs `@experimental` tag policy, deprecation window, breaking-change taxonomy.
6. Trim `packages/adapters/STABILITY.md`: remove sections that are now covered by the root `STABILITY.md` (deprecation window, "What counts as a break", "What does NOT count as a break", "Reporting a break", "How to consume"). Keep adapter-specific content: composeAuth routing change log, per-adapter "Stable since" timeline, Mongo/Firestore-specific rules. Add a header link pointing to the root doc.
7. Add `@experimental` JSDoc tags to `runHttpContract` (in `packages/runner/src/run-contract.ts`) and to `FirestoreBackendAdapter` (in `packages/adapters/src/backend/firestore.ts`, on the class, constructor, and `query` method).
8. Phase 12 leftover polish, all rolled in (file paths pinned for implementer):
   - **Content-Type case-insensitive normalization** in `runHttpContract` (file: `packages/runner/src/run-contract.ts`). Lowercase incoming header names before the `application/json` default check. Add a unit test in `packages/runner/tests/` asserting `Content-Type` (capitalized) does NOT trigger re-application of the default.
   - **`.strict()` on 4 non-http `Action` zod variants** (goto/click/fill/wait) in the core schema file. The 4 variants live in `@contractqa/core`; implementer locates the file via `grep -rln "z.object" packages/core/src/` and `grep -rln "type.*goto" packages/core/src/`. Add a unit test in `packages/core/tests/` asserting unknown keys are rejected for each variant.
   - **JSDoc on `runHttpContract`** (file: `packages/runner/src/run-contract.ts`): add a paragraph clarifying that HTTP response status is informational only; the verdict is driven by post-call `backend_state` checks against the `BackendAdapter`.
9. Lockstep version bump 9 publishable packages 0.12.0 → 1.0.0. `apps/dashboard` stays at its own track (`0.1.0`, `private: true`).
10. Append v1.0.0 entry to `CHANGELOG.md`: opening paragraph framing the release (13 phases, 3-adapter family, HTTP runner, zero breaking changes since v0.4.0), followed by a standard "added / changed / deprecated / removed / fixed" list.
11. Update root `README.md`: add an "Install" section with `npm install contractqa @contractqa/adapters`, a 5-line quick-start using both browser and HTTP runners, and a link to the new `STABILITY.md`.

Plus one supporting deliverable:

12. `scripts/phase13-acceptance.sh` — release-lane validation script (build, typecheck, test, version uniformity check, publish dry-run for 8 packages, CLI tarball spot-check).

## 4. Package configuration matrix

| Package | Role | publishConfig | files | engines.node | STABILITY | README warning |
|---|---|---|---|---|---|---|
| `contractqa` (CLI) | public | `access: public` | `["dist", "README.md"]` | `>=18` | covered by root | none (public entry) |
| `@contractqa/adapters` | public | already set | already set | `>=18` (add) | own + root | none (public entry) |
| `@contractqa/core` | internal | add | add | add | root | add |
| `@contractqa/runner` | internal | add | add | add | root + `@experimental` on `runHttpContract` | add |
| `@contractqa/oracle` | internal | add | add | add | root | add |
| `@contractqa/evidence` | internal | add | add | add | root | add |
| `@contractqa/probes` | internal | add | add | add | root | add |
| `@contractqa/orchestrator` | internal | add | add | add | root | add |
| `@contractqa/repro` | internal | add | add | add | root | add |
| `apps/dashboard` | not published | n/a (already `private: true`) | n/a | n/a | n/a | n/a |

The CLI package keeps its `bin` field (`./dist/bin/contractqa.js`); `files` is sufficient because npm automatically includes `bin` targets in tarballs.

`@contractqa/runner`'s `exports` field gains a third entry alongside `.` and `./reporter`: `./http` → `./dist/http.js` (+ types). See §5 and §6 for the rationale.

## 5. Public surface decisions

- **Two semver-protected public surfaces**: `contractqa` (the CLI commands and their flags) and `@contractqa/adapters/public`. The root entry of `@contractqa/adapters` remains internal — consumers must import from `@contractqa/adapters/public` to get semver protection.
- **The 7 internal packages**: entire root entry is internal. No `/public` subpath is added. The README warning is the only stability statement consumers see at install time.
- **`@contractqa/runner` has subpaths `/reporter` and `/http`.** `/reporter` (existing) is for Playwright config `import`. `/http` (new in v1.0.0) is the **recommended HTTP-only entry point** — importing `runHttpContract` from it is what lets HTTP-only consumers avoid loading `@playwright/test`. The runner root barrel remains internal AND statically loads `playwright-entry.ts`, so it still requires `@playwright/test`. Browser-using consumers continue to use the CLI (`contractqa run`); direct `import { runContract } from '@contractqa/runner'` works but is internal-surface.
- **HTTP runner (`runHttpContract`)** is tagged `@experimental` at v1.0.0. Its API may change in any minor. Although it lives in an internal package, the `/http` subpath makes it a documented v1.0 entry point — the `@experimental` tag is therefore load-bearing for consumers who follow the recommended HTTP path. Any breaking change to `runHttpContract`'s signature must be called out as such in minor-release notes.
- **`FirestoreBackendAdapter`** is tagged `@experimental` at v1.0.0. Re-exported from `@contractqa/adapters/public` (the public surface), so the `@experimental` tag is load-bearing for consumers — Phase 14+ may change its API.

## 6. Playwright dependency classification

`@contractqa/runner` moves `@playwright/test` from `dependencies` to:

```json
"peerDependencies": {
  "@playwright/test": "^1.49.0"
},
"peerDependenciesMeta": {
  "@playwright/test": { "optional": true }
}
```

Consequences:
- `npm install contractqa` no longer pulls Playwright by default.
- **HTTP-only consumers who import from `@contractqa/runner/http` save ~200MB** of browser binaries. If they instead import from `@contractqa/runner` root, the static import of `playwright-entry.ts` will crash at module load — they must use the `/http` subpath.
- Browser-using consumers must run `npm install @playwright/test && npx playwright install chromium` once.
- The CLI detects `@playwright/test` at the entry of browser-using commands and prints a one-line fail-fast if it's missing. Non-browser CLI commands (`doctor`, `scan`, `init`, `invariants-gen`) must NOT call the check.
- **TypeScript users importing `ContractQAReporter` or `ReporterOptions` from the runner root still need `@playwright/test` installed** to resolve the type imports in `reporter.ts`. This is unchanged from v0.12.0 (it's a type-only requirement, not a runtime one) but is called out in the CHANGELOG.
- `apps/dashboard` and the contractqa monorepo's own tests still install `@playwright/test` via `devDependencies` of `@contractqa/runner` (or explicit install) — no behavior change for development.

## 7. STABILITY documentation structure

### 7.1 Repo-root `STABILITY.md` (new)

Sections:

1. **Overview** — what semver promise contractqa makes at v1.0.0.
2. **Public packages** — `contractqa` (CLI), `@contractqa/adapters/public`. Behavior: semver-protected.
3. **Internal packages** — the 7 internal packages, listed. Behavior: any minor release may change anything in their root entry. Consumers should not import them directly.
4. **Stability tags** — `@stable` vs `@experimental` JSDoc semantics. v1.0.0 experimental list: `runHttpContract`, `FirestoreBackendAdapter`.
5. **Deprecation window** — copy from current `packages/adapters/STABILITY.md`: `@deprecated` tag in minor that announces removal, kept at least one full minor cycle, removed only in next major.
6. **What counts as a break** — copy + extend from adapters' current list to cover all public surfaces.
7. **What does NOT count as a break** — copy from adapters.
8. **Reporting a break** — copy from adapters.

### 7.2 `packages/adapters/STABILITY.md` (trimmed)

Keep:
- Header link to root `STABILITY.md` ("This document covers adapter-specific stability notes. See [/STABILITY.md](../../STABILITY.md) for the repo-wide policy.")
- Versioned change log (`v0.4.0`, `Stable since v0.8.0`, `Stable since v0.11.0`)
- `Public surface` paragraph (the `@contractqa/adapters/public` semver contract is adapter-specific)

Delete (moved to root):
- "Deprecation window"
- "What counts as a break"
- "What does NOT count as a break"
- "Reporting a break"
- "How to consume"

## 8. CLI Playwright runtime check

Current CLI commands (from `packages/cli/src/commands/`): `doctor`, `init`, `invariants-gen`, `run`, `scan`. Best-guess browser-required set: just `run`. The implementer verifies by reading each `commands/*.ts` and checking which transitively `import` from `@contractqa/runner` root (browser path) vs `@contractqa/runner/http` (HTTP path) vs neither. The check is injected only into the browser-required entries.

At the entry of those browser-using commands:

```ts
function requirePlaywright() {
  try {
    require.resolve('@playwright/test');
  } catch {
    console.error(
      "@playwright/test is not installed.\n" +
      "Install it with:  npm install @playwright/test && npx playwright install chromium"
    );
    process.exit(1);
  }
}
```

The check runs before any code that imports `@contractqa/runner`'s Playwright path. HTTP-only commands skip the check entirely. The implementer must enumerate the CLI command list and tag each as "browser-required" or "HTTP-only".

## 9. Version bump

All 9 publishable packages bumped lockstep `0.12.0` → `1.0.0`:

- `contractqa`
- `@contractqa/adapters`
- `@contractqa/core`
- `@contractqa/runner`
- `@contractqa/oracle`
- `@contractqa/evidence`
- `@contractqa/probes`
- `@contractqa/orchestrator`
- `@contractqa/repro`

Not bumped:
- Root `package.json` (`"version": "0.0.0"`, not published, stays as-is)
- `apps/dashboard/package.json` (`"version": "0.1.0"`, `"private": true`, stays as-is)

After bumping, the acceptance script verifies version uniformity across publishable packages.

## 10. Phase 12 leftover polish (rolled in)

All three items live in `@contractqa/core` (schema) and `@contractqa/runner` (HTTP runner):

1. **Content-Type case-insensitive normalization** — in `runHttpContract`, before the default `application/json` check on the request body, normalize all incoming header names to lowercase. Add a unit test with `Content-Type` (capitalized) verifying the default is NOT re-applied.
2. **`.strict()` on 4 non-http Action variants** — `goto`, `click`, `fill`, `wait` zod schemas get `.strict()` to match the http variant. Add a unit test asserting unknown keys are rejected for each variant.
3. **JSDoc on `runHttpContract`** — add: "The HTTP response status code is informational only. The verdict is driven by post-call `backend_state` checks against the `BackendAdapter`."

## 11. CHANGELOG entry shape

```markdown
## v1.0.0 — 2026-05-15

This is contractqa's 1.0 release. Twelve consecutive minor releases
(v0.5.0 → v0.12.0) shipped without a breaking change since v0.4.0; this is
Phase 13, the v1.0.0 milestone — the public API is now frozen under semver.

### What's stable at 1.0

- `contractqa` CLI commands and flags
- `@contractqa/adapters/public` — the three-member BackendAdapter family
  (Postgres, Mongo, Firestore — Firestore is `@experimental`, see below),
  all AuthAdapters, `composeAuth`
- The contract schema (action types except http, oracle rules, evidence bundle
  layout)
- `runContract` (Playwright)

### What's experimental at 1.0

- `runHttpContract` (no real dogfood target yet) — exposed via the new
  `@contractqa/runner/http` subpath
- `FirestoreBackendAdapter` (mocked-only tests; real-emulator integration deferred)

### Added

- `@contractqa/runner/http` subpath — Playwright-free entry point for
  HTTP-only consumers. New file `packages/runner/src/http.ts` re-exports
  `runHttpContract` and its associated types.
- Root `STABILITY.md`
- `engines.node >= 18` on all 9 publishable packages
- CLI runtime check for `@playwright/test` (browser commands only — currently
  just `run`)
- `.strict()` enforcement on 4 non-http Action schema variants (goto/click/
  fill/wait)
- Content-Type case-insensitive normalization in `runHttpContract`

### Changed (non-breaking)

- `@playwright/test` reclassified from `dependencies` to optional
  `peerDependencies` in `@contractqa/runner`. **HTTP-only consumers must
  import from `@contractqa/runner/http`** to actually skip the Playwright
  install — the runner root barrel still loads `playwright-entry.ts` at
  module init. Browser-using consumers run
  `npm install @playwright/test && npx playwright install chromium` once.
- TypeScript users importing `ContractQAReporter` or `ReporterOptions` from
  `@contractqa/runner` root must still have `@playwright/test` installed for
  TS type resolution (its `reporter.ts` imports types from
  `@playwright/test/reporter`). This is a type-only requirement, unchanged
  from v0.12.0; documented here for completeness.
- `packages/adapters/STABILITY.md` trimmed; common policy moved to root doc.
  Adapter-specific sections (`composeAuth` routing log, per-adapter "Stable
  since" timelines, Mongo/Firestore-specific rules) remain.
- 7 internal packages now print an "internal — please use the `contractqa`
  CLI or `@contractqa/adapters` instead" notice at the top of their READMEs.

### Notes

`pnpm publish` to the npm registry is user-gated; this release is tagged
locally and the publish step is taken outside CI by the maintainer. The
`scripts/phase13-acceptance.sh` script validates that `pnpm publish
--dry-run` passes for all 9 publishable packages.
```

## 12. Root README quick-start shape

A new "Install" section near the top:

```markdown
## Install

\`\`\`bash
npm install contractqa @contractqa/adapters
# Browser-flow users also need:
npm install @playwright/test
npx playwright install chromium
\`\`\`

See [STABILITY.md](./STABILITY.md) for the semver surface and stability policy.

## Quick start

\`\`\`ts
// Browser flow (requires @playwright/test)
import { runContract } from '@contractqa/runner';
import { compileContract } from '@contractqa/core';

// HTTP flow (no browser required — must use /http subpath)
import { runHttpContract } from '@contractqa/runner/http';  // @experimental
\`\`\`
```

## 13. Execution

### 13.1 Worktree + bundled sonnet dispatch + opus final review

Following the Phase 7–12 pattern:

1. `superpowers:writing-plans` produces a plan doc from this spec.
2. `EnterWorktree(branch: phase-13-v1)` creates an isolated workspace.
3. A single bundled sonnet dispatch handles all 11 work items + the acceptance script (#12). The dispatch prompt explicitly requires:
   - `pwd && git rev-parse --abbrev-ref HEAD` at start (worktree verification).
   - Tests added/updated for: (a) each Phase 12 polish item, (b) `@contractqa/runner/http` subpath resolution (a Node import smoke test that succeeds without `@playwright/test` in the import graph), (c) CLI Playwright runtime check (asserting non-browser commands skip the check, browser commands invoke it).
   - The CLI Playwright check is added only to browser-using commands; the implementer enumerates the CLI command list (`doctor`, `init`, `invariants-gen`, `run`, `scan`) and tags each by reading the file.
   - `@contractqa/runner/http` subpath is the documented HTTP entry; root barrel is internal. CHANGELOG must say this explicitly.
4. Opus final review reads the diff and checks: package config consistency across the 8 packages, STABILITY content coverage, `@experimental` tag placement, CHANGELOG completeness, dry-run output sanity, no accidental breaking changes vs v0.12.0.
5. Local annotated tag `v1.0.0` is created in the worktree.
6. FF-merge to `main`, push, ExitWorktree(remove).

### 13.2 Acceptance script

`scripts/phase13-acceptance.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

cd "$(git rev-parse --show-toplevel)"

pnpm -r build
pnpm -r typecheck
MONGOMS_SKIP=1 pnpm -r test

# Version uniformity across all 9 publishable packages — extract top-level
# .version via node to avoid grep matching nested "version" fields.
unique=$(
  for f in packages/*/package.json; do
    node -e "console.log(require('./$f').version)"
  done | sort -u | wc -l | tr -d ' '
)
if [[ "$unique" != "1" ]]; then
  echo "FAIL: publishable packages not at same version"
  for f in packages/*/package.json; do
    printf "  %-40s %s\n" "$f" "$(node -e "console.log(require('./$f').version)")"
  done
  exit 1
fi

# Use ephemeral working dirs (mktemp -d) — no stale leftovers between runs.
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
dryrun_dir="$work_dir/dryrun"
cli_pack_dir="$work_dir/cli-pack"
runner_pack_dir="$work_dir/runner-pack"
mkdir -p "$dryrun_dir" "$cli_pack_dir" "$runner_pack_dir"

# Dry-run all 9 publishable packages (8 scoped + 1 CLI). Capture stdout to
# verify pnpm rewrites workspace:* to real semver ranges (Risk #1 in §15).
for pkg in core probes oracle evidence orchestrator repro runner adapters; do
  echo "=== @contractqa/$pkg dry-run ==="
  pnpm --filter "@contractqa/$pkg" publish --dry-run --no-git-checks \
    | tee "$dryrun_dir/$pkg.log"
done
echo "=== contractqa dry-run ==="
pnpm --filter contractqa publish --dry-run --no-git-checks \
  | tee "$dryrun_dir/contractqa.log"

# CLI has the most internal workspace deps — its dry-run output must show
# pnpm-rewritten versions, not literal "workspace:" specs.
if grep -E '"@contractqa/[^"]+":\s*"workspace:' "$dryrun_dir/contractqa.log"; then
  echo "FAIL: dry-run output still contains literal 'workspace:*' — pnpm rewrite did not run"
  exit 1
fi

# CLI tarball spot-check.
pnpm --filter contractqa pack --pack-destination "$cli_pack_dir"
cli_tarballs=( "$cli_pack_dir"/*.tgz )
if [[ ${#cli_tarballs[@]} -eq 0 ]]; then
  echo "FAIL: no CLI tarball produced"
  exit 1
fi
cli_tarball="${cli_tarballs[0]}"
tar -tzf "$cli_tarball" | grep -q "^package/dist/bin/contractqa.js" \
  || { echo "FAIL: CLI bin missing from tarball"; exit 1; }
if tar -tzf "$cli_tarball" | grep -E "^package/(src/|tests/|node_modules/)" >/dev/null; then
  echo "FAIL: tarball contains source/tests/node_modules"
  exit 1
fi

# Runner tarball — must contain dist/http.js (the new /http subpath
# introduced in v1.0.0 for Playwright-free HTTP consumers).
pnpm --filter @contractqa/runner pack --pack-destination "$runner_pack_dir"
runner_tarballs=( "$runner_pack_dir"/*.tgz )
if [[ ${#runner_tarballs[@]} -eq 0 ]]; then
  echo "FAIL: no runner tarball produced"
  exit 1
fi
runner_tarball="${runner_tarballs[0]}"
tar -tzf "$runner_tarball" | grep -q "^package/dist/http.js" \
  || { echo "FAIL: runner tarball missing dist/http.js (new /http subpath)"; exit 1; }

echo "OK"
```

## 14. Acceptance criteria

Phase 13 is complete when all of:

1. `git tag --list | sort -V | tail -1` outputs `v1.0.0`.
2. `git rev-parse --abbrev-ref HEAD` is `main`; tag `v1.0.0` points at HEAD.
3. `pnpm -r build && pnpm -r typecheck` exits 0.
4. `MONGOMS_SKIP=1 pnpm -r test` exits 0 (~222 tests pass / 1-3 skipped).
5. `bash scripts/phase13-acceptance.sh` exits 0.
6. `STABILITY.md` exists at repo root, covers public/internal classification and the stability-tag policy.
7. `runHttpContract` and `FirestoreBackendAdapter` carry `@experimental` JSDoc tags. `FirestoreBackendAdapter` is at `packages/adapters/src/backend/firestore.ts`.
8. CHANGELOG.md top entry is `## v1.0.0` with the structure in §11.
9. README.md top has an Install section linking to STABILITY.md.
10. `@contractqa/runner` exports include `./http` (verified via tarball spot-check in §13.2). A Node-level smoke test confirms `import('@contractqa/runner/http')` resolves without `@playwright/test` in its import graph.
11. Opus final review verdict: 0 Critical / 0 Important.

## 15. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | pnpm dry-run replacing `workspace:*` with an unexpected format | Acceptance script (§13.2) captures CLI dry-run stdout and greps for literal `"workspace:"`; non-zero matches fail the script. |
| 2 | CLI Playwright check fires on non-browser commands (`doctor`/`scan`/`init`/`invariants-gen`) | Implementer reads each `packages/cli/src/commands/*.ts` and tags by which runner subpath it imports from. Check injected only into browser-required entries. Unit test asserts a non-browser command (e.g., `scan`) does NOT invoke the check; another asserts `run` does. |
| 3 | adapters/STABILITY.md trim breaks an existing inbound link | Keep section headings as anchor points; only delete the five sub-sections listed in §7.2. Verify README references after edit. |
| 4 | `engines.node >= 18` is technically a tightening for consumers on v0.x | v1.0.0 is a new major; engines constraint at a major boundary is permitted by semver. Documented in CHANGELOG under "Added". Note: root `package.json` retains `engines.node >= 20.18` as a dev-environment constraint (intentional asymmetry: stricter for contributors, looser for consumers). |
| 5 | Missing one of the 9 packages in version bump | Acceptance script's `unique` count fails fast if any of the 9 `packages/*/package.json` reports a different `.version`. |
| 6 | Phase 12 polish changes miss unit tests | Sonnet dispatch prompt explicitly requires a test per polish item AND for the `/http` subpath resolution AND for the CLI Playwright check (positive + negative cases). Opus review verifies. |
| 7 | The CLI tarball accidentally includes `apps/dashboard` or `src/` or `tests/` | `files` field is the allowlist (`["dist", "README.md"]`); §13.2 tarball spot-check greps `package/(src/|tests/|node_modules/)` to assert no leakage. |
| 8 | adapters STABILITY anchor change orphans `## Stable since v0.x.0` entries | Anchor structure preserved; deleted sub-sections are only generic policy (deprecation window, what counts as a break, what does NOT, reporting, how to consume — 5 sections). |
| 9 | `@contractqa/runner/http` subpath consumer accidentally imports from runner root, still pulls Playwright | The subpath is the documented HTTP entry in CHANGELOG, README quick-start, and `STABILITY.md`. Root barrel keeps the existing playwright-entry static import (no behavioral regression for browser consumers). A README note explicitly warns. |
| 10 | A future CLI subcommand wraps `runHttpContract` and exposes it as a public CLI surface | `@experimental` tag's load-bearing weight is documented in §5. If/when a CLI subcommand surfaces it, the tag must be reviewed at that time. Not a v1.0.0 risk; flagged for future. |

## 16. Rollback

The phase runs inside a git worktree. If sonnet dispatch fails or opus review demands a rework that's beyond a small follow-up, `ExitWorktree(action: remove, discard_changes: true)` leaves `main` untouched. The v1.0.0 tag is created only inside the worktree until FF-merge to `main`; no premature tag on `main`.

If after FF-merge a critical defect surfaces, options:
- Cut `v1.0.1` patch with the fix (preferred — versioning isn't reversible).
- Revert the merge commit and re-tag (only if the defect is bad enough to warrant pulling the milestone).

## 17. Time estimate

Comparable to Phase 11 + Phase 12 combined intensity, with the added `/http` subpath restructuring (minor — single new file + package.json export). Estimate:

- Plan writing (writing-plans skill): 15–20 minutes
- Worktree dispatch (sonnet impl): 70–100 minutes (packaging across 9 packages, STABILITY.md docs, CHANGELOG, README, 3 polish items, `/http` subpath + tests, CLI Playwright check + tests, acceptance script)
- Opus final review + any minor fix loop: 20–30 minutes
- FF-merge, tag, push, ExitWorktree: 10 minutes

Total: 2.0–2.5 hours, conservatively 3 hours if opus review surfaces non-trivial follow-ups.

## 18. Open questions for user review

None at spec time — all design decisions are settled. Independent opus review (round 1) surfaced 3 Critical + 8 Important issues, all addressed in this v2 spec: (a) `@contractqa/runner/http` subpath added to actually deliver Playwright-free HTTP path; (b) `FirestoreBackendAdapter` file path corrected to `packages/adapters/src/backend/firestore.ts`; (c) CLI command references updated to actual command list (`doctor`/`init`/`invariants-gen`/`run`/`scan`); (d) acceptance script hardened for bash robustness, ephemeral working dirs, and `workspace:*` rewrite verification; (e) package count standardized to 9 throughout; (f) reporter-types peer-dep caveat documented in CHANGELOG.

The implementer-time questions (specific CLI command enumeration for the Playwright check by reading each `commands/*.ts`; exact JSDoc wording for `@experimental` tags; the exact `core` schema file containing the 4 Action variants) are routine and resolved by reading the relevant source files inside the worktree.
