#!/usr/bin/env bash
# Bring up the local Supabase stack via the official CLI.
# Idempotent: if already running, prints status and returns 0.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not found. Install with:" >&2
  echo "  brew install supabase/tap/supabase     # macOS" >&2
  echo "  npm install -g supabase                # cross-platform" >&2
  echo "  https://supabase.com/docs/guides/cli   # other" >&2
  exit 1
fi

# `supabase start` is itself idempotent. It detects an already-running stack
# and short-circuits, printing the same status banner.
supabase start

echo
echo "Stack is up. Project root: $(pwd)"
echo "Keys via: supabase status -o env"
