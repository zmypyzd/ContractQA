# Vendored Supabase stack for ContractQA real-cloud tests

A minimal, pinned-tag Supabase stack: Postgres + GoTrue (auth) + PostgREST + Kong.
Used by Phase 3 real-cloud dogfooding (5-4-claude target). Not for production.

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
