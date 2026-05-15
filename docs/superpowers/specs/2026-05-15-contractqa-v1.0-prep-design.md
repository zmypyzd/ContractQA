# Design — `contractqa v1.0.0` Preparation (Phase 13)

**Status:** Draft — pending user review
**Date:** 2026-05-15
**Author:** Claude (brainstorming session) + zmy
**Successor of:** Phase 12 (v0.12.0 — HTTP runner + adapter polish)

## 1. Goal

Promote `contractqa` from `v0.12.0` → `v1.0.0` as a single Phase 13.
After this phase, the monorepo is ready for `pnpm publish` to npm under any user-supplied scope; the actual publish step is user-gated and out of scope.

The phase produces a public-facing v1.0.0 release with a frozen semver surface, a documented stability policy, and a passing publish dry-run for all 8 publishable packages.

## 2. Non-goals

- Running `pnpm publish` against the real npm registry. The publish command stays user-gated.
- A real-Firestore-emulator integration test (kept deferred; `FirestoreBackendAdapter` ships at v1.0.0 as `@experimental`).
- An HTTP dogfood target against a Postgres-wired api-only repo (kept deferred; `runHttpContract` ships at v1.0.0 as `@experimental`).
- Other long-deferred items: `tsc -b` project references, persona dogfood agents, dashboard §15.3–§15.6, property/model-based test generation, pnpm-version-aware spawn helper, file-content `cookies()` parsing for `custom-cookie`, dynamic `$session.userId` resolution.
- Cleanup of `.claire/` directory at repo root (independent housekeeping).

## 3. Scope (deliverables)

Eleven discrete work items, executed inside a single worktree by a bundled sonnet dispatch and validated by an opus final review. The eleven items:

1. Add `publishConfig.access: "public"` + `files: ["dist", "README.md"]` to the 8 non-adapters publishable packages (`contractqa` + 7 internal `@contractqa/*`). Separately, add `engines.node: ">=18"` to all 9 publishable packages — `@contractqa/adapters` has publishConfig and files already but is missing the engines constraint.
2. Reclassify `@playwright/test` in `@contractqa/runner`: move from `dependencies` to `peerDependencies`, mark optional via `peerDependenciesMeta`.
3. CLI runtime Playwright check: at the entry of browser-using commands (`run`, `dogfood`, etc.), detect `@playwright/test` and fail-fast with a one-line install hint if missing. HTTP-only command paths must NOT trigger this check.
4. Add an "internal package" warning block to the README of the 7 internal packages (`core`, `runner`, `oracle`, `evidence`, `probes`, `orchestrator`, `repro`). The block tells consumers to install `contractqa` (CLI) or `@contractqa/adapters` instead.
5. Create the repo-root `STABILITY.md` containing: public/internal package classification, `@stable` vs `@experimental` tag policy, deprecation window, breaking-change taxonomy.
6. Trim `packages/adapters/STABILITY.md`: remove sections that are now covered by the root `STABILITY.md` (deprecation window, "What counts as a break", "What does NOT count as a break", "Reporting a break", "How to consume"). Keep adapter-specific content: composeAuth routing change log, per-adapter "Stable since" timeline, Mongo/Firestore-specific rules. Add a header link pointing to the root doc.
7. Add `@experimental` JSDoc tags to `runHttpContract` (in `packages/runner/src/run-contract.ts`) and to `FirestoreBackendAdapter` (in `packages/adapters/src/firestore-backend-adapter.ts`, on the class, constructor, and `query` method).
8. Phase 12 leftover polish, all rolled in:
   - Content-Type case-insensitive normalization in `runHttpContract`: lowercase incoming header names before the JSON default check.
   - Add `.strict()` to the 4 non-http `Action` zod variants (goto/click/fill/wait) for schema-wide consistency.
   - JSDoc on `runHttpContract`: clarify that HTTP response status is informational; verdict is driven by `backend_state` checks.
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

## 5. Public surface decisions

