#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Stopping Supabase stack and pruning volumes..."
docker compose down -v
echo "Done. Volumes removed."
