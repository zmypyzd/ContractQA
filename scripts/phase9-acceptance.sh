#!/usr/bin/env bash
set -euo pipefail

# Phase 9 acceptance script. Closes the family-wide tenant-placeholder gap on BackendAdapter (Postgres + Mongo)
# plus 3 Phase 8 follow-ups (real-Mongo integration test, getDb race fix, next-env.d.ts gitignore).
# Default mode: stub-env + L1. Pass --real-cloud to also run the
# docker-compose Supabase lane (Phase 3 holdover) — Phase 9 ships
# the tenant-placeholder guard + integration test + race fix. B5 (HTTP-API contract surface) is still deferred.

# Override the doctor-fix test target via:
#   PHASE_TARGET=/path/to/repo bash scripts/phase9-acceptance.sh

MODE="default"
if [[ "${1:-}" == "--real-cloud" ]]; then
  MODE="real-cloud"
fi

echo "== ContractQA Phase 9 acceptance (mode=$MODE) =="

# Build MUST precede typecheck (downstream packages typecheck against core's emitted dist/*.d.ts).
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

echo "--- Part A acceptance: doctor --fix=native-deps against 5-4-codex (re-break + heal)"
TARGET="${PHASE_TARGET:-/Users/zmy/intership/5/5-4-codex}"
NODE_FILE="${TARGET}/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
CQA="$(pwd)/packages/cli/dist/bin/contractqa.js"
if [ -f "$NODE_FILE" ]; then
  cp "$NODE_FILE" "$NODE_FILE.bak"
  trap 'mv -f "$NODE_FILE.bak" "$NODE_FILE" 2>/dev/null || true' EXIT
  # Corrupt the binary to force a load failure (simulates ABI mismatch).
  echo "broken" > "$NODE_FILE"
  # Doctor should detect via workspace walker and rebuild via cd .pnpm/PKG@VER && npm run install.
  node "$CQA" doctor --fix=native-deps "$TARGET" 2>&1 | grep -E '\[(ok|FAIL)\] native-deps' | head -3 || true
  # Verify api boots after the fix:
  (env PORT=3287 HOST=127.0.0.1 NODE_ENV=test pnpm --dir "$TARGET" --filter api run dev >/dev/null 2>&1 &)
  sleep 8
  curl -fsS http://127.0.0.1:3287/health >/dev/null && echo "  Part A: api /health 200 after rebuild ✓" || { echo "  Part A: api /health did NOT come up"; pkill -9 -f "tsx watch.*5-4-codex" 2>/dev/null; exit 1; }
  pkill -9 -f "tsx watch.*5-4-codex" 2>/dev/null || true
  mv -f "$NODE_FILE.bak" "$NODE_FILE"
  trap - EXIT
else
  echo "  Part A: skipped (PHASE_TARGET=$TARGET not present)"
fi

echo "--- Part C acceptance: init detects nested apps/web in monorepo (synthetic)"
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT
mkdir -p "$WORK/apps/web"
cat > "$WORK/package.json" <<'JSON'
{ "name": "phase4-monorepo-fixture", "private": true }
JSON
cat > "$WORK/apps/web/package.json" <<'JSON'
{ "name": "web", "dependencies": { "vite": "^5", "react": "^18" } }
JSON
echo "" > "$WORK/apps/web/vite.config.ts"
node "$CQA" init --yes "$WORK" 2>&1 | head -3
test -d "$WORK/apps/web/qa" || { echo "  Part C: init did NOT scaffold into apps/web"; exit 1; }
echo "  Part C: init detected apps/web ✓"
rm -rf "$WORK"
trap - EXIT

echo "--- Part D acceptance: composeAuth per-responsibility test"
pnpm --filter @contractqa/adapters exec vitest run tests/composite-auth-adapter.test.ts 2>&1 | tail -5

echo "--- Part B unit: PostgresBackendAdapter + runner backend_state evaluator"
pnpm --filter @contractqa/adapters exec vitest run tests/postgres-readonly.test.ts tests/postgres-tenant.test.ts 2>&1 | tail -3
pnpm --filter @contractqa/runner exec vitest run tests/backend-state.test.ts 2>&1 | tail -3

echo "--- Phase 9 specific: tenant-placeholder body reference check (Postgres + Mongo)"
pnpm --filter @contractqa/adapters exec vitest run tests/postgres-readonly.test.ts tests/mongo-readonly.test.ts 2>&1 | tail -5

echo "--- Phase 9 specific: MongoBackendAdapter real-Mongo integration test"
pnpm --filter @contractqa/adapters exec vitest run tests/mongo-integration.test.ts 2>&1 | tail -5

echo "--- Phase 9 specific: MongoBackendAdapter query path (mocked client)"
pnpm --filter @contractqa/adapters exec vitest run tests/mongo-query.test.ts 2>&1 | tail -5

echo "--- Part C: out-of-tree adapter builds against @contractqa/adapters/public"
bash scripts/test-third-party-adapter.sh >/dev/null
echo "  out-of-tree adapter built successfully"

if [[ "$MODE" == "real-cloud" ]]; then
  echo "--- Real-cloud lane (Supabase docker stack — Phase 3 holdover)"
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
echo "OK — Phase 9 acceptance passed."
