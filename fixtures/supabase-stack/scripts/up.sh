#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo ".env not found; copying from .env.example (development-only credentials)."
    cp .env.example .env
  else
    echo "ERROR: neither .env nor .env.example present" >&2
    exit 1
  fi
fi

echo "Starting Supabase stack..."
docker compose up -d

bash scripts/wait-for-health.sh

echo "OK. Supabase is up:"
echo "  - Auth/REST gateway: http://localhost:54321"
echo "  - Postgres:          postgres://postgres@localhost:54322/postgres"
