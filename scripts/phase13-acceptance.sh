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
    node -e "const v=require('./$f').version; if(!v){console.error('missing version: $f'); process.exit(1);} console.log(v)"
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
