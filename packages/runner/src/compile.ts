import type { ContractDoc } from '@contractqa/core';
import type { StateSlice } from '@contractqa/oracle';

// The shape compileContract needs from a real Playwright Page. The runtime
// type is wider than this — we cast through `unknown` when wiring real
// pages — but this is the minimum surface.
export interface CompiledLocator {
  click(): Promise<unknown>;
  fill(v: string): Promise<unknown>;
  first(): CompiledLocator;
  getByRole(role: string, opts?: { name?: RegExp }): CompiledLocator;
  getByTestId(id: string): CompiledLocator;
  filter(opts: { has?: CompiledLocator }): CompiledLocator;
}

export interface CompiledPage {
  goto(path: string): Promise<unknown>;
  setExtraHTTPHeaders?(h: Record<string, string>): Promise<unknown>;
  getByRole(role: string, opts?: { name?: RegExp }): CompiledLocator;
  getByTestId(id: string): CompiledLocator;
  locator(selector: string): CompiledLocator;
  url(): string;
  waitForTimeout(ms: number): Promise<unknown>;
}

export interface CompiledContext {
  page: CompiledPage;
  snapshot: () => Promise<StateSlice>;
  // Optional Playwright BrowserContext, exposed so authSetup can manipulate
  // cookies / storage state. Loose-typed to avoid a hard @playwright/test
  // dep in the runner package.
  context?: unknown;
}

// Captured HTTP response from the LAST `http` action in a contract's action
// list. The Stream 1 oracle (`expected.http`) classifies against this shape.
// Headers are lowercased per HTTP RFC.
export interface CapturedHttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export interface AuthSetupContext {
  page: CompiledPage;
  context: unknown;
  contract: ContractDoc;
}

// Optional per-project auth bootstrap. Called once per contract whose
// preconditions.auth_state === 'logged_in', BEFORE the before-snapshot,
// so the snapshot reflects the logged-in state.
export type AuthSetup = (ctx: AuthSetupContext) => Promise<void>;

export interface CompileOptions {
  authSetup?: AuthSetup;
  // Base URL for `http` actions whose `path` is relative (e.g. "/api/x").
  // Required for any contract that uses `type: 'http'`. Without it, http
  // actions will throw at runtime.
  baseUrl?: string;
}

export type CompiledContract = (
  ctx: CompiledContext,
) => Promise<{
  before: StateSlice;
  after: StateSlice;
  httpResponse?: CapturedHttpResponse;
}>;

// G18 — a contract that asserts on `expected.dom` MUST navigate the browser
// page via goto/click/fill at least once. If the only actions are `http` (or
// `wait`), the dom check runs against whatever page happened to be loaded
// previously, producing a false PASS/FAIL. Throw early with a clear message.
const DOM_NAVIGATING_TYPES = new Set(['goto', 'click', 'fill']);

