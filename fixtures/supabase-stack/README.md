# Vendored Supabase stack for ContractQA real-cloud tests

A minimal, pinned-tag Supabase stack: Postgres + GoTrue (auth) + PostgREST + Kong.
Used by Phase 3 real-cloud dogfooding (5-4-claude target). Not for production.

## STATUS — known broken in v0.3.0

Validated 2026-05-14 via `./scripts/phase3-acceptance.sh --real-cloud` and found
to be incomplete: GoTrue cannot run its migrations because the `supabase/postgres`
image initializes a `supabase_admin` superuser (not `postgres`), and GoTrue's own
migrations grant on a `postgres` role that doesn't exist. Earlier in the same
boot, the `auth` schema also has to be created by us (this stack does it via
`volumes/db/init/00-roles.sh`; the full Supabase self-host compose creates it
via a separate analytics initdb container we don't include).

The current compose is therefore a starting point, not a working stack. Two
paths forward, both Phase 4 candidates:

1. **Rebuild on Supabase's official self-host compose** (`supabase/docker/docker-compose.yml`)
   — pull in their full initdb scripts that create `postgres` role, `auth`,
   `storage`, `realtime`, `pgbouncer` and `analytics` schemas. Vendor at a
   pinned commit.

2. **Switch to `supabase start` (CLI-based)** — let the Supabase CLI manage
   the local stack. Loses the "vendored, no external dependency" property
   but gains an officially-supported path.

Until Phase 4 picks one, the `--real-cloud` lane in `scripts/phase3-acceptance.sh`
will fail at the `wait-for-health` step with `auth (via Kong) never became
reachable`. The default (stub-env) acceptance path is unaffected.

## Pinned versions

- supabase/postgres:15.6.1.146
- supabase/gotrue:v2.171.0
- postgrest/postgrest:v12.2.0
- kong:2.8.1

## Ports

- 54321 — Kong gateway (this is what clients should hit; equivalent to `https://<project>.supabase.co`)
- 54322 — Postgres (direct, for psql / migrations)

## Quick start (after B2 ships the scripts)

```
cp .env.example .env
bash scripts/up.sh
bash scripts/seed.sh
# ... run your tests ...
bash scripts/down.sh
```

## Secrets

The `.env.example` ships safe development-only secrets. They only protect a local docker
stack. Real Supabase tokens are NOT used here.

If you copy `.env.example` to `.env` and modify, the `.env` file is gitignored.

## Upgrading

To bump an image, change the tag in `docker-compose.yml`, rerun `up.sh`, and verify
`scripts/wait-for-health.sh` still passes within 30 seconds. Run the 5-4-claude
real-cloud dogfood (`bash dogfood/5-4-claude/scripts/test-real-cloud.sh`) to confirm
no breaking schema changes.
