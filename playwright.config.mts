import { defineConfig } from '@playwright/test';

const baseURL = process.env.CONTRACTQA_BASE_URL || 'http://localhost:4000';

// Contracts are registered programmatically inside qa-runner.test.mts at
// file-load time — that file is the single Playwright "test file" we
// discover. testMatch is a positive single-file pattern (not a negative
// blacklist) so the default *.test.ts walk doesn't grab the monorepo's
// vitest tests (incl. parallel worktrees under .claude/worktrees/), which
// would crash on `import 'vitest'` outside the vitest runner.
export default defineConfig({
  testDir: '.',
  testMatch: 'qa-runner.test.mts',
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL, trace: 'off' },
  timeout: 30_000,
});
