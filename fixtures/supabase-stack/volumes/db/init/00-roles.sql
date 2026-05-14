-- Supabase auth admin role + role boundaries.
-- Created on first DB init before GoTrue connects.

CREATE ROLE supabase_auth_admin NOINHERIT LOGIN;
ALTER ROLE supabase_auth_admin WITH PASSWORD :'POSTGRES_PASSWORD';
GRANT ALL ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD :'POSTGRES_PASSWORD';

GRANT anon, authenticated, service_role TO authenticator;
