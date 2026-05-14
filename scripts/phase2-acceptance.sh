#!/usr/bin/env bash
set -euo pipefail
echo "== ContractQA Phase 2 acceptance =="

echo "--- typecheck"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests"
pnpm -r --filter './packages/**' test

echo "--- build"
pnpm -r --filter './packages/**' build

echo "--- generate INVARIANTS.md"
node packages/cli/dist/bin/contractqa.js invariants:gen \
  --contracts qa/contracts --out qa/INVARIANTS.md
grep -q "INV-A2" qa/INVARIANTS.md

echo "--- Phase 1 e2e (fixture-app)"
pnpm --filter @contractqa/e2e test

echo "--- dogfood (5 targets)"
pnpm --filter @contractqa/dogfood test

echo "--- pack:host smoke"
bash scripts/pack-for-host.sh dist-host-acceptance >/dev/null
test -d dist-host-acceptance
ls dist-host-acceptance | grep -q "contractqa-runner-"
rm -rf dist-host-acceptance

echo "--- doctor smoke (against 5-4-codex)"
node packages/cli/dist/bin/contractqa.js doctor /Users/zmy/intership/5/5-4-codex --port 3287 --port 5287

echo "OK — Phase 2 acceptance passed."
