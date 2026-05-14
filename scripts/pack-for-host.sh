#!/usr/bin/env bash
# Produces tarballs of every @contractqa/* package under $1 (default: dist-host).
# Host projects install with: npm i ./dist-host/<name>-<version>.tgz
set -euo pipefail
OUT_DIR_NAME="${1:-dist-host}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ABS_OUT="$REPO_ROOT/$OUT_DIR_NAME"
rm -rf "$ABS_OUT"
mkdir -p "$ABS_OUT"

cd "$REPO_ROOT"
pnpm -r --filter './packages/**' build

for pkg in packages/*; do
  if [ -f "$pkg/package.json" ]; then
    pushd "$pkg" >/dev/null
    pnpm pack --pack-destination "$ABS_OUT"
    popd >/dev/null
  fi
done

ls -la "$ABS_OUT"
echo "OK — tarballs in $ABS_OUT. Install in a host with: npm i file:./path/to/$OUT_DIR_NAME/<name>-<version>.tgz"
