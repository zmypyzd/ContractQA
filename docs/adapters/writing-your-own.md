# Writing your own ContractQA adapter

Most projects can use `SupabaseAuthAdapter`, `NextAuthAdapter`, or `CustomCookieAuthAdapter` from `@contractqa/adapters/public` directly. If your auth doesn't fit any of these — bespoke header tokens, signed-magic-link flows, a self-rolled JWT scheme — you write a small adapter.

## Four steps

### 1. Copy the starter template

```bash
cp -r node_modules/@contractqa/adapters/templates/third-party my-adapter
cd my-adapter
```

If you installed `@contractqa/adapters` via a tarball, the template is in `dist/templates/third-party/` instead. Or pull the source directly from this repo: `packages/adapters/templates/third-party/`.

### 2. Implement the methods

Open `src/index.ts`. The class skeleton lists the four required methods (`sessionKeyPatterns`, `loginAs`, `isAuthenticated`, `currentUser`, `expectFullyLoggedOut`). For each method, look at how `SupabaseAuthAdapter` does it for a working reference (`packages/adapters/src/auth/supabase.ts`).

Quick guide:

| Method | What it does | Reference |
|---|---|---|
| `sessionKeyPatterns()` | Returns regexes that match your localStorage / sessionStorage / cookie keys. Used by ContractQA's logout invariants. | All shipped adapters; copy and adapt. |
| `loginAs(role, page)` | Drives the login flow. Two patterns: (a) interactive via Playwright (`page.goto`, `page.fill`, `page.click`), or (b) inject session state directly (`page.evaluate(() => localStorage.setItem(...))`). | `SupabaseAuthAdapter` uses pattern (b). |
| `isAuthenticated(page)` | Returns true iff a session is present. Default impl: `!(await expectFullyLoggedOut(page)).fullyLoggedOut`. | — |
| `currentUser(page)` | Returns `{ id, role }` for the signed-in user, or `null`. | `SupabaseAuthAdapter` decodes localStorage. |
| `expectFullyLoggedOut(page)` | Returns `{ fullyLoggedOut, reasons }`. Reasons list every session shadow detected (localStorage key still set, cookie still present, etc.). | Default impl uses `sessionKeyPatterns()` automatically. |

### 3. Build + install into your host project

```bash
npm install
npm run build
# In the host repo:
npm i file:../my-adapter
```

(Or publish to npm and `npm i my-adapter`.)

### 4. Wire it up

In your host project's `qa/adapters/auth.ts`:

```ts
import { MyAuthAdapter } from 'my-adapter';
export const auth = new MyAuthAdapter({ /* your options */ });
```

Now ContractQA contracts using `auth.loginAs: <role>` will route to your adapter.

## Composing with existing adapters

If your project uses a hybrid setup (e.g. NextAuth for the session cookie + your own DB-backed user store), wrap with `composeAuth`:

```ts
import { composeAuth, NextAuthAdapter } from '@contractqa/adapters/public';
import { MyUserStoreAdapter } from 'my-adapter';

const nextAuth = new NextAuthAdapter({ baseUrl: 'http://localhost:3000' });
const userStore = new MyUserStoreAdapter({ db: '...' });

export const auth = composeAuth([nextAuth, userStore]);
```

In v0.3.0, `composeAuth` routes all calls to the adapter that declares `responsibilities: ['session']` (`NextAuthAdapter` in the example). `sessionKeyPatterns()` is unioned across all adapters. Per-responsibility split routing — where `currentUser` could come from a different adapter than `loginAs` — is planned for Phase 4.

## Type contracts

The interfaces live in `@contractqa/core` and are re-exported via `@contractqa/adapters/public`:

```ts
import type {
  AuthAdapter,
  AppAdapter,
  BackendAdapter,
  SessionKeyPatterns,
  AuthResponsibility,
  AuthStateAssertion,
} from '@contractqa/adapters/public';
```

These types are semver-stable (see `STABILITY.md` in the `@contractqa/adapters` package).

## Common pitfalls

- **Session injection without navigation:** if you `page.evaluate(() => localStorage.setItem(...))` before any `page.goto`, the localStorage is set on `about:blank` and disappears on the first real navigation. Always navigate to your app's origin first, then inject.
- **Cookie domain mismatch:** Playwright's `context.addCookies()` needs an explicit `url` or `domain` + `path`. Without it, the cookie is silently dropped.
- **Regex too greedy:** `/^sb/` matches `sbicpr`, not just `sb-`. Always end with a separator: `/^sb-/`, `/^sb_/`.
- **Forgotten `Promise`:** the four methods (except `sessionKeyPatterns`) are async. Returning a raw value works but flags `@typescript-eslint/promise-function-async` if you use that rule.

## When to NOT write an adapter

If your auth shape genuinely matches one of the shipped adapters, configure the shipped one instead of forking. Reasons we'd encourage you to file an issue rather than write a new adapter:

- Your stack uses NextAuth — use `NextAuthAdapter`.
- Your stack uses Supabase — use `SupabaseAuthAdapter` with `roleFixtures` or `tokenIssuer`.
- Your stack uses any custom cookie scheme where the session is one HTTP-only cookie — use `CustomCookieAuthAdapter`.

If the shipped adapter is *almost right* but missing one method, the better path is to PR a config option onto the shipped adapter (e.g. an injectable `parseSession` function). That keeps the public surface narrow and lets every user benefit.
