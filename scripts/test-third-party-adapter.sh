#!/usr/bin/env bash
# Smoke test: out-of-tree adapter builds against the local @contractqa/adapters public surface.
# Steps:
#   1. Build all packages.
#   2. Pack @contractqa/adapters and @contractqa/core to tarballs.
#   3. Copy the starter template to /tmp.
#   4. Rewrite its package.json to use file: installs of the local tarballs.
#   5. Run npm install + npm run build.
#   6. Assert dist/index.js and dist/index.d.ts exist.
#   7. Assert ExampleAuthAdapter is importable from dist/index.js.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

TMP=$(mktemp -d -t contractqa-thirdparty-XXXXXX)

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

# ── Step 1: Build all packages ──────────────────────────────────────────────
echo "==> Building all packages (must be up-to-date before pack)..."
(cd "$REPO_ROOT" && pnpm -r --filter './packages/**' build 2>&1) | grep -v "^$" || true

# ── Step 2: Pack tarballs directly (avoids pack-for-host.sh path restriction) ─
PKGS_DIR="$TMP/host-pkgs"
mkdir -p "$PKGS_DIR"

echo "==> Packing @contractqa/adapters..."
(cd "$REPO_ROOT/packages/adapters" && pnpm pack --pack-destination "$PKGS_DIR" 2>&1) | grep -v "^$" || true

echo "==> Packing @contractqa/core..."
(cd "$REPO_ROOT/packages/core" && pnpm pack --pack-destination "$PKGS_DIR" 2>&1) | grep -v "^$" || true

ADAPTERS_TGZ=$(ls "$PKGS_DIR"/contractqa-adapters-*.tgz 2>/dev/null | head -1)
CORE_TGZ=$(ls "$PKGS_DIR"/contractqa-core-*.tgz 2>/dev/null | head -1)

if [ -z "$ADAPTERS_TGZ" ]; then
  echo "ERROR: pack did not produce contractqa-adapters-*.tgz in $PKGS_DIR"
  ls "$PKGS_DIR"
  exit 1
fi
if [ -z "$CORE_TGZ" ]; then
  echo "ERROR: pack did not produce contractqa-core-*.tgz in $PKGS_DIR"
  ls "$PKGS_DIR"
  exit 1
fi

echo "  adapters tarball: $ADAPTERS_TGZ"
echo "  core tarball:     $CORE_TGZ"

# ── Step 3: Copy the starter template ───────────────────────────────────────
EXAMPLE_DIR="$TMP/example-adapter"
echo "==> Copying starter template to $EXAMPLE_DIR"
cp -r "$REPO_ROOT/packages/adapters/templates/third-party/" "$EXAMPLE_DIR"

# ── Step 4: Rewrite package.json to point at local tarballs ─────────────────
echo "==> Rewriting package.json to point at local tarballs"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$EXAMPLE_DIR/package.json', 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies['@contractqa/adapters'] = 'file:$ADAPTERS_TGZ';
pkg.dependencies['@contractqa/core'] = 'file:$CORE_TGZ';
fs.writeFileSync('$EXAMPLE_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

cat "$EXAMPLE_DIR/package.json"

# ── Step 5: npm install + build ──────────────────────────────────────────────
cd "$EXAMPLE_DIR"

echo "==> Installing dependencies"
npm install --silent --no-audit --no-fund

echo "==> Building"
npm run build

# ── Step 6: Assert build outputs ────────────────────────────────────────────
echo "==> Verifying build output"
test -f dist/index.js  || { echo "FAIL: dist/index.js not produced";  exit 1; }
test -f dist/index.d.ts || { echo "FAIL: dist/index.d.ts not produced"; exit 1; }
echo "  dist/index.js    ✓"
echo "  dist/index.d.ts  ✓"

# ── Step 7: Runtime import check ────────────────────────────────────────────
echo "==> Verifying ExampleAuthAdapter is importable from dist/index.js"
node --input-type=module -e "
import('./dist/index.js').then((m) => {
  if (typeof m.ExampleAuthAdapter !== 'function') {
    console.error('FAIL: ExampleAuthAdapter not exported from dist/index.js');
    process.exit(1);
  }
  console.log('  ExampleAuthAdapter exported correctly ✓');
}).catch((err) => {
  console.error('FAIL: import error —', err.message);
  process.exit(1);
});
"

echo
echo "OK — out-of-tree adapter builds against @contractqa/adapters/public surface."
