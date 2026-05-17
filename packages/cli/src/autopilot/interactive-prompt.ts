// packages/cli/src/autopilot/interactive-prompt.ts
import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { ContractProposal } from './llm-discovery.js';

export interface PromptIO {
  in: Readable;
  out: Writable;
}

export interface ConfirmOptions {
  yes?: boolean;
}

export interface ConfirmResult {
  accepted: ContractProposal[];
  rejected: ContractProposal[];
  skipped: ContractProposal[];
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    const onClose = () => resolve('');
    rl.once('close', onClose);
    try {
      rl.question(question, (a) => {
        rl.removeListener('close', onClose);
        resolve(a.trim());
      });
    } catch {
      // readline was already closed (e.g. input stream ended or SIGINT fired).
      rl.removeListener('close', onClose);
      resolve('');
    }
  });
}

export async function confirmUncertainProposals(
  module: string,
  proposals: ContractProposal[],
  io: PromptIO,
  opts: ConfirmOptions,
): Promise<ConfirmResult> {
  const accepted: ContractProposal[] = [];
  const rejected: ContractProposal[] = [];
  const skipped: ContractProposal[] = [];

  if (opts.yes) {
    for (const p of proposals) accepted.push(p);
    return { accepted, rejected, skipped };
  }

  const rl = createInterface({ input: io.in, output: io.out, terminal: false });
  let sigint = false;
  const onSigint = () => { sigint = true; rl.close(); };
  process.once('SIGINT', onSigint);

  try {
    io.out.write(`\nmodule: ${module} — ${proposals.length} proposals need confirmation\n\n`);
    for (let i = 0; i < proposals.length; i++) {
      if (sigint) {
        for (let j = i; j < proposals.length; j++) skipped.push(proposals[j]!);
        break;
      }
      const p = proposals[i]!;
      const q = p.uncertainQuestions?.[0];
      if (!q) { accepted.push(p); continue; }
      io.out.write(`[${i + 1}/${proposals.length}] ${q.text}\n`);
      if (q.type === 'multiple-choice' && q.choices) {
        for (let j = 0; j < q.choices.length; j++) {
          io.out.write(`  ${String.fromCharCode(97 + j)}) ${q.choices[j]}\n`);
        }
      } else {
        io.out.write('  (y/n)\n');
      }
      io.out.write('  > ');
      const ans = await ask(rl, '');
      if (ans === 'skip') { skipped.push(p); continue; }
      if (ans === 'no' || ans === 'n') { rejected.push(p); continue; }
      accepted.push(p);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    rl.close();
  }
  return { accepted, rejected, skipped };
}
