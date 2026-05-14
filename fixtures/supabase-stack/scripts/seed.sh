#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY must be set (check .env)}"
: "${AUTH_URL:=http://localhost:54321}"

create_user() {
  local email="$1"
  local password="$2"
  local role="$3"
  echo "Seeding $email (role=$role)..."
  # GoTrue admin endpoint: POST /auth/v1/admin/users
  # 200 OK on create, 422 if email already exists — both acceptable here.
  local response_code
  response_code=$(curl -s -o /tmp/seed-resp.json -w "%{http_code}" \
    -X POST "$AUTH_URL/auth/v1/admin/users" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true,\"user_metadata\":{\"role\":\"$role\"}}" \
    || echo "000")
  case "$response_code" in
    200|201) echo "  created" ;;
    422) echo "  already exists, skipping" ;;
    *)   echo "  ERROR: HTTP $response_code"; cat /tmp/seed-resp.json; exit 1 ;;
  esac
}

create_user admin@example.test 'AdminPass123!' admin
create_user user@example.test  'UserPass123!'  user

echo "Seeded fixture users:"
echo "  admin@example.test / AdminPass123!"
echo "  user@example.test  / UserPass123!"
