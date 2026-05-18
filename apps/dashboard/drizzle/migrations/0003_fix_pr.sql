-- 0003_fix_pr.sql
-- Adds night-shift auto-PR metadata to the issues table.
-- See docs/superpowers/specs/2026-05-18-night-shift-auto-pr-design.md §6
ALTER TABLE issues
  ADD COLUMN fix_pr_url    text,
  ADD COLUMN fix_outcome   text,
  ADD COLUMN fix_branch    text;
