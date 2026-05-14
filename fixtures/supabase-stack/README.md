# Local Supabase stack for ContractQA real-cloud tests

Backed by the official [Supabase CLI](https://supabase.com/docs/guides/cli).
Used by the `--real-cloud` lane of Phase 3 acceptance and by 5-4-claude
dogfooding when exercising real auth flows. Not for production.

## Why the CLI

Phase 3 originally vendored a minimal docker-compose stack here. It worked far
enough to surface that the `supabase/postgres` image's role/schema initialization
isn't compatible with a hand-rolled compose — you need either the full
self-host docker-compose (15+ services, several init containers) or the CLI.
Switching to the CLI removed the cascading init bugs and gave us a path that
upstream maintains.

Trade-off: requires the `supabase` CLI on the developer's machine. The
default acceptance lane (stub-env) doesn't need it.

## Prerequisites

- Docker Desktop running
- Supabase CLI installed:
  - macOS: `brew install supabase/tap/supabase`
  - npm: `npm install -g supabase`
  - Other: <https://supabase.com/docs/guides/cli>

## Quick start

```
bash scripts/up.sh      # supabase start (idempotent)
bash scripts/seed.sh    # creates admin@example.test + user@example.test
# ... run your tests, e.g. SUPABASE_URL=... pnpm test ...
bash scripts/down.sh    # supabase stop --no-backup
```

The CLI manages everything under `supabase/` (config.toml is committed;
`.branches/`, `.temp/`, local env files are gitignored). Live keys are read
from `supabase status -o env` at runtime — no `.env` to maintain.

## Ports (CLI defaults, match Phase 3's earlier vendored compose)

- 54321 — Kong gateway (API: `/auth/v1/`, `/rest/v1/`, etc.)
- 54322 — Postgres (direct, for psql / migrations)
- 54323 — Studio (web UI)
- 54324 — Mailpit (captured auth emails)

## How tests pick up the keys

`dogfood/5-4-claude/scripts/test-real-cloud.sh` does:

```bash
eval "$(supabase status -o env)"
export SUPABASE_URL=$API_URL
export SUPABASE_ANON_KEY=$ANON_KEY
export SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
```

Then runs the dogfood tests. `SupabaseAuthAdapter` v2 picks up the env and
exercises the GoTrue admin API for `loginAs`.

## Upgrading

Bump the CLI version (`brew upgrade supabase`) and run `bash scripts/up.sh`
to pull updated images. The CLI manages pinned tags internally; we don't
pin them ourselves. To verify nothing regressed, run the 5-4-claude
real-cloud dogfood (`bash dogfood/5-4-claude/scripts/test-real-cloud.sh`).

## What's committed vs gitignored

- `supabase/config.toml` — committed (project config)
- `supabase/.gitignore` — committed (CLI-managed; excludes runtime state)
- `supabase/.branches/`, `supabase/.temp/`, `supabase/.env*` — gitignored
- `scripts/*.sh` — committed (wrappers around the CLI)
