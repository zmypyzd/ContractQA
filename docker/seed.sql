CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  repo_url TEXT,
  default_branch TEXT DEFAULT 'main',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  trigger_type TEXT NOT NULL,
  commit_sha TEXT,
  branch TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  totals JSONB
);
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES runs(id),
  title TEXT,
  severity TEXT,
  confidence NUMERIC,
  status TEXT,
  issue_json_path TEXT
);
CREATE TABLE IF NOT EXISTS fix_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES issues(id),
  agent TEXT,
  branch TEXT,
  status TEXT,
  patch_summary TEXT,
  tests_run TEXT[],
  cost_usd NUMERIC
);