function assertDomActionInvariant(c: ContractDoc): void {
  if (!c.expected.dom) return;
  const hasNavigatingAction = c.actions.some((a) => DOM_NAVIGATING_TYPES.has(a.type));
  if (!hasNavigatingAction) {
    throw new Error(
      `G18: contract '${c.id}' asserts on expected.dom but has no goto/click/fill action — ` +
        `dom check would run against the wrong page. Either add a goto action, or switch to expected.http.`,
    );
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// Resolve a contract `target` into a Playwright locator. Precedence:
//   test_id  → getByTestId (most robust, unambiguous)
//   name_regex / text → accessible-name match on the role (text is escaped to a
//                       literal-substring regex; this is what makes `{text:"Barn"}`
//                       resolve to the *button named Barn* instead of collapsing to
//                       a bare getByRole('button') that strict-mode-crashes on every
//                       button on the page — the Entry-25 execution_defect cause).
//   within   → scope to an ancestor role first.
//   first    → disambiguate multi-match.
// Previously `text` and `test_id` (both valid schema fields) were silently dropped.
function resolveActionLocator(
  page: CompiledPage,
  target: { role?: string; name_regex?: string; text?: string; test_id?: string; icon?: string; within?: string; first?: boolean },
  defaultRole: string,
): CompiledLocator {
  if (target.test_id) {
    const t = page.getByTestId(target.test_id);
    return target.first ? t.first() : t;
  }
  if (target.icon) {
    // "the <role> element containing an svg whose class includes <icon>".
    // Use getByRole(...).filter({has}) — NOT page.locator('button') or CSS
    // `:has()`: (a) Playwright's CSS `:has()` doesn't reliably match a
    // descendant svg here; (b) page.locator('button') also matches hidden
    // responsive duplicates (mobile+desktop), so .first() lands on a hidden
    // node and the click times out. getByRole resolves to the visible,
    // accessible controls (verified live on the WebTestBench lucide stepper:
    // getByRole→3 clickable vs locator('button')→6 incl. hidden).
    // Sanitize <icon> to word/dash chars so it's a safe CSS attribute-substring.
    const icon = target.icon.replace(/[^a-zA-Z0-9_-]/g, '');
    const role = target.role ?? defaultRole;
    const base = target.within
      ? page.getByRole(target.within).getByRole(role)
      : page.getByRole(role);
    const t = base.filter({ has: page.locator(`svg[class*="${icon}"]`) });
    return target.first ? t.first() : t;
  }
  const roleOpts: { name?: RegExp } = {};
  if (target.name_regex) roleOpts.name = new RegExp(target.name_regex, 'i');
  else if (target.text) roleOpts.name = new RegExp(escapeRegex(target.text), 'i');
  const role = target.role ?? defaultRole;
  const scope = target.within
    ? page.getByRole(target.within).getByRole(role, roleOpts)
    : page.getByRole(role, roleOpts);
  return target.first ? scope.first() : scope;
}

export function compileContract(c: ContractDoc, opts: CompileOptions = {}): CompiledContract {
  assertDomActionInvariant(c);
  return async (ctx) => {
    if (c.preconditions?.auth_state === 'logged_in' && opts.authSetup) {
      await opts.authSetup({ page: ctx.page, context: ctx.context, contract: c });
    }
    const before = await ctx.snapshot();
    let httpResponse: CapturedHttpResponse | undefined;
    for (const a of c.actions) {
      if (a.type === 'goto') {
        if (a.locale && ctx.page.setExtraHTTPHeaders) {
          await ctx.page.setExtraHTTPHeaders({ 'Accept-Language': a.locale });
        }
        await ctx.page.goto(a.path);
      } else if (a.type === 'click') {
        await resolveActionLocator(ctx.page, a.target, 'button').click();
      } else if (a.type === 'fill') {
        await resolveActionLocator(ctx.page, a.target, 'textbox').fill(a.value);
      } else if (a.type === 'wait') {
        await ctx.page.waitForTimeout(a.ms);
      } else if (a.type === 'http') {
        if (!opts.baseUrl) {
          throw new Error(
            `compileContract: contract '${c.id}' has an http action but no baseUrl was passed in CompileOptions.`,
          );
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(a.headers ?? {})) headers[k.toLowerCase()] = v;
        if (a.body !== undefined && headers['content-type'] === undefined) {
          headers['content-type'] = 'application/json';
        }
        const init: RequestInit = {
          method: a.method,
          headers,
          ...(a.body !== undefined ? { body: JSON.stringify(a.body) } : {}),
        };
        const res = await fetch(`${opts.baseUrl}${a.path}`, init);
        const respHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          respHeaders[key.toLowerCase()] = value;
        });
        httpResponse = {
          status: res.status,
          body: await res.text(),
          headers: respHeaders,
        };
      }
    }
    if (c.verification.wait_ms > 0) await ctx.page.waitForTimeout(c.verification.wait_ms);
    const after = await ctx.snapshot();
    return { before, after, httpResponse };
  };
}