- **Two semver-protected public surfaces**: `contractqa` (the CLI commands and their flags) and `@contractqa/adapters/public`. The root entry of `@contractqa/adapters` remains internal — consumers must import from `@contractqa/adapters/public` to get semver protection.
- **The 7 internal packages**: entire root entry is internal. No `/public` subpath is added. The README warning is the only stability statement consumers see at install time.
- **`@contractqa/runner` has an existing `/reporter` subpath** for Playwright config `import`. This stays. The runner package overall remains internal — `/reporter` is internal too. Consumers calling `runContract` directly are doing so at their own risk; the recommended path is via `contractqa` CLI.
- **HTTP runner (`runHttpContract`)** is tagged `@experimental` at v1.0.0. Its API may change in any minor. It is exported from `@contractqa/runner` root (which is internal anyway), so the `@experimental` tag is primarily for documentation honesty.
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
- `npm install contractqa` no longer pulls Playwright by default. HTTP-only users save ~200MB of browser binaries.
- Browser-using users must run `npm install @playwright/test && npx playwright install chromium` once.
- The CLI detects Playwright at the entry of browser-using commands and prints a one-line fail-fast if it's missing. HTTP-only commands (`run-http`, etc.) must NOT call the check.
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

At the entry of browser-using commands (initial set: `run`, `dogfood`; final set determined by reading `packages/cli/src/`):

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

This is contractqa's 1.0 release. Thirteen consecutive phases shipped without a
breaking change since v0.4.0; the public API is now frozen under semver.

### What's stable at 1.0

- `contractqa` CLI commands and flags
- `@contractqa/adapters/public` — the three-member BackendAdapter family
  (Postgres, Mongo, Firestore), all AuthAdapters, `composeAuth`
- The contract schema (action types except http, oracle rules, evidence bundle
  layout)
- `runContract` (Playwright)

### What's experimental at 1.0

- `runHttpContract` (no real dogfood target yet)
- `FirestoreBackendAdapter` (mocked-only tests; real-emulator integration deferred)

### Added

- Root `STABILITY.md`
- `engines.node >= 18` on all publishable packages
- CLI runtime check for `@playwright/test`
- `.strict()` enforcement on 4 non-http Action schema variants
- Content-Type case-insensitive normalization in `runHttpContract`

### Changed (non-breaking)

- `@playwright/test` reclassified from `dependencies` to optional
  `peerDependencies` in `@contractqa/runner`. Browser-using consumers must
  install `@playwright/test` explicitly. HTTP-only consumers are unaffected.
- `packages/adapters/STABILITY.md` trimmed; common policy moved to root doc.
- 7 internal packages now print an "internal" notice in their READMEs.

### Notes

`pnpm publish` to the npm registry is user-gated; this release is tagged
locally and the publish step is taken outside CI by the maintainer.
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
// Browser flow
import { runContract } from '@contractqa/runner';
import { compileContract } from '@contractqa/core';

// HTTP flow (no browser required)
import { runHttpContract } from '@contractqa/runner';  // @experimental
\`\`\`
```

## 13. Execution

### 13.1 Worktree + bundled sonnet dispatch + opus final review

Following the Phase 7–12 pattern:

