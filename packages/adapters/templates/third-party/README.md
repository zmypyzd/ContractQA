# `contractqa-adapter-example`

Starter template for a ContractQA third-party auth adapter.

## What you get

- `src/index.ts` — one class (`ExampleAuthAdapter`) implementing the `AuthAdapter` interface
- `package.json` — pinned to `@contractqa/adapters@^0.3.0` (the stable `/public` entry)
- `tsconfig.json` — strict TypeScript, ES2022 + ESNext modules

## How to use

1. Copy this directory wherever you want your adapter to live:

   ```bash
   cp -r path/to/templates/third-party my-adapter
   cd my-adapter
   ```

2. Rename in `package.json` (the `name` field) to whatever your adapter should be called.

3. Fill in the four `AuthAdapter` methods in `src/index.ts`:
   - `sessionKeyPatterns()` — regexes that match your session storage keys (localStorage, sessionStorage, cookies). Used by the `expectFullyLoggedOut` invariant to detect leftover session state.
   - `loginAs(role, page)` — drive your login flow via Playwright (`page.goto`, `page.fill`, etc.) or inject a session into the browser directly (see `SupabaseAuthAdapter` for the inject pattern).
   - `currentUser(page)` — return the currently signed-in user's `{ id, role }` or `null` when anonymous.
   - `expectFullyLoggedOut(page)` — assert no session shadow remains after logout. Default impl uses `sessionKeyPatterns` to scan localStorage and cookies.

4. Build:

   ```bash
   npm install
   npm run build
   ```

5. Wire into a host project:

   ```bash
   cd /path/to/your/app
   npm i file:/path/to/my-adapter
   ```

   Then in `qa/adapters/auth.ts`:

   ```ts
   import { ExampleAuthAdapter } from 'my-adapter';
   export const auth = new ExampleAuthAdapter();
   ```

## Stability

See `node_modules/@contractqa/adapters/STABILITY.md` for the semver guarantees on the public surface. Imports from `@contractqa/adapters/public` are stable; imports from the root or deep paths are not.

## Composing with other adapters

If your auth flow has split responsibilities (e.g. NextAuth owns the cookie, Supabase owns the user store), use `composeAuth`:

```ts
import { composeAuth, NextAuthAdapter, SupabaseAuthAdapter } from '@contractqa/adapters/public';

const nextAuth = new NextAuthAdapter({ baseUrl: 'http://localhost:3000' });
const supabase = new SupabaseAuthAdapter({ url: '...', anonKey: '...' });

export const auth = composeAuth([nextAuth, supabase]);
```

In ContractQA v0.3.0, `composeAuth` routes all calls to the adapter owning the `'session'` responsibility, except `sessionKeyPatterns()` which unions across adapters. Per-responsibility routing (where `'user-store'` and `'session'` could be owned by different adapters and each handle their slice) is on the Phase 4 roadmap.
