import type { StateSlice } from '@contractqa/oracle';

export interface ExpectedEffect {
  name: string;
  check: (before: StateSlice, after: StateSlice) => boolean | Promise<boolean>;
}

export interface VerifiedActionInput {
  name: string;
  before: () => Promise<StateSlice>;
  action: () => Promise<void>;
  after: () => Promise<StateSlice>;
  expectedEffects: ExpectedEffect[];
}

export interface VerifiedActionResult {
  name: string;
  before: StateSlice;
  after: StateSlice;
  results: Array<{ name: string; passed: boolean }>;
}

export async function verifiedAction(input: VerifiedActionInput): Promise<VerifiedActionResult> {
  const before = await input.before();
  await input.action();
  const after = await input.after();
  const results: Array<{ name: string; passed: boolean }> = [];
  for (const e of input.expectedEffects) {
    results.push({ name: e.name, passed: !!(await e.check(before, after)) });
  }
  return { name: input.name, before, after, results };
}
