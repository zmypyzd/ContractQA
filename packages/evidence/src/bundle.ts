import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { EvidenceBundleManifest } from '@contractqa/core';

export interface WriteBundleInput {
  runId: string;
  contractId: string;
  artifactsRoot: string;
  files: Record<string, Buffer>;
  redactionApplied?: boolean;
}

export async function writeEvidenceBundle(input: WriteBundleInput): Promise<EvidenceBundleManifest> {
  const runDir = path.join(input.artifactsRoot, 'runs', input.runId);
  await mkdir(runDir, { recursive: true });

  const files: EvidenceBundleManifest['files'] = [];
  for (const [rel, buf] of Object.entries(input.files)) {
    const abs = path.join(runDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    files.push({
      path: rel,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      kind: classify(rel),
    });
  }

  const manifest: EvidenceBundleManifest = {
    bundle_id: `bundle_${input.runId}`,
    created_at: new Date().toISOString(),
    contract_id: input.contractId,
    run_id: input.runId,
    files,
    redaction_applied: input.redactionApplied ?? true,
  };
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function classify(rel: string): string {
  if (rel.endsWith('.png')) return 'screenshot';
  if (rel.endsWith('.zip')) return 'trace';
  if (rel.endsWith('.har')) return 'network';
  if (rel.endsWith('.log')) return 'console';
  if (rel.startsWith('snapshots/')) return 'snapshot';
  if (rel.startsWith('diffs/')) return 'diff';
  if (rel === 'issue.json') return 'issue';
  if (rel.endsWith('.spec.ts')) return 'repro';
  return 'other';
}
