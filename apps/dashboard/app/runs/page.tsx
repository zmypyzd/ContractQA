import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db } from '../../lib/db';
import { runs } from '../../drizzle/schema';
import { RunsList, type RunRow } from './RunsList';
import s from './runs.module.css';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  let rows: typeof runs.$inferSelect[] = [];
  let dbError: string | null = null;
  try {
    rows = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(50);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const clientRows: RunRow[] = rows.map((r) => ({
    id: r.id,
    triggerType: r.triggerType ?? null,
    branch: r.branch,
    status: r.status,
    startedAt: r.startedAt?.toISOString() ?? null,
    totals: (r.totals ?? null) as RunRow['totals'],
    watchSessionId: r.watchSessionId ?? null,
  }));

  return (
    <>
      <header className={s.toolbar}>
        <div className={s.brand}>
          <svg className={s.duck} viewBox="0 0 24 24" aria-label="ContractQA">
            <path d="M14 5a3 3 0 0 0-3 3v.4c-2.5.3-4.5 2.4-4.5 5 0 1.5.7 2.8 1.7 3.7L6 19.5c-.3.4 0 .9.5.9h11a.6.6 0 0 0 .5-.9l-2.2-2.4c1-.9 1.7-2.2 1.7-3.7 0-2.6-2-4.7-4.5-5V8a3 3 0 0 0 1-2.3v-.2A.5.5 0 0 0 13.5 5H14zm-1.5 6c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3zm.5 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
          </svg>
          contractqa
        </div>
        <div className={s.toolbarMeta}>runs · {rows.length} recent</div>
        <div className={s.controls}>
          <Link href="/launcher" className={`${s.btn} ${s.btnMono}`}>
            ← launcher
          </Link>
        </div>
      </header>

      <main className={s.shell}>
        <section className={s.hero}>
          <div>
            <p className={s.eyebrow}>contractqa · dashboard</p>
            <h1 className={s.hDisplay}>
              Recent <em>Runs</em>.
            </h1>
          </div>
          <Link href="/launcher" className={`${s.btn} ${s.btnPrimary}`}>
            <span aria-hidden>+</span> New run
          </Link>
        </section>

        {dbError ? (
          <div className={s.empty}>
            <strong>Database unreachable.</strong>
            Could not connect: <code style={{ fontFamily: 'var(--font-mono)' }}>{dbError}</code>.
            Set <code style={{ fontFamily: 'var(--font-mono)' }}>DATABASE_URL</code> and start Postgres, or use{' '}
            <Link href="/launcher">/launcher</Link> directly (runs are written to <code style={{ fontFamily: 'var(--font-mono)' }}>qa/AUTOPILOT_REPORT.json</code> regardless).
          </div>
        ) : rows.length === 0 ? (
          <div className={s.empty}>
            <strong>No runs yet.</strong>
            Trigger your first run on <Link href="/launcher">/launcher</Link>, or via{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>contractqa autopilot</code> from a project directory.
          </div>
        ) : (
          <RunsList rows={clientRows} />
        )}

        <p className={s.footnote}>ContractQA · Diagnostic Modern · /runs</p>
      </main>
    </>
  );
}
