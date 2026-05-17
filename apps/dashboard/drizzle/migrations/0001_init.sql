-- ContractQA dashboard · bootstrap schema (idempotent)
--
-- Run once against your Postgres:
--   psql "$DATABASE_URL" -f drizzle/migrations/0001_init.sql
--
-- All statements are idempotent (IF NOT EXISTS) so re-running is safe. The
-- dashboard code uses UUIDs that Postgres generates via gen_random_uuid();
-- that requires the pgcrypto extension on older clusters.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Runs · one row per autopilot or CLI invocation.
CREATE TABLE IF NOT EXISTS runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type  text NOT NULL,
  commit_sha    text,
  branch        text,
  status        text,
  started_at    timestamp with time zone,
  ended_at      timestamp with time zone,
  totals        jsonb,
  cwd           text
);

-- Older deployments may lack `cwd`; add it if missing.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cwd text;

CREATE INDEX IF NOT EXISTS idx_runs_started_at_desc ON runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);

-- Issues · one row per contract failure discovered during a run.
CREATE TABLE IF NOT EXISTS issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid,
  title             text,
  severity          text,
  confidence        numeric,
  status            text,
  issue_json_path   text
);

CREATE INDEX IF NOT EXISTS idx_issues_run_id ON issues (run_id);

-- Recent projects · launcher sidebar persistence across sessions.
CREATE TABLE IF NOT EXISTS recent_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absolute_path     text NOT NULL UNIQUE,
  label             text NOT NULL,
  last_used_at      timestamp with time zone NOT NULL DEFAULT now(),
  run_count         integer NOT NULL DEFAULT 0,
  detected_summary  jsonb
);

CREATE INDEX IF NOT EXISTS idx_recent_projects_last_used_desc
  ON recent_projects (last_used_at DESC);
