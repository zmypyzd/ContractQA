#!/bin/bash
# Supabase auth admin role + role boundaries.
# Runs on first DB init (before GoTrue connects) via docker-entrypoint-initdb.d.
# Must be a shell script (not raw .sql) so $POSTGRES_PASSWORD interpolates —
# .sql files in initdb.d are loaded with `psql -f` without -v variables.

set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL
  -- Roles (GoTrue uses supabase_auth_admin; PostgREST uses authenticator)
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

  -- Schemas that GoTrue / Storage / Realtime expect to exist before they
  -- run their own migrations. supabase/postgres image ships the extensions
  -- but does NOT auto-create these schemas — that's the full self-host
  -- docker-compose's job. Our minimal stack creates them here.
  CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
  GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
EOSQL
