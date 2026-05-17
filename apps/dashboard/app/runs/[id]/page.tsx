import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { runs, issues } from '../../../drizzle/schema';
import s from './run.module.css';

export const dynamic = 'force-dynamic';

interface TotalsShape {
  passed?: number;
  failed?: number;
  deferred?: number;
  a_passed?: number;
  a_failed?: number;
  b_generated?: number;
  b_failed?: number;
  b_confirmed?: number;
  b_rejected?: number;
  c_attempted?: number;
  c_fixed?: number;
  c_givenUp?: number;
  // legacy / alternative names
  ok?: number;
  fail?: number;
  skip?: number;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let run: typeof runs.$inferSelect | undefined;
  let issuesForRun: typeof issues.$inferSelect[] = [];
  let dbError: string | null = null;

  try {
    [run] = await db.select().from(runs).where(eq(runs.id, id));
    if (run) {
      issuesForRun = await db.select().from(issues).where(eq(issues.runId, id));
    }
  } catch (err) {
    dbError = describeDbError(err);
  }

  if (dbError) {
    return (
      <>
        <Toolbar />
        <main className={s.shell}>
          <p className={s.eyebrow}>
            <span className={`${s.badge} ${s.badgeError}`}>DATABASE UNREACHABLE</span>
          </p>
          <h1 className={s.title}>Can't load this run.</h1>
          <p className={s.metaValue} style={{ color: 'var(--muted)' }}>
            Postgres rejected the connection ({dbError}). Set DATABASE_URL and start Postgres, then reload.
          </p>
          <Link href="/runs" className={`${s.btn} ${s.btnMono}`} style={{ marginTop: 'var(--s-5)' }}>
            ← recent runs
          </Link>
        </main>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <Toolbar />
        <main className={s.shell}>
          <p className={s.eyebrow}>contractqa · run</p>
          <h1 className={s.notFound}>Run not found.</h1>
          <p className={s.metaValue} style={{ color: 'var(--muted)', marginTop: 'var(--s-3)' }}>
            No run exists with id <code>{id}</code>.
          </p>
          <Link href="/runs" className={`${s.btn} ${s.btnMono}`} style={{ marginTop: 'var(--s-5)' }}>
            ← recent runs
          </Link>
        </main>
      </>
    );
  }

  const totals = (run.totals ?? {}) as TotalsShape;
  const status = (run.status ?? 'unknown').toLowerCase();
  const statusBadgeClass =
    status === 'passed' || status === 'success'
      ? s.badgeSuccess
      : status === 'running' || status === 'in-progress'
        ? s.badgeWarn
        : status === 'failed' || status === 'error' || status === 'interrupted'
          ? s.badgeError
          : '';

  const durationMs = run.startedAt && run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null;

