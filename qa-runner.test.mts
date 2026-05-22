// qa-runner.test.mts
//
// The single on-disk Playwright "test file" for this repo. Playwright
// loads it via testMatch in playwright.config.mts. At file-load time we
// read every YAML contract under $CONTRACTQA_CONTRACTS_DIR (or
// `qa/contracts` by default) and register one Playwright test() per
// contract.
//
// Why the test() loop must be inlined HERE, not in
// packages/runner/src/playwright-entry.ts (where the exported
// registerContracts() helper lives): Playwright associates each test()
// call with the file in which it was *called*, not the file that exported
// the function doing the calling. test() calls from inside
// registerContracts() get attached to playwright-entry.js (not a
// discovered test file), so they're silently dropped. This file's
// lexical scope is the only context where test() calls actually register.
// See docs/contractqa-run-end-to-end-gap.md "Layer 4".
//
// Invocation is through `contractqa run` (see
// packages/cli/src/commands/run.ts).

import { test } from '@playwright/test';
import {
  loadContractsFromDir,
  compileContract,
  type CompiledPage,
} from './packages/runner/dist/index.js';

const contractsDir = process.env.CONTRACTQA_CONTRACTS_DIR || 'qa/contracts';
// lenient: tolerate autopilot-generated contracts whose `expected.*` shapes
// the ContractSchema doesn't model yet. Schema-invalid files are warned and
// skipped instead of crashing the whole run. See docs/contractqa-run-end-to-end-gap.md
// "Layer 7" for context.
const contracts = await loadContractsFromDir(contractsDir, { lenient: true });

for (const c of contracts) {
  const thunk = compileContract(c);
  test(`${c.id}: ${c.title}`, async ({ page, context }) => {
    const snapshot = async () => ({
      url: page.url(),
      // localStorage is unavailable on about:blank (the initial page
      // before any goto lands) — accessing it throws SecurityError.
      // Return [] in that case rather than crashing the contract.
      localStorageKeys: await page.evaluate(() => {
        try {
          return Object.keys(localStorage);
        } catch {
          return [];
        }
      }),
      cookies: (await context.cookies()).map((x) => x.name),
    });
    await thunk({ page: page as unknown as CompiledPage, snapshot });
  });
}
