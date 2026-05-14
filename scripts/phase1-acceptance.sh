#!/usr/bin/env bash
set -euo pipefail
echo "== ContractQA Phase 1 acceptance =="

echo "--- typecheck (8 packages)"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests (8 packages)"
pnpm -r --filter './packages/**' test

echo "--- build packages"
pnpm -r --filter './packages/**' build

echo "--- generate INVARIANTS.md from qa/contracts/*.yml"
node packages/cli/dist/bin/contractqa.js invariants:gen \
  --contracts qa/contracts --out qa/INVARIANTS.md
grep -q "INV-A2" qa/INVARIANTS.md

echo "--- end-to-end Phase 1 loop"
pnpm --filter @contractqa/e2e test

echo "OK — Phase 1 acceptance passed."
