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
}

export interface CompiledPage {
  goto(path: string): Promise<unknown>;
  setExtraHTTPHeaders?(h: Record<string, string>): Promise<unknown>;
  getByRole(role: string, opts?: { name?: RegExp }): CompiledLocator;
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
        const opts: { name?: RegExp } = {};
        if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
        const scope = a.target.within
          ? ctx.page.getByRole(a.target.within).getByRole(a.target.role ?? 'button', opts)
          : ctx.page.getByRole(a.target.role ?? 'button', opts);
        const loc = a.target.first ? scope.first() : scope;
        await loc.click();
      } else if (a.type === 'fill') {
        const opts: { name?: RegExp } = {};
        if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
        const scope = a.target.within
          ? ctx.page.getByRole(a.target.within).getByRole(a.target.role ?? 'textbox', opts)
          : ctx.page.getByRole(a.target.role ?? 'textbox', opts);
        const loc = a.target.first ? scope.first() : scope;
        await loc.fill(a.value);
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
