-- ContractQA dashboard · add watch_session_id to runs (idempotent)
--
--   psql "$DATABASE_URL" -f drizzle/migrations/0002_watch_session.sql
--
-- Tags every run that came from the same /launcher/stream?watch=true
-- connection with a shared UUID. /runs collapses consecutive same-session
-- iterations into one expandable row.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS watch_session_id uuid;

CREATE INDEX IF NOT EXISTS idx_runs_watch_session
  ON runs (watch_session_id, started_at DESC)
  WHERE watch_session_id IS NOT NULL;
