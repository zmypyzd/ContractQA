#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Waiting for db..."
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    echo "  db ready (after ${i}s)"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "ERROR: db never became ready" >&2
    exit 1
  fi
done

echo "Waiting for auth (GoTrue)..."
for i in $(seq 1 30); do
  # GoTrue is reachable via Kong at /auth/v1/health, with a fallback to GoTrue's internal /health
  if curl -sf http://localhost:54321/auth/v1/health >/dev/null 2>&1 \
     || curl -sf http://localhost:54321/auth/v1/settings >/dev/null 2>&1; then
    echo "  auth ready (after ${i}s)"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "ERROR: auth (via Kong) never became reachable" >&2
    exit 1
  fi
done

echo "All services healthy."
