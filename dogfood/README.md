# dogfood — ContractQA against real repos

Each subdir here drives ContractQA Phase 1 against a real codebase on disk.
The point is to surface assumptions Phase 1 baked in but real repos break —
the output is **FINDINGS.md per target**, which then seeds Phase 2.

## Running

```bash
pnpm --filter @contractqa/dogfood test
```

Targets are sidecar-style: this workspace boots the target's dev server as
a subprocess on isolated ports, drives real Chromium against it, runs
`compileContract` + `snapshotBrowser` + `runOracle`, writes evidence bundles
to a temp dir, and asserts the verdict.

## Current targets

- **5-4-codex** — `/Users/zmy/intership/5/5-4-codex` (agent-poker-platform,
  Vite + React + react-router-dom + cookie-session auth). See
  `5-4-codex/FINDINGS.md` for the running list of Phase 2 inputs.

## Adding a new target

1. Create `dogfood/<target-name>/`
2. Hand-write `contracts/*.yml` and `noise-profile.yml` (no Next.js scan yet)
3. Copy `5-4-codex/dogfood.test.ts` as a template; adjust the boot args and
   the precondition flow (registration/login/etc.)
4. Note: targets must have their native deps rebuilt for the local Node
   version — `npm --prefix <path-to-target>/node_modules/<dep> rebuild` if
   you hit a bindings error
