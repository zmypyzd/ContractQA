import { test } from '@playwright/test';
import { loadContractsFromDir } from './loader.js';
import { compileContract, type CompiledPage } from './compile.js';

/**
 * Reads every YAML contract under `dir` (recursively) and registers one
 * Playwright `test()` per contract.
 *
 * IMPORTANT: Playwright associates each `test()` call with the file in
 * which it was *called*, not the file that exported the function doing
 * the calling. Calling `registerContracts()` from a non-test file (e.g.
 * a `playwright.config.ts`, or any module that isn't matched by
 * `testMatch`) results in `test()` calls being attached to THIS module's
 * file path — which Playwright treats as "not a test file" and silently
 * discards.
 *
 * If you need to register contracts as Playwright tests, call this
 * function *from* a file that IS a Playwright test file (matched by
 * `testMatch`), OR inline the loop yourself. The canonical example in
 * this repo is qa-runner.test.mts at the workspace root.
 *
 * See docs/contractqa-run-end-to-end-gap.md "Layer 4" for the diagnosis.
 */
export async function registerContracts(dir: string): Promise<void> {
  const contracts = await loadContractsFromDir(dir);
  for (const c of contracts) {
    const thunk = compileContract(c);
    test(`${c.id}: ${c.title}`, async ({ page, context }) => {
      const snapshot = async () => ({
        url: page.url(),
        localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
        cookies: (await context.cookies()).map((x) => x.name),
      });
      await thunk({ page: page as unknown as CompiledPage, snapshot });
    });
  }
}
