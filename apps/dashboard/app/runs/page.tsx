import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db } from '../../lib/db';
import { runs } from '../../drizzle/schema';
import s from './runs.module.css';

export const dynamic = 'force-dynamic';

interface Totals {
  passed?: number;
  failed?: number;
  skipped?: number;
  // alternative names that older runs may carry
  ok?: number;
  fail?: number;
  skip?: number;
  deferred?: number;
}

export default async function RunsPage() {
  // DB may be unreachable in dev (no Postgres running). Render an honest
  // empty/error state rather than a 500 — the rest of the dashboard works
  // without a DB (launcher uses the local filesystem only).
  let rows: typeof runs.$inferSelect[] = [];
  let dbError: string | null = null;
  try {
    rows = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(50);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

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
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Started</th>
                  <th style={{ width: 120 }}>Trigger</th>
                  <th>Branch</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 240 }}>Totals</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const totals = (r.totals ?? {}) as Totals;
                  const passed = totals.passed ?? totals.ok ?? 0;
                  const failed = totals.failed ?? totals.fail ?? 0;
                  const skipped = totals.skipped ?? totals.skip ?? totals.deferred ?? 0;
                  const isRunning = r.status === 'running' || r.status === 'in-progress';
                  const isError = r.status === 'failed' || r.status === 'error';
                  const isActive = isRunning;
                  return (
                    <tr key={r.id} className={isActive ? s.active : ''}>
                      <td className={s.colMono}>{formatTimestamp(r.startedAt)}</td>
                      <td className={s.colMono}>{r.triggerType ?? '—'}</td>
                      <td className={s.colBranch}>{r.branch ?? '—'}</td>
                      <td>
                        <span className={s.statusCell}>
                          <span
                            className={`${s.dot} ${
                              isRunning ? s.dotWarning : isError ? s.dotError : r.status === 'passed' || r.status === 'success' ? s.dotSuccess : s.dotIdle
                            }`}
                          />
                          <span style={{ color: isRunning ? 'var(--accent)' : isError ? 'var(--error)' : undefined }}>
                            {r.status ?? 'unknown'}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={s.totals}>
                          <span className={s.totalOk}>{passed} ok</span>
                          {failed > 0 && <span className={s.totalBad}>{failed} fail</span>}
                          {skipped > 0 && <span className={s.totalSkip}>{skipped} skip</span>}
                        </span>
                      </td>
                      <td>
                        <Link href={`/issues?run=${r.id}`} className={s.rowLink}>
                          view →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className={s.footnote}>ContractQA · Diagnostic Modern · /runs</p>
      </main>
    </>
  );
}

function formatTimestamp(d: Date | null): string {
  if (!d) return '—';
  // YYYY-MM-DD HH:MM:SS in user's local time, no timezone suffix to keep table tight.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
