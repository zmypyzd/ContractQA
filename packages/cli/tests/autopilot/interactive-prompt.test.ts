// packages/cli/tests/autopilot/interactive-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { confirmUncertainProposals } from '../../src/autopilot/interactive-prompt.js';
import type { ContractProposal } from '../../src/autopilot/llm-discovery.js';

function makeProposal(id: string, choices: string[] = ['a', 'b']): ContractProposal {
  return {
    yaml: `id: ${id}\n`,
    confidence: 'medium',
    module: 'auth',
    uncertainQuestions: [{
      text: `Question for ${id}?`,
      type: 'multiple-choice',
      choices,
      defaultAnswer: choices[0],
      appliesTo: 'whole-contract',
    }],
    evidence: { sourceFiles: [], rationale: '' },
  };
}

describe('confirmUncertainProposals', () => {
  it('with --yes, accepts all proposals using their defaultAnswer', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const r = await confirmUncertainProposals('auth', [makeProposal('A'), makeProposal('B')], { in: input, out: output }, { yes: true });
    expect(r.accepted.length).toBe(2);
    expect(r.rejected.length).toBe(0);
    expect(r.skipped.length).toBe(0);
  });

  it('answers user-supplied letter choice for each question', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = confirmUncertainProposals('auth', [makeProposal('A', ['a', 'b'])], { in: input, out: output }, {});
    // Provide answer
    setImmediate(() => input.write('a\n'));
    const r = await p;
    expect(r.accepted.length).toBe(1);
  });

  it('user typing skip moves the proposal to skipped bucket', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = confirmUncertainProposals('auth', [makeProposal('A')], { in: input, out: output }, {});
    setImmediate(() => input.write('skip\n'));
    const r = await p;
    expect(r.skipped.length).toBe(1);
  });

  it('stream closing mid-session resolves without hanging (no SIGINT hang)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const proposals = [makeProposal('A'), makeProposal('B')];
    const p = confirmUncertainProposals('auth', proposals, { in: input, out: output }, {});
    // End the input stream (EOF) before any answer is provided, simulating a closed pipe.
    // readline emits 'close' on input end, which the fixed ask() resolves on.
    setImmediate(() => input.end());
    const r = await p;
    // Should resolve without hanging; all unanswered proposals must be accounted for.
    expect(r.skipped.length + r.accepted.length + r.rejected.length).toBe(proposals.length);
  }, 10000);
});
