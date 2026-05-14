# Dogfood findings — website_vercel-supabase-main

Second dogfood. Target is **Next.js 16 + NextAuth v5 (Auth.js) + Supabase** —
literally what Phase 1 was designed for. The headline finding: **even on
Phase 1's intended happy-path stack, the schema/runner has real gaps that
a competent contract author hits in the first 10 minutes.**

Outcome: PASS verdict on INV-N1 (Navbar Login link routes anon user to
/login). Required two schema/runner changes mid-dogfood to even get there.

## Findings

### 1. No host-app env preflight (HIGH-SEVERITY)

The target requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXTAUTH_SECRET`, `AUTH_GOOGLE_ID`/`SECRET`, etc., just to load the JS
modules. Without them, `createClient(undefined, undefined)` throws at
module load and `next dev` crashes — but ContractQA's runner has no
preflight check and no error surface saying "host app didn't start, here's
what env you're missing."

Today we manually fed stub values (`http://localhost:1` Supabase URL, a
32+ char `NEXTAUTH_SECRET`, etc.) for module init to succeed.
Real auth/DB calls obviously can't work with stubs — but the home page
and `/login` page render fine, which is enough for a navigation invariant.

Phase 2 task: `contractqa doctor <target>` that:
- Tries to boot the host's dev server
- Parses .env.example / DEPLOYMENT_CHECKLIST.md / README for required vars
- Surfaces missing vars before the runner even starts the contract loop

### 2. `about:blank` + snapshotBrowser → SecurityError on localStorage

Initial test attempt: `await page.goto('about:blank')` to capture a clean
BEFORE state. snapshotBrowser then crashes:

```
SecurityError: Failed to read the 'localStorage' property from 'Window':
Access is denied for this document.
```

`about:blank` has no origin, so `window.localStorage` throws. snapshotBrowser
should detect origin-less pages and emit empty maps rather than propagate
the SecurityError. Workaround: pre-navigate to a real origin first.

Phase 2 task: harden `packages/probes/src/browser-snapshot.ts` to catch this
specific error and return `{ localStorage: {}, sessionStorage: {}, ... }`
with a `snapshot.origin = null` flag.

### 3. Multi-match locator ambiguity (FIXED IN THIS PR)

Target's home page has TWO `<a href="/login">登录</a>` elements — one in
the navbar, one in the `#messages` section. Playwright's strict-mode
`getByRole('link', { name: '登录' })` rejects ambiguous matches. compileContract
had no way to scope or pick a specific one — strict-mode is hard-coded.

Fix: added `target.first: boolean` to the contract YAML schema (in
`packages/core/src/schemas/contract.schema.ts`) and the runner's
compileContract (`packages/runner/src/compile.ts`). When `first: true`,
the locator collapses to `.first()`.

Still pending: a more semantic option like `target.within: <ancestor-role>`
(e.g. `within: navigation`) for cases where "the navbar link, not the
footer link" is what the author means. `first: true` is the smallest
necessary unblock.

### 4. Phase 1 ships separate adapters for stacks that real apps combine

The target uses BOTH:
- `next-auth` (Auth.js v5) for session management (cookie: `authjs.session-token`)
- `@supabase/supabase-js` for user lookups against a `users` table

Phase 1 has `SupabaseAuthAdapter` AND `NextAuthAdapter` as **alternative**
choices in `packages/adapters`. But real apps stack them: NextAuth handles
the session, Supabase is the DB behind the credentials provider. Which
adapter is "the" adapter? Neither cleanly. The current `AppAdapter` type
forces a single `auth: AuthAdapter` field.

Phase 2 task: AuthAdapter composition — let one project declare
`auth: [NextAuthAdapter(), SupabaseDbAdapter()]` with explicit
responsibilities (session vs user-store vs OAuth callbacks).

### 5. Port-collision footgun across multiple dogfood targets

Both 5-4-codex and website-vercel-supabase defaulted to port 3287. vitest
runs files sequentially but each `beforeAll` spawns servers that bind ports
during their test's window. When two suites pick the same port, the second
fails on `EADDRINUSE`. Trivial fix in this PR (3287 → 3299), but there's
no port-allocation discipline in the schema.

Phase 2 task: the runner should allocate ports from a free pool, not
defaults baked into each suite.

### 6. Stub env tax is high — Auth secret length validation, AUTH_SECRET vs NEXTAUTH_SECRET

NextAuth v5 (Auth.js) validates `AUTH_SECRET` (not the older `NEXTAUTH_SECRET`)
and requires ≥32 characters of entropy. Phase 1's docs / CLI `init` don't
help the contract author figure out the minimum env to make next dev not
crash. We discovered this empirically by reading next-dev's logs.

Phase 2 task: `contractqa init` should detect NextAuth and write an
`.env.dogfood` template with stub values that satisfy the runtime checks.

## What worked unchanged on this stack

- `compileContract` drove a real Next.js 16 + Turbopack page through the
  `getByRole('link', ...)` + click + waitForTimeout pipeline once strict-mode
  was unblocked
- `snapshotBrowser` worked once on a real origin (the SecurityError on
  about:blank is an edge case, not a stack issue)
- `runOracle` on `localStorage.no_key_matches: ^(authjs|next-auth|sb-)`
  cleanly classified the empty localStorage as PASS
- `writeEvidenceBundle` produced a complete manifest with all 6 expected
  files (trace.zip, screenshot, HAR, before/after snapshots, state-diff)
- The framework is genuinely framework-agnostic at the core — what Phase 1
  is missing is mostly adapters, preflight checks, and ergonomic glue
