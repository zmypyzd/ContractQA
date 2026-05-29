import { loadContractsFromDir } from '/Users/zmy/intership/5.10+/qa-agent/packages/runner/dist/index.js';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';

const DIR = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';

// We need to count skipped — loadContractsFromDir(lenient) prints to stderr
// but returns only the loaded set. So we walk + try-load per file.
import { ContractSchema } from '/Users/zmy/intership/5.10+/qa-agent/packages/core/dist/index.js';

function walk(root) {
  const out = [];
  (function rec(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (e.endsWith('.yml') || e.endsWith('.yaml')) out.push(p);
    }
  })(root);
  return out;
}

const files = walk(DIR);
let loaded = 0, skipped = 0;
const reasons = new Map();
for (const f of files) {
  try {
    const doc = parseYaml(await readFile(f, 'utf8'));
    const r = ContractSchema.safeParse(doc);
    if (r.success) loaded++;
    else {
      skipped++;
      const first = r.error.issues[0];
      const key = `${first.path.join('.')}: ${first.message.slice(0, 60)}`;
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
  } catch (e) {
    skipped++;
    reasons.set('yaml-parse-error', (reasons.get('yaml-parse-error') || 0) + 1);
  }
}
console.log(`total=${files.length} loaded=${loaded} skipped=${skipped} skip%=${(skipped/files.length*100).toFixed(1)}`);
console.log('\nTop skip reasons:');
for (const [k, n] of [...reasons.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10)) {
  console.log(`  ${n}\t${k}`);
}