  return (
    <>
      <Toolbar />
      <main className={s.shell}>
        <p className={s.eyebrow}>
          <span className={`${s.badge} ${statusBadgeClass}`}>{status}</span>
          <span className={s.badge}>{run.triggerType ?? 'unknown trigger'}</span>
          {run.branch && <span className={s.badge}>branch · {run.branch}</span>}
        </p>

        <h1 className={s.title}>
          Run <em>{id.slice(0, 8)}</em>.
        </h1>

        <dl className={s.metaGrid}>
          <div className={s.metaItem}>
            <span className={s.metaLabel}>Started</span>
            <span className={s.metaValue}>{formatTs(run.startedAt)}</span>
          </div>
          <div className={s.metaItem}>
            <span className={s.metaLabel}>Ended</span>
            <span className={s.metaValue}>{formatTs(run.endedAt)}</span>
          </div>
          <div className={s.metaItem}>
            <span className={s.metaLabel}>Duration</span>
            <span className={s.metaValue}>{durationMs != null ? formatDuration(durationMs) : '—'}</span>
          </div>
          {run.cwd && (
            <div className={s.metaItem} style={{ gridColumn: '1 / -1' }}>
              <span className={s.metaLabel}>Project</span>
              <span className={s.metaValue}>{run.cwd}</span>
            </div>
          )}
          {run.commitSha && (
            <div className={s.metaItem}>
              <span className={s.metaLabel}>Commit</span>
              <span className={s.metaValue}>{run.commitSha.slice(0, 12)}</span>
            </div>
          )}
        </dl>

        <section className={s.section}>
          <h2 className={s.sectionHead}>Totals</h2>
          <ul className={s.totalsList}>
            {renderTotals(totals).map(([k, v]) => (
              <li key={k}>
                <span className={s.totalsKey}>{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.section}>
          <h2 className={s.sectionHead}>
            Issues {issuesForRun.length > 0 && <span style={{ color: 'var(--muted)', fontSize: '0.6em' }}>· {issuesForRun.length}</span>}
          </h2>
          {issuesForRun.length === 0 ? (
            <div className={s.empty}>
              <strong>No issues recorded for this run.</strong>
              {totals.failed && totals.failed > 0
                ? 'Counters show failures but no issue rows were materialized. Future autopilot iterations will write rich issue evidence here.'
                : 'All contracts passed (or were deferred to `contractqa run`).'}
            </div>
          ) : (
            <ul className={s.issueList}>
              {issuesForRun.map((issue) => {
                const severity = (issue.severity ?? 'low').toLowerCase();
                const dotClass =
                  severity === 'critical' || severity === 'high'
                    ? s.issueDotHigh
                    : severity === 'medium'
                      ? s.issueDotMedium
                      : s.issueDotLow;
                return (
                  <li key={issue.id}>
                    <Link href={`/issues/${issue.id}`} className={s.issueRow}>
                      <span className={`${s.issueDot} ${dotClass}`} />
                      <span className={s.issueTitle}>{issue.title ?? 'Untitled issue'}</span>
                      <span className={s.issueSeverity}>{severity}</span>
                      <span className={s.issueArrow}>view →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className={s.footnote}>ContractQA · Diagnostic Modern · /runs/{id.slice(0, 8)}…</p>
      </main>
    </>
  );
}

function Toolbar() {
  return (
    <header className={s.toolbar}>
      <div className={s.brand}>
        <svg className={s.duck} viewBox="0 0 24 24" aria-label="ContractQA">
          <path d="M14 5a3 3 0 0 0-3 3v.4c-2.5.3-4.5 2.4-4.5 5 0 1.5.7 2.8 1.7 3.7L6 19.5c-.3.4 0 .9.5.9h11a.6.6 0 0 0 .5-.9l-2.2-2.4c1-.9 1.7-2.2 1.7-3.7 0-2.6-2-4.7-4.5-5V8a3 3 0 0 0 1-2.3v-.2A.5.5 0 0 0 13.5 5H14zm-1.5 6c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3zm.5 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
        </svg>
        contractqa
      </div>
      <div className={s.toolbarMeta}>run · detail</div>
      <div className={s.controls}>
        <Link href="/runs" className={`${s.btn} ${s.btnMono}`}>
          ← runs
        </Link>
        <Link href="/launcher" className={`${s.btn} ${s.btnMono}`}>
          launcher
        </Link>
      </div>
    </header>
  );
}

function renderTotals(t: TotalsShape): Array<[string, number]> {
  // Show the autopilot-native phase breakdown when present, otherwise fall
  // back to the legacy aggregate fields. Each phase contributes whatever it
  // has; we never invent zeros.
  const rows: Array<[string, number]> = [];
  const push = (k: string, v: number | undefined) => {
    if (v != null) rows.push([k, v]);
  };
  push('A · passed', t.a_passed);
  push('A · failed', t.a_failed);
  push('B · generated', t.b_generated);
  push('B · failed', t.b_failed);
  push('B · confirmed', t.b_confirmed);
  push('B · rejected', t.b_rejected);
  push('C · attempted', t.c_attempted);
  push('C · fixed', t.c_fixed);
  push('C · gave up', t.c_givenUp);
  if (rows.length === 0) {
    push('passed', t.passed ?? t.ok);
    push('failed', t.failed ?? t.fail);
    push('deferred', t.deferred ?? t.skip);
  }
  return rows;
}

function formatTs(d: Date | null | undefined): string {
  if (!d) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(2)}s`;
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(1);
  return `${m}m ${s}s`;
}

function describeDbError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    const first = err.errors[0];
    if (first instanceof Error && first.message) return first.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'unknown error';
}
