#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
DOGFOOD_DIR="$(cd "$THIS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DOGFOOD_DIR/../.." && pwd)"
STACK_DIR="$REPO_ROOT/fixtures/supabase-stack"

echo "==> Bringing up Supabase stack at $STACK_DIR"
bash "$STACK_DIR/scripts/up.sh"

cleanup() {
  echo "==> Tearing down Supabase stack"
  bash "$STACK_DIR/scripts/down.sh" || true
}
trap cleanup EXIT

echo "==> Seeding fixture users"
bash "$STACK_DIR/scripts/seed.sh"

echo "==> Exporting client env from supabase status -o env"
cd "$STACK_DIR"
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_PROJECT_REF="localhost"

echo "==> Running dogfood contracts (real-cloud)"
cd "$DOGFOOD_DIR"
pnpm test
