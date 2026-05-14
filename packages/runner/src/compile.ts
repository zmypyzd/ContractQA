import type { ContractDoc } from '@contractqa/core';
import type { StateSlice } from '@contractqa/oracle';

// The shape compileContract needs from a real Playwright Page. The runtime
// type is wider than this — we cast through `unknown` when wiring real
// pages — but this is the minimum surface.
export interface CompiledLocator {
  click(): Promise<unknown>;
  fill(v: string): Promise<unknown>;
  first(): CompiledLocator;
}

export interface CompiledPage {
  goto(path: string): Promise<unknown>;
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
        await ctx.page.goto(a.path);
      } else if (a.type === 'click') {
        const opts: { name?: RegExp } = {};
        if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
        let loc = ctx.page.getByRole(a.target.role ?? 'button', opts);
        if (a.target.first) loc = loc.first();
        await loc.click();
      } else if (a.type === 'fill') {
        const opts: { name?: RegExp } = {};
        if (a.target.name_regex) opts.name = new RegExp(a.target.name_regex, 'i');
        let loc = ctx.page.getByRole(a.target.role ?? 'textbox', opts);
        if (a.target.first) loc = loc.first();
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
