import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StateDiffViewer } from '../../../components/StateDiffViewer.js';
import { EvidenceLinks } from '../../../components/EvidenceLinks.js';
import { db } from '../../../lib/db.js';
import { issues } from '../../../drizzle/schema.js';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function IssuePage({ params }: { params: { id: string } }) {
  const [row] = await db.select().from(issues).where(eq(issues.id, params.id));
  if (!row) return <main style={{ padding: 24 }}>Not found</main>;
  const issueJsonPath = row.issueJsonPath!;
  const issueDir = path.dirname(issueJsonPath);
  const issueJson = JSON.parse(await readFile(issueJsonPath, 'utf8'));
  const diffJson = JSON.parse(
    await readFile(path.join(issueDir, 'diffs', 'state-diff.json'), 'utf8'),
  );
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>{issueJson.title}</h1>
      <p>
        severity={issueJson.severity} confidence={issueJson.confidence}
      </p>
      <section>
        <h2>Expected vs Actual</h2>
        <pre>{JSON.stringify({ expected: issueJson.expected, actual: issueJson.actual }, null, 2)}</pre>
      </section>
      <StateDiffViewer diff={diffJson.diff} />
      <h2>Evidence</h2>
      <EvidenceLinks
        evidence={issueJson.artifacts}
        basePath={`/artifacts/${path.basename(issueDir)}`}
      />
      <h2>Minimal Repro</h2>
      <pre>{await readFile(path.join(issueDir, issueJson.artifacts.repro), 'utf8')}</pre>
    </main>
  );
}
