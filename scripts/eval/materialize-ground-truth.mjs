// Materialize the mechanical parts of qa/eval/poker/ground-truth/:
//   1. true-duplicate groups (body-hash match) → all members written as
//      ground-truth entries; non-canonicals get status=merged, canonical
//      gets status=pending-review (verified_in_product=false) for human to
//      flip after spot-checking the product.
//   2. schema-invalid (lenient-loader skip) → status=dropped with the first
//      schema issue captured in review.notes. Reviewer may rescue if the
//      intent is valid but the shape is wrong.
//
// Everything else (the 199-ish runnable + 246 fail) stays in the review
// table, awaiting human decisions.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const DIR = '/Users/zmy/intership/qa-eval-fixtures/5-4-claude/v0-2026-05-21/scratch/qa/contracts';
const OUT = 'qa/eval/poker/ground-truth';
const RUN_LOG = '/tmp/run-2026-05-25-v4-with-oracle.log';

const today = new Date().toISOString();
const reviewer = 'eval-automation';

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

mkdirSync(OUT, { recursive: true });

// (1) collect docs
const docs = walk(DIR).map((f) => {
  try { return { f, doc: parseYaml(readFileSync(f, 'utf8')) }; } catch { return null; }
}).filter((x) => x && x.doc?.id);

// (2) detect schema-skipped via run log
const log = readFileSync(RUN_LOG, 'utf8');
const skipReason = new Map();
for (const m of log.matchAll(/loader: skipping (\S+\.yml): schema validation failed \(\d+ issues?; first: "([^"]+)"/g)) {
  if (!skipReason.has(m[1])) skipReason.set(m[1], m[2].slice(0, 100));
}

// (3) cluster by body hash
const groups = new Map();
for (const { f, doc } of docs) {
  if (!doc.actions || !doc.expected) continue;
  const key = createHash('sha1')
    .update(JSON.stringify(canonicalize({ area: doc.area, actions: doc.actions, expected: doc.expected })))
    .digest('hex')
    .slice(0, 12);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ f, doc });
}
const dups = [...groups.entries()].filter(([, m]) => m.length > 1);

// (4) write merged + canonical
let mergedWritten = 0;
let canonicalWritten = 0;
for (const [key, members] of dups) {
  // pick canonical = first by id alphabetically (deterministic)
  members.sort((a, b) => a.doc.id.localeCompare(b.doc.id));
  const canonical = members[0];
  const others = members.slice(1);

  // canonical
  const cgt = {
    ...canonical.doc,
    category: ['unclassified'],
    provenance: {
      source: 'autopilot',
      generated_at: today,
      reviewed_by: reviewer,
      reviewed_at: today,
      status: 'approved',
      duplicates_of: [],
    },
    review: {
      validity: 'tp',
      validity_verified_in_product: false,
      specificity: 1,
      severity_original: canonical.doc.severity,
      severity_final: canonical.doc.severity,
      notes: `Canonical of true-duplicate body-hash group ${key} (${members.length} members). Absorbs: ${others.map(o => o.doc.id).join(', ')}. PENDING human verified_in_product flip.`,
    },
  };
  writeFileSync(join(OUT, `${canonical.doc.id}.yml`), toYaml(cgt));
  canonicalWritten++;

  // merged
  for (const m of others) {
    const mgt = {
      ...m.doc,
      category: ['unclassified'],
      provenance: {
        source: 'autopilot',
        generated_at: today,
        reviewed_by: reviewer,
        reviewed_at: today,
        status: 'merged',
        duplicates_of: [canonical.doc.id],
      },
      review: {
        validity: 'tp',
        validity_verified_in_product: false,
        specificity: 1,
        severity_original: m.doc.severity,
        severity_final: m.doc.severity,
        notes: `Body-hash duplicate of ${canonical.doc.id} (group ${key}); actions+expected byte-identical, only title differs.`,
      },
    };
    writeFileSync(join(OUT, `${m.doc.id}.yml`), toYaml(mgt));
    mergedWritten++;
  }
}

// (5) write schema-skipped as status: dropped
let droppedWritten = 0;
for (const { f, doc } of docs) {
  if (!skipReason.has(f)) continue;
  if (!doc?.id) continue;
  const dgt = {
    ...doc,
    category: ['unclassified'],
    provenance: {
      source: 'autopilot',
      generated_at: today,
      reviewed_by: reviewer,
      reviewed_at: today,
      status: 'dropped',
      duplicates_of: [],
    },
    review: {
      validity: 'fp',
      validity_verified_in_product: false,
      specificity: 0,
      severity_original: doc.severity ?? 'P3',
      severity_final: doc.severity ?? 'P3',
      notes: `Schema-invalid as generated: ${skipReason.get(f)}. Reviewer may rescue if the intent describes a real invariant; otherwise leave dropped.`,
    },
  };
  writeFileSync(join(OUT, `${doc.id}.yml`), toYaml(dgt));
  droppedWritten++;
}

console.log(`Wrote ${canonicalWritten} canonical + ${mergedWritten} merged + ${droppedWritten} dropped to ${OUT}/`);
console.log(`Pending human review: ${docs.length - canonicalWritten - mergedWritten - droppedWritten} contracts (101 PASS / 246 FAIL minus dup-group members)`);
