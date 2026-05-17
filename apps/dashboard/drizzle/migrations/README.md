# Dashboard schema migrations

Hand-written, idempotent SQL files. To bootstrap a fresh Postgres:

```bash
export DATABASE_URL=postgres://contractqa:contractqa@localhost:5432/contractqa
psql "$DATABASE_URL" -f drizzle/migrations/0001_init.sql
```

The schema source of truth is `drizzle/schema.ts`. When you add a column or
table, append a new `000N_*.sql` and update `schema.ts` so type checking stays
in sync. Migrations are not auto-applied at startup — that is intentional, so
that bringing the dashboard up against an unfamiliar database can't accidentally
mutate it.
