# contractqa

<!-- TODO(v1.0): confirm github.com/zmy/contractqa URL matches actual git remote before publishing -->

> Product-invariant QA platform — verifies behavioural contracts (not just screenshots), captures evidence on failure, and hands minimal repros to Claude Code for auto-fix.

Install:

```bash
npm install contractqa @contractqa/adapters
# Browser-flow users also need Playwright:
npm install @playwright/test
npx playwright install chromium
```

See the repo [README](https://github.com/zmy/contractqa) for the full architecture and the [STABILITY.md](https://github.com/zmy/contractqa/blob/main/STABILITY.md) policy for the semver-protected surface.

## CLI commands

- `contractqa init` — scaffold contracts directory and Playwright config.
- `contractqa doctor` — diagnose target-repo preconditions (native deps, env vars, ports).
- `contractqa scan` — read-only survey of the target repo (frameworks, auth providers).
- `contractqa invariants-gen` — auto-generate `INVARIANTS.md` from contract YAML.
- `contractqa run` — run contracts via Playwright. **Requires `@playwright/test`** — fails fast with an install hint if missing.
- `contractqa autopilot` — zero-YAML onboarding: generate, run, and auto-fix contracts for a project. See [AUTOPILOT.md](../../docs/AUTOPILOT.md). (v1.1+)

For programmatic use, the HTTP-only path:

```ts
import { runHttpContract } from '@contractqa/runner/http';  // @experimental — Playwright-free
```

The Playwright-based runner lives at the root export of `@contractqa/runner` and requires `@playwright/test` to be installed.

## License

See repo LICENSE.
