#!/usr/bin/env bash
# Tear down the local Supabase stack.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not found." >&2
  exit 1
fi

# --no-backup skips the dump-before-stop. We don't need it for test fixtures.
supabase stop --no-backup
echo "Stack stopped."
