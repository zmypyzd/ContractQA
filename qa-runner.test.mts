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

import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadContractsFromDir,
  compileContract,
  runOracle,
  type CompiledPage,
  type AuthSetup,
} from './packages/runner/dist/index.js';
import { snapshotBrowser } from './packages/probes/dist/index.js';

const contractsDir = process.env.CONTRACTQA_CONTRACTS_DIR || 'qa/contracts';
// lenient: tolerate autopilot-generated contracts whose `expected.*` shapes
// the ContractSchema doesn't model yet. Schema-invalid files are warned and
// skipped instead of crashing the whole run. See docs/contractqa-run-end-to-end-gap.md
// "Layer 7" for context.
const contracts = await loadContractsFromDir(contractsDir, { lenient: true });

// Optional per-project auth bootstrap. Look for auth.config.mjs at the
// parent of contractsDir (e.g. qa/auth.config.mjs when contracts live in
// qa/contracts/). Override path with CONTRACTQA_AUTH_CONFIG. The module
// must export `setupLoggedIn: (ctx) => Promise<void>` — called before
// the first action of every contract with preconditions.auth_state ===
// 'logged_in'. Without it, those contracts run anonymous and time out
// looking for elements behind login.
let authSetup: AuthSetup | undefined;
{
  const explicit = process.env.CONTRACTQA_AUTH_CONFIG;
  const fallback = resolve(dirname(resolve(contractsDir)), 'auth.config.mjs');
  const path = explicit || fallback;
  if (existsSync(path)) {
    try {
      const mod = await import(pathToFileURL(path).href);
      const fn = mod.setupLoggedIn ?? mod.default?.setupLoggedIn;
      if (typeof fn === 'function') {
        authSetup = fn as AuthSetup;
        console.log(`[contractqa] auth: loaded setupLoggedIn from ${path}`);
      } else {
        console.warn(`[contractqa] auth: ${path} has no setupLoggedIn export`);
      }
    } catch (err) {
      console.warn(`[contractqa] auth: failed to load ${path}: ${(err as Error).message}`);
    }
  }
}

// Minimal NoiseProfile — empty ignore lists. Real projects can synthesize
// one via packages/probes/synthesizeNoiseProfile, but eval runs start from
// "no noise tolerated" so every state-diff finding is visible.
const emptyNoise = {
  project: 'eval',
  generated_at: new Date().toISOString(),
  ignore: {
    localStorage_keys: [] as string[],
    sessionStorage_keys: [] as string[],
    cookies: [] as string[],
    network_url_patterns: [] as string[],
    console_patterns: [] as string[],
  },
};

for (const c of contracts) {
  // compileContract is called WITHOUT authSetup — auth runs at the test
  // outer scope below, BEFORE the before-snapshot, so auth-side cookies
  // / localStorage don't pollute the contract's state-diff.
  const thunk = compileContract(c);

  test(`${c.id}: ${c.title}`, async ({ page, context }) => {
    if (c.preconditions?.auth_state === 'logged_in' && authSetup) {
      await authSetup({ page: page as unknown as CompiledPage, context, contract: c });
    }

    // Capture DOM only when the contract actually asserts on dom.* — it
    // costs ~50ms per snapshot otherwise. See snapshotBrowser's
    // SnapshotOptions.captureDom doc.
    const captureDom = !!c.expected?.dom;
    const tmp = mkdtempSync(join(tmpdir(), `cqa-${c.id}-`));

    const beforeSnap = await snapshotBrowser(page as unknown as Parameters<typeof snapshotBrowser>[0], {
      screenshotPath: join(tmp, 'before.png'),
      captureDom,
    });

    // The thunk's internal snapshot is unused once we capture full ones
    // around the call. Give it a no-op shim.
    const dummySnap = async () => ({ url: page.url(), localStorageKeys: [], cookies: [] });
    await thunk({ page: page as unknown as CompiledPage, snapshot: dummySnap, context });

    const afterSnap = await snapshotBrowser(page as unknown as Parameters<typeof snapshotBrowser>[0], {
      screenshotPath: join(tmp, 'after.png'),
      captureDom,
    });

    // expected.url.matches regexes are written against pathnames, not full URLs
    // (matches runContract's stripBaseUrl behavior). Strip CONTRACTQA_BASE_URL.
    const baseUrl = process.env.CONTRACTQA_BASE_URL || '';
    const stripBase = (u: string): string => {
      if (baseUrl && u.startsWith(baseUrl)) return u.slice(baseUrl.length) || '/';
      return u;
    };
    const beforeState = {
      url: stripBase(beforeSnap.url),
      localStorageKeys: Object.keys(beforeSnap.localStorage),
      cookies: beforeSnap.cookies.map((x) => x.name),
      dom: beforeSnap.dom,
    };
    const afterState = {
      url: stripBase(afterSnap.url),
      localStorageKeys: Object.keys(afterSnap.localStorage),
      cookies: afterSnap.cookies.map((x) => x.name),
      dom: afterSnap.dom,
    };

    const verdict = await runOracle({
      contract: c,
      before: beforeState,
      after: afterState,
      noise: emptyNoise,
      missingCapabilities: [],
      attach: () => {},
      tmpDir: tmp,
    });

    const why = verdict.violations.length
      ? verdict.violations.map((v) => `${v.invariantId}: ${v.message} (got ${JSON.stringify(v.actual)})`).join('; ')
      : verdict.verdict;
    expect.soft(verdict.verdict, why).toBe('PASS');
  });
}
