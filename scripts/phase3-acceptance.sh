#!/usr/bin/env bash
set -euo pipefail

# ContractQA Phase 3 acceptance script.
# Default mode: stub-env only. Pass --real-cloud to also run the
# docker-compose Supabase lane (B5/B6).

MODE="default"
if [[ "${1:-}" == "--real-cloud" ]]; then
  MODE="real-cloud"
fi

echo "== ContractQA Phase 3 acceptance (mode=$MODE) =="

# Build MUST precede typecheck (see scripts/phase2-acceptance.sh comment).
echo "--- build"
pnpm -r --filter './packages/**' build

echo "--- typecheck"
pnpm -r --filter './packages/**' typecheck

echo "--- unit tests"
pnpm -r --filter './packages/**' test

echo "--- generate INVARIANTS.md"
node packages/cli/dist/bin/contractqa.js invariants:gen \
  --contracts qa/contracts --out qa/INVARIANTS.md
grep -q "INV-A2" qa/INVARIANTS.md

echo "--- Phase 1 e2e (fixture-app)"
pnpm --filter @contractqa/e2e test

echo "--- dogfood (5 Phase 2 targets, stub-env)"
pnpm --filter @contractqa/dogfood test

echo "--- pack:host smoke"
bash scripts/pack-for-host.sh dist-host-acceptance >/dev/null
test -d dist-host-acceptance
ls dist-host-acceptance | grep -q "contractqa-runner-"
ls dist-host-acceptance | grep -q "contractqa-adapters-"
rm -rf dist-host-acceptance

echo "--- Part A: contractqa init/scan smoke (synthetic tmpdir)"
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT
cat > "$WORK/package.json" <<'JSON'
{ "name": "phase3-acceptance-fixture", "dependencies": { "vite": "^5", "react": "^18" } }
JSON
echo "" > "$WORK/vite.config.ts"
(cd "$WORK" && node "$(pwd)/../packages/cli/dist/bin/contractqa.js" init --yes 2>&1 | head -3) || true
# More robust: use absolute path to bin
CQA="$(pwd)/packages/cli/dist/bin/contractqa.js"
rm -rf "$WORK/qa" "$WORK/contractqa.config.ts"
(cd "$WORK" && node "$CQA" init --yes --force 2>&1 | head -3)
test -f "$WORK/contractqa.config.ts" || { echo "init did not write contractqa.config.ts"; exit 1; }
test -f "$WORK/qa/contracts/smoke.contract.yaml" || { echo "init did not write smoke contract"; exit 1; }
(cd "$WORK" && node "$CQA" scan 2>&1 | head -3)
test -f "$WORK/qa/SCAN_REPORT.md" || { echo "scan did not write SCAN_REPORT.md"; exit 1; }
grep -q "vite-react" "$WORK/qa/SCAN_REPORT.md" || { echo "scan report missing detected framework"; exit 1; }

echo "--- Part A: doctor --fix=all (against 5-4-codex)"
node "$CQA" doctor /Users/zmy/intership/5/5-4-codex --port 3287 --port 5287 --fix=all | grep -E '\[(ok|FAIL)\]'

echo "--- Part C: out-of-tree adapter builds against @contractqa/adapters/public"
bash scripts/test-third-party-adapter.sh >/dev/null
echo "  out-of-tree adapter built successfully"

if [[ "$MODE" == "real-cloud" ]]; then
  echo "--- Part B: real-cloud lane (Supabase docker stack)"
  bash fixtures/supabase-stack/scripts/up.sh
  set +e
  bash fixtures/supabase-stack/scripts/seed.sh
  SEED_RC=$?
  if [ $SEED_RC -eq 0 ]; then
    bash dogfood/5-4-claude/scripts/test-real-cloud.sh
    REAL_RC=$?
  else
    REAL_RC=$SEED_RC
  fi
  bash fixtures/supabase-stack/scripts/down.sh || true
  set -e
  if [ $REAL_RC -ne 0 ]; then
    echo "real-cloud lane FAILED (exit $REAL_RC)"
    exit 1
  fi
fi

echo
echo "OK — Phase 3 acceptance passed."
