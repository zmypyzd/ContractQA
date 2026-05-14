#!/usr/bin/env bash
# Seed fixture users into the running Supabase stack via GoTrue's admin API.
# Idempotent: HTTP 422 (already exists) is treated as success.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not found." >&2
  exit 1
fi

# Read live keys from the running stack. Depends on `supabase start` having
# already been called.
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"

: "${API_URL:?supabase status didn't expose API_URL — is the stack running?}"
: "${SERVICE_ROLE_KEY:?supabase status didn't expose SERVICE_ROLE_KEY — is the stack running?}"

create_user() {
  local email="$1"
  local password="$2"
  local role="$3"
  echo "Seeding ${email} (role=${role})..."

  local response_code
  response_code=$(curl -s -o /tmp/contractqa-seed-resp.json -w "%{http_code}" \
    -X POST "${API_URL}/auth/v1/admin/users" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"email_confirm\":true,\"user_metadata\":{\"role\":\"${role}\"}}" \
    || echo "000")

  case "$response_code" in
    200|201) echo "  created" ;;
    422)     echo "  already exists, skipping" ;;
    *)
      echo "  ERROR: HTTP $response_code"
      cat /tmp/contractqa-seed-resp.json
      echo
      exit 1
      ;;
  esac
}

create_user admin@example.test 'AdminPass123!' admin
create_user user@example.test  'UserPass123!'  user

echo
echo "Seeded:"
echo "  admin@example.test / AdminPass123!"
echo "  user@example.test  / UserPass123!"
