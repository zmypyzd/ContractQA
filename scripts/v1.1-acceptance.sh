#!/usr/bin/env bash
# scripts/v1.1-acceptance.sh — run before releasing v1.1.0
set -euxo pipefail

pnpm install
pnpm -r --filter './packages/**' typecheck
pnpm -r --filter './packages/**' test
pnpm -r --filter './packages/**' build

# E2E
MONGOMS_SKIP=1 pnpm --filter @contractqa/e2e test

# pnpm publish dry-run for all 10 publishable packages (orchestrator now has /llm)
pnpm -r --filter './packages/**' publish --dry-run --no-git-checks

echo "v1.1 acceptance: ALL GREEN"
