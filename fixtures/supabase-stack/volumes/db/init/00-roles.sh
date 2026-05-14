#!/bin/bash
# Supabase auth admin role + role boundaries.
# Runs on first DB init (before GoTrue connects) via docker-entrypoint-initdb.d.
# Must be a shell script (not raw .sql) so $POSTGRES_PASSWORD interpolates —
# .sql files in initdb.d are loaded with `psql -f` without -v variables.

set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL
  CREATE ROLE supabase_auth_admin NOINHERIT LOGIN PASSWORD '$POSTGRES_PASSWORD';
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '$POSTGRES_PASSWORD';

  GRANT anon, authenticated, service_role TO authenticator;
  GRANT ALL ON SCHEMA public TO supabase_auth_admin;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO supabase_auth_admin;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO supabase_auth_admin;
EOSQL