1. `superpowers:writing-plans` produces a plan doc from this spec.
2. `EnterWorktree(branch: phase-13-v1)` creates an isolated workspace.
3. A single bundled sonnet dispatch handles all 11 work items + the acceptance script (#12). The dispatch prompt explicitly requires:
   - `pwd && git rev-parse --abbrev-ref HEAD` at start (worktree verification).
   - Tests added/updated for each Phase 12 polish item.
   - The CLI Playwright check is added only to browser-using commands; the implementer enumerates the CLI command list and tags each.
4. Opus final review reads the diff and checks: package config consistency across the 8 packages, STABILITY content coverage, `@experimental` tag placement, CHANGELOG completeness, dry-run output sanity, no accidental breaking changes vs v0.12.0.
5. Local annotated tag `v1.0.0` is created in the worktree.
6. FF-merge to `main`, push, ExitWorktree(remove).

### 13.2 Acceptance script

`scripts/phase13-acceptance.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

pnpm -r build
pnpm -r typecheck
MONGOMS_SKIP=1 pnpm -r test

# Version uniformity across publishable packages
versions=$(grep -h '"version"' packages/*/package.json | sort -u | wc -l | tr -d ' ')
if [[ "$versions" != "1" ]]; then
  echo "FAIL: publishable packages not at same version"
  grep -H '"version"' packages/*/package.json
  exit 1
fi

# Dry-run all 8 publishable packages
for pkg in core probes oracle evidence orchestrator repro runner adapters; do
  echo "=== @contractqa/$pkg dry-run ==="
  pnpm --filter "@contractqa/$pkg" publish --dry-run --no-git-checks
done
echo "=== contractqa dry-run ==="
pnpm --filter contractqa publish --dry-run --no-git-checks

# CLI tarball spot-check
mkdir -p /tmp/cqa-pack
pnpm --filter contractqa pack --pack-destination /tmp/cqa-pack
tarball=$(ls /tmp/cqa-pack/contractqa-*.tgz | head -1)
tar -tzf "$tarball" | grep -q "^package/dist/bin/contractqa.js" || {
  echo "FAIL: CLI bin missing from tarball"; exit 1;
}
if tar -tzf "$tarball" | grep -E "^package/(src/|tests/|node_modules/)" >/dev/null; then
  echo "FAIL: tarball contains source/tests/node_modules"
  exit 1
fi

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
7. `runHttpContract` and `FirestoreBackendAdapter` carry `@experimental` JSDoc tags.
8. CHANGELOG.md top entry is `## v1.0.0` with the structure in §11.
9. README.md top has an Install section linking to STABILITY.md.
10. Opus final review verdict: 0 Critical / 0 Important.

## 15. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | pnpm dry-run replacing `workspace:*` with an unexpected format | Acceptance script grep dry-run output for `@contractqa/`; if odd, switch deps to `workspace:^` and re-run. |
| 2 | CLI Playwright check fires on HTTP-only commands | Implementer enumerates CLI command list; check only injected into browser-required command entries. Unit test asserting `run-http` command does not invoke the check. |
| 3 | adapters/STABILITY.md trim breaks an existing inbound link | Keep top-level section headings as anchor points; only delete the four sub-sections listed in §7.2. Verify README references after edit. |
| 4 | `engines.node >= 18` is technically a tightening for consumers on v0.x | v1.0.0 is a new major; engines constraint at a major boundary is permitted by semver. Document in CHANGELOG under "Changed". |
| 5 | Missing one of the 9 packages in version bump | Acceptance script's `versions` check fails fast if any package is out of sync. |
| 6 | Phase 12 polish changes miss unit tests | Sonnet dispatch prompt explicitly requires a test per polish item. Opus review checks. |
| 7 | The CLI tarball accidentally includes `apps/dashboard` | `files` field is the allowlist; tarball spot-check grep rules out any path not in `dist/` or `README.md`. |
| 8 | adapters STABILITY anchor change orphans `## Stable since v0.x.0` entries | Anchor structure preserved; sections deleted are only the generic policy ones. |

## 16. Rollback

The phase runs inside a git worktree. If sonnet dispatch fails or opus review demands a rework that's beyond a small follow-up, `ExitWorktree(action: remove, discard_changes: true)` leaves `main` untouched. The v1.0.0 tag is created only inside the worktree until FF-merge to `main`; no premature tag on `main`.

If after FF-merge a critical defect surfaces, options:
- Cut `v1.0.1` patch with the fix (preferred — versioning isn't reversible).
- Revert the merge commit and re-tag (only if the defect is bad enough to warrant pulling the milestone).

## 17. Time estimate

Comparable to Phase 11 + Phase 12 combined intensity (10+ files changed across packaging, docs, schema; one dry-run round). Estimate:

- Plan writing (writing-plans skill): 15 minutes
- Worktree dispatch (sonnet impl): 60–90 minutes
- Opus final review + any minor fix loop: 20–30 minutes
- FF-merge, tag, push, ExitWorktree: 10 minutes

Total: 2.0–2.5 hours.

## 18. Open questions for user review

None at spec time — all design decisions are settled. The implementer-time questions (specific CLI command enumeration for the Playwright check, exact JSDoc wording for `@experimental` tags) are routine and resolved by the implementer reading the relevant source files.
