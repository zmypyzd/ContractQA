# @contractqa/oracle

> **⚠️ Internal package.** Please install [`contractqa`](https://www.npmjs.com/package/contractqa) (the CLI) or [`@contractqa/adapters`](https://www.npmjs.com/package/@contractqa/adapters) instead.
>
> Anything in this package's root entry is implementation detail and may change in any minor release without notice. See the repo-level [`STABILITY.md`](https://github.com/zmy/contractqa/blob/main/STABILITY.md) for the semver-protected public surface.

State-diff oracle that produces the 4-state verdict (`PASS`/`FAIL`/`FLAKY`/`INCONCLUSIVE`) from before/after browser snapshots.

This package is a workspace dependency of the `contractqa` CLI and is published only because npm requires resolvable runtime dependencies. Direct consumers should not import from it.
