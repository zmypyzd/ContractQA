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
}

export type CompiledContract = (
  ctx: CompiledContext,
) => Promise<{ before: StateSlice; after: StateSlice }>;

export function compileContract(c: ContractDoc): CompiledContract {
  return async (ctx) => {
    const before = await ctx.snapshot();
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
      }
    }
    if (c.verification.wait_ms > 0) await ctx.page.waitForTimeout(c.verification.wait_ms);
    const after = await ctx.snapshot();
    return { before, after };
  };
}
