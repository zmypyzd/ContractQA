# CI workflows

## real-cloud.yml

Opt-in. Pulls the Supabase docker stack, seeds fixture users, runs the
5-4-claude contract suite end-to-end. Triggered by:
- Manual: `gh workflow run real-cloud.yml`
- PRs that touch `fixtures/supabase-stack/`, `packages/adapters/src/auth/supabase.ts`, or `dogfood/5-4-claude/`

Skipped by default for every other PR. Wall-clock budget is 30 min.
