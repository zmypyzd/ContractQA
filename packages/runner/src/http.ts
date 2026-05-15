/**
 * `@contractqa/runner/http` — Playwright-free entry point for HTTP-only contracts.
 *
 * HTTP consumers should import from this subpath rather than the runner root:
 *
 *   import { runHttpContract } from '@contractqa/runner/http';
 *
 * The root barrel (`@contractqa/runner`) statically re-exports `playwright-entry.ts`,
 * which value-imports the playwright test library. Loading the root barrel without
 * playwright installed will throw at module init.
 *
 * This subpath only re-exports `runHttpContract` and its types from `./run-contract.js`.
 * `run-contract.ts` has zero playwright imports (verified at v1.0.0).
 */
export { runHttpContract } from './run-contract.js';
export type {
  RunHttpContractInput,
  RunHttpContractResult,
} from './run-contract.js';
