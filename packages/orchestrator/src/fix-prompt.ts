import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFixPromptFile(bundlePath: string, dest: string): Promise<string> {
  const issue = await readFile(path.join(bundlePath, 'issue.json'), 'utf8');
  const body = `You are fixing a product invariant violation.

Rules:
1. Read the issue bundle first.
2. Run the failing repro before editing.
3. Fix production code, not the repro, unless the repro contradicts INVARIANTS.md.
4. Do not weaken product invariants. If the invariant itself is wrong, emit a proposed_contract_revision JSON block (see §13.1.1) and STOP — do not modify product code.
5. Keep the patch minimal.
6. After patching, run:
   - the failing repro
   - related unit tests
   - affected e2e tests
7. Return JSON with root_cause, files_changed, tests_run, validation_result.

Issue bundle:
- issue: ${path.join(bundlePath, 'issue.json')}
- repro: ${path.join(bundlePath, 'repro.spec.ts')}
- state diff: ${path.join(bundlePath, 'diffs', 'state-diff.json')}
- trace: ${path.join(bundlePath, 'trace.zip')}

issue.json contents:
${issue}
`;
  await writeFile(dest, body);
  return dest;
}
