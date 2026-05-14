import { pgTable, uuid, text, timestamp, jsonb, numeric } from 'drizzle-orm/pg-core';

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  triggerType: text('trigger_type').notNull(),
  commitSha: text('commit_sha'),
  branch: text('branch'),
  status: text('status'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  totals: jsonb('totals'),
});

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id'),
  title: text('title'),
  severity: text('severity'),
  confidence: numeric('confidence'),
  status: text('status'),
  issueJsonPath: text('issue_json_path'),
});
