// Find true contract duplicates by normalized body hash (actions + expected).
// Title-stem clustering is noisy — many "edge cases" share a stem but are
// genuinely distinct invariants (e.g. -not-found / -requires-auth / -success).
//
// Two contracts are deemed duplicates iff their normalized (actions, expected)
// tuple is identical AND area matches. Output groups them so the human can
// confirm and mark `merged` with `duplicates_of`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const DIR = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';

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

// Stable JSON: sort keys recursively, strip undefined, lowercase paths/regexes.
function canonicalize(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'string') return v.toLowerCase().trim();
    return v;
  }
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    const cv = canonicalize(v[k]);
    if (cv !== undefined) out[k] = cv;
  }
  return out;
}

const groups = new Map();
for (const f of walk(DIR)) {
  let doc;
  try { doc = parseYaml(readFileSync(f, 'utf8')); } catch { continue; }
  if (!doc?.actions || !doc?.expected) continue;
  const key = createHash('sha1')
    .update(JSON.stringify(canonicalize({ area: doc.area, actions: doc.actions, expected: doc.expected })))
    .digest('hex')
    .slice(0, 12);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ id: doc.id, title: doc.title, area: doc.area, file: f });
}

const dups = [...groups.entries()].filter(([, m]) => m.length > 1);
console.log(`Found ${dups.length} true-duplicate groups across ${dups.reduce((s, [, m]) => s + m.length, 0)} contracts.\n`);

for (const [key, members] of dups.sort((a, b) => b[1].length - a[1].length)) {
  console.log(`Group ${key} — ${members.length} members (area=${members[0].area})`);
  for (const m of members) console.log(`  - ${m.id}: ${m.title}`);
  console.log();
}
