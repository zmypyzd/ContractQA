import { pgTable, uuid, text, timestamp, jsonb, numeric, integer } from 'drizzle-orm/pg-core';

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  triggerType: text('trigger_type').notNull(),
  commitSha: text('commit_sha'),
  branch: text('branch'),
  status: text('status'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  totals: jsonb('totals'),
  /** Absolute project folder path for launcher-triggered runs (null otherwise). */
  cwd: text('cwd'),
  /** UUID grouping every iteration that came from the same `?watch=true`
   *  SSE connection. Null for one-shot runs. */
  watchSessionId: uuid('watch_session_id'),
});

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id'),
  title: text('title'),
  severity: text('severity'),
  confidence: numeric('confidence'),
  status: text('status'),
  issueJsonPath: text('issue_json_path'),
  fixPrUrl: text('fix_pr_url'),
  fixOutcome: text('fix_outcome'),
  fixBranch: text('fix_branch'),
});

export const recentProjects = pgTable('recent_projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Resolved absolute path the user pointed the launcher at. Unique. */
  absolutePath: text('absolute_path').notNull().unique(),
  /** Human-friendly label — folder basename by default, overridable later. */
  label: text('label').notNull(),
  /** Last time the launcher started a run against this path. */
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  /** Monotonically incrementing — used to break ties when sorting by lastUsedAt. */
  runCount: integer('run_count').notNull().default(0),
  /** Last `detected` summary from validateProjectPath (pm, packageCount, hasNext, ...). */
  detectedSummary: jsonb('detected_summary'),
});
