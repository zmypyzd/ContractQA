import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { eq, asc } from 'drizzle-orm';
import { StateDiffViewer } from '../../../components/StateDiffViewer';
import { EvidenceLinks } from '../../../components/EvidenceLinks';
import { db } from '../../../lib/db';
import { issues } from '../../../drizzle/schema';
import s from './issue.module.css';

export const dynamic = 'force-dynamic';

interface IssueJson {
  title?: string;
  severity?: string;
  confidence?: number;
  expected?: unknown;
  actual?: unknown;
  artifacts: {
    trace?: string;
    state_diff?: string;
    repro?: string;
    screenshot?: string;
    video?: string;
  };
}

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let row: typeof issues.$inferSelect | undefined;
  // Sibling issues for prev/next nav within the same run. Best-effort; empty
  // on DB failure (only the current issue render fails fatally, navigation
  // just hides itself).
  let siblings: Array<{ id: string; title: string | null; severity: string | null }> = [];
  try {
    [row] = await db.select().from(issues).where(eq(issues.id, id));
    if (row?.runId) {
      siblings = await db
        .select({ id: issues.id, title: issues.title, severity: issues.severity })
        .from(issues)
        .where(eq(issues.runId, row.runId))
        .orderBy(asc(issues.id));
    }
  } catch (err) {
    return (
      <>
        <Toolbar />
        <main className={s.shell}>
          <p className={s.eyebrow}>
            <span className={`${s.badge} ${s.badgeError}`}>DATABASE UNREACHABLE</span>
          </p>
          <h1 className={s.title}>Can't load this issue.</h1>
          <p className={s.lede}>
            Postgres rejected the connection ({describeDbError(err)}). Set <code>DATABASE_URL</code> and start Postgres, then reload.
          </p>
          <div className={s.actions}>
            <Link href="/runs" className={`${s.btn} ${s.btnMono}`}>← recent runs</Link>
          </div>
        </main>
      </>
    );
  }

  if (!row) {
    return (
      <>
        <Toolbar />
        <main className={s.shell}>
          <p className={s.eyebrow}>contractqa · issue</p>
          <h1 className={s.title}>Not found.</h1>
          <p className={s.lede}>
            No issue exists with id <code>{id}</code>. It may have been resolved and pruned, or the link is wrong.
          </p>
          <Link href="/runs" className={`${s.btn} ${s.btnMono}`}>
            ← recent runs
          </Link>
        </main>
      </>
    );
  }

  const issueJsonPath = row.issueJsonPath;
  if (!issueJsonPath) {
    return (
      <>
        <Toolbar />
        <main className={s.shell}>
          <p className={s.eyebrow}>contractqa · issue</p>
          <h1 className={s.title}>Missing evidence path.</h1>
          <p className={s.lede}>
            This issue has no recorded evidence on disk. Was the run aborted before evidence was written?
          </p>
        </main>
      </>
    );
  }

  const issueDir = path.dirname(issueJsonPath);
  const issueJson: IssueJson = JSON.parse(await readFile(issueJsonPath, 'utf8'));

  // state-diff and repro are best-effort — issues from older runs may lack them.
  let diffJson: { diff?: Parameters<typeof StateDiffViewer>[0]['diff'] } | null = null;
  try {
    diffJson = JSON.parse(await readFile(path.join(issueDir, 'diffs', 'state-diff.json'), 'utf8'));
  } catch {
    diffJson = null;
  }

  let reproSrc: string | null = null;
  if (issueJson.artifacts?.repro) {
    try {
      reproSrc = await readFile(path.join(issueDir, issueJson.artifacts.repro), 'utf8');
    } catch {
      reproSrc = null;
    }
  }

  const severity = (issueJson.severity ?? row.severity ?? 'unknown').toLowerCase();
  const confidence = issueJson.confidence ?? (row.confidence != null ? Number(row.confidence) : null);
  const severityBadgeClass =
    severity === 'critical' || severity === 'high' ? s.badgeError : severity === 'medium' ? s.badgeWarn : s.badgeMuted;

  const currentIndex = siblings.findIndex((sib) => sib.id === id);
  const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  return (
    <>
      <Toolbar />
      <main className={s.shell}>
        <p className={s.eyebrow}>
          <span className={`${s.badge} ${s.badgeError}`}>CONTRACT FAILED</span>
          <span className={`${s.badge} ${severityBadgeClass}`}>severity · {severity}</span>
          {confidence != null && (
            <span className={`${s.badge} ${s.badgeMuted}`}>confidence · {(confidence * 100).toFixed(0)}%</span>
          )}
          {siblings.length > 1 && (
            <span className={`${s.badge} ${s.badgeMuted}`}>
              issue {currentIndex + 1} of {siblings.length}
            </span>
          )}
        </p>

        <h1 className={s.title}>{issueJson.title ?? row.title ?? 'Untitled issue'}.</h1>

        <p className={s.lede}>
          The runner re-entered protected state and the contract assertion did not hold. Diff and minimal repro below.
        </p>

        <div className={s.actions}>
          {prev && (
            <Link
              href={`/issues/${prev.id}`}
              className={`${s.btn} ${s.btnMono}`}
              title={prev.title ?? prev.id}
            >
              ← prev
            </Link>
          )}
          {next && (
            <Link
              href={`/issues/${next.id}`}
              className={`${s.btn} ${s.btnMono}`}
              title={next.title ?? next.id}
            >
              next →
            </Link>
          )}
          {row.runId && (
            <Link href={`/runs/${row.runId}`} className={`${s.btn} ${s.btnMono}`}>
              ↑ run {row.runId.slice(0, 8)}
            </Link>
          )}
          <Link href="/runs" className={`${s.btn} ${s.btnMono}`}>
            recent runs
          </Link>
          {issueJson.artifacts && (
            <a
              className={`${s.btn} ${s.btnMono}`}
              href={`/artifacts/${id}/${issueJson.artifacts.trace ?? ''}`}
              target="_blank"
              rel="noreferrer"
            >
              open trace
            </a>
          )}
        </div>

        <section className={s.section}>
          <h2 className={s.sectionHead}>Expected vs Actual</h2>
          <div className={s.expectedActual}>
            <div className={s.column}>
              <div className={`${s.columnHead} ${s.expected}`}>expected</div>
              <pre className={s.code}>{stringifyShort(issueJson.expected)}</pre>
            </div>
            <div className={s.column}>
              <div className={`${s.columnHead} ${s.actual}`}>actual</div>
              <pre className={s.code}>{stringifyShort(issueJson.actual)}</pre>
            </div>
          </div>
        </section>

        {diffJson?.diff && (
          <section className={s.section}>
            <h2 className={s.sectionHead}>State diff</h2>
            <StateDiffViewer diff={diffJson.diff} />
          </section>
        )}

        <section className={s.section}>
          <h2 className={s.sectionHead}>Evidence</h2>
          <EvidenceLinks evidence={issueJson.artifacts} basePath={`/artifacts/${id}`} />
        </section>

        {reproSrc && (
          <section className={s.section}>
            <h2 className={s.sectionHead}>Minimal repro</h2>
            <div className={s.repro}>
              <div className={s.reproHead}>
                <span>{issueJson.artifacts.repro}</span>
                <span>{reproSrc.split('\n').length} lines</span>
              </div>
              <pre className={s.reproCode}>{reproSrc}</pre>
            </div>
          </section>
        )}

        {row.fixOutcome && (
          <section className={s.fixCard} data-outcome={row.fixOutcome}>
            <h2 className={s.sectionHead}>Auto-fix</h2>
            <dl>
              <dt>Outcome</dt>
              <dd>
                <span className={`${s.fixOutcomeBadge} ${fixOutcomeBadgeClass(row.fixOutcome, s)}`}>
                  {row.fixOutcome}
                </span>
              </dd>
              {row.fixPrUrl && (
                <>
                  <dt>Pull Request</dt>
                  <dd>
                    <a href={row.fixPrUrl} target="_blank" rel="noreferrer">
                      {row.fixPrUrl}
                    </a>
                  </dd>
                </>
              )}
              {row.fixBranch && (
                <>
                  <dt>Branch</dt>
                  <dd><code>{row.fixBranch}</code></dd>
                </>
              )}
            </dl>
          </section>
        )}

        <p className={s.footnote}>ContractQA · Diagnostic Modern · /issues/{id.slice(0, 8)}…</p>
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
      <div className={s.toolbarMeta}>issue · contract failure</div>
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

function fixOutcomeBadgeClass(outcome: string, s: Record<string, string>): string {
  const o = outcome.toLowerCase();
  if (o === 'success') return s.fixOutcomeSuccess;
  if (o === 'regression') return s.fixOutcomeRegression;
  if (o === 'skipped_pr_exists') return s.fixOutcomeSkipped;
  return s.fixOutcomeMuted;
}

function stringifyShort(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function describeDbError(err: unknown): string {
  // node-postgres on connection failure throws AggregateError with one Error
  // per resolved address. Surface the first nested message so the user sees
  // something concrete (ECONNREFUSED, ENOTFOUND, etc.) instead of an empty
  // top-level .message.
  if (err instanceof AggregateError && err.errors.length > 0) {
    const first = err.errors[0];
    if (first instanceof Error && first.message) return first.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'unknown error';
}
