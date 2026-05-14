import Link from 'next/link';
import { db } from '../../lib/db.js';
import { runs } from '../../drizzle/schema.js';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const rows = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(50);
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>ContractQA — Recent Runs</h1>
      <table style={{ width: '100%', marginTop: 16 }}>
        <thead>
          <tr>
            <th>Started</th>
            <th>Trigger</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Totals</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.startedAt?.toISOString()}</td>
              <td>{r.triggerType}</td>
              <td>{r.branch}</td>
              <td>{r.status}</td>
              <td>{JSON.stringify(r.totals)}</td>
              <td>
                <Link href={`/issues?run=${r.id}`}>issues</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
