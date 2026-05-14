import { test } from '@playwright/test';
import { loadContractsFromDir } from './loader.js';
import { compileContract, type CompiledPage } from './compile.js';

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
