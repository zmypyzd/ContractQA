'use client';

import { useState } from 'react';
import Link from 'next/link';
import s from './runs.module.css';

interface Totals {
  passed?: number;
  failed?: number;
  skipped?: number;
  ok?: number;
  fail?: number;
  skip?: number;
  deferred?: number;
}

export interface RunRow {
  id: string;
  triggerType: string | null;
  branch: string | null;
  status: string | null;
  startedAt: string | null; // ISO; Date is not serializable across boundary
  totals: Totals | null;
  watchSessionId: string | null;
}

type Group =
  | { kind: 'single'; row: RunRow }
  | { kind: 'session'; sessionId: string; runs: RunRow[] };

export function RunsList({ rows }: { rows: RunRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = groupByWatchSession(rows);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th style={{ width: 200 }}>Started</th>
            <th style={{ width: 140 }}>Trigger</th>
            <th>Branch</th>
            <th style={{ width: 120 }}>Status</th>
            <th style={{ width: 240 }}>Totals</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            if (g.kind === 'single') return renderSingleRow(g.row);
            const isExpanded = expanded.has(g.sessionId);
            return (
              <>
                {renderSessionRow(g, isExpanded, () => toggle(g.sessionId))}
                {isExpanded && g.runs.map((r) => renderIterationRow(r))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderSingleRow(r: RunRow) {
  const t = totalsFor(r);
  const status = r.status ?? 'unknown';
  const dotClass = statusDotClass(status);
  return (
    <tr key={r.id} className={s.clickableRow}>
      <td className={s.colMono}>
        <Link href={`/runs/${r.id}`} className={s.rowLinkInvisible}>
          {formatTs(r.startedAt)}
        </Link>
      </td>
      <td className={s.colMono}>{r.triggerType ?? '—'}</td>
      <td className={s.colBranch}>{r.branch ?? '—'}</td>
      <td>
        <span className={s.statusCell}>
          <span className={`${s.dot} ${dotClass}`} />
          <span style={{ color: isAccentStatus(status) }}>{status}</span>
        </span>
      </td>
      <td>{renderTotalsCell(t)}</td>
      <td>
        <Link href={`/runs/${r.id}`} className={s.rowLink}>
          view →
        </Link>
      </td>
    </tr>
  );
}

function renderIterationRow(r: RunRow) {
  const t = totalsFor(r);
  const status = r.status ?? 'unknown';
  const dotClass = statusDotClass(status);
  return (
    <tr key={r.id} className={`${s.clickableRow} ${s.iterationSubRow}`}>
      <td className={s.colMono}>
        <Link href={`/runs/${r.id}`} className={s.rowLinkInvisible}>
          <span className={s.iterationIndent}>↳</span> {formatTs(r.startedAt)}
        </Link>
      </td>
      <td className={s.colMono} style={{ color: 'var(--muted-2)' }}>iteration</td>
      <td className={s.colBranch}>{r.branch ?? '—'}</td>
      <td>
        <span className={s.statusCell}>
          <span className={`${s.dot} ${dotClass}`} />
          <span style={{ color: isAccentStatus(status) }}>{status}</span>
        </span>
      </td>
      <td>{renderTotalsCell(t)}</td>
      <td>
        <Link href={`/runs/${r.id}`} className={s.rowLink}>
          view →
        </Link>
      </td>
    </tr>
  );
}

function renderSessionRow(g: Extract<Group, { kind: 'session' }>, isExpanded: boolean, onToggle: () => void) {
  const latest = g.runs[0]; // sorted desc, latest first
  if (!latest) return null;
  const status = latest.status ?? 'unknown';
  const dotClass = statusDotClass(status);
  const passedSum = g.runs.reduce((acc, r) => acc + (totalsFor(r).passed ?? 0), 0);
  const failedSum = g.runs.reduce((acc, r) => acc + (totalsFor(r).failed ?? 0), 0);
  return (
    <tr key={g.sessionId} className={`${s.clickableRow} ${s.sessionRow}`} onClick={onToggle}>
      <td className={s.colMono}>
        <button
          type="button"
          className={s.sessionToggle}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'collapse watch session' : 'expand watch session'}
        >
          <span className={s.sessionCaret}>{isExpanded ? '▾' : '▸'}</span>{' '}
          {formatTs(latest.startedAt)}
        </button>
      </td>
      <td className={s.colMono}>
        <span className={s.sessionBadge}>watch · {g.runs.length} iter</span>
      </td>
      <td className={s.colBranch}>{latest.branch ?? '—'}</td>
      <td>
        <span className={s.statusCell}>
          <span className={`${s.dot} ${dotClass}`} />
          <span style={{ color: isAccentStatus(status) }}>{status} (latest)</span>
        </span>
      </td>
      <td>
        <span className={s.totals}>
          <span className={s.totalOk}>Σ {passedSum} ok</span>
          {failedSum > 0 && <span className={s.totalBad}>Σ {failedSum} fail</span>}
        </span>
      </td>
      <td>
        <Link
          href={`/runs/${latest.id}`}
          className={s.rowLink}
          onClick={(e) => e.stopPropagation()}
        >
          latest →
        </Link>
      </td>
    </tr>
  );
}

function groupByWatchSession(rows: RunRow[]): Group[] {
  // Rows arrive sorted by startedAt DESC. Walk them and bucket consecutive
  // same-sessionId rows together. Single runs (null sessionId) stay alone.
  const groups: Group[] = [];
  for (const r of rows) {
    if (r.watchSessionId == null) {
      groups.push({ kind: 'single', row: r });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.kind === 'session' && last.sessionId === r.watchSessionId) {
      last.runs.push(r);
    } else {
      groups.push({ kind: 'session', sessionId: r.watchSessionId, runs: [r] });
    }
  }
  return groups;
}

function totalsFor(r: RunRow): Totals {
  const t = (r.totals ?? {}) as Totals;
  return {
    passed: t.passed ?? t.ok ?? 0,
    failed: t.failed ?? t.fail ?? 0,
    skipped: t.skipped ?? t.skip ?? t.deferred ?? 0,
  };
}

function renderTotalsCell(t: Totals) {
  return (
    <span className={s.totals}>
      <span className={s.totalOk}>{t.passed ?? 0} ok</span>
      {(t.failed ?? 0) > 0 && <span className={s.totalBad}>{t.failed} fail</span>}
      {(t.skipped ?? 0) > 0 && <span className={s.totalSkip}>{t.skipped} skip</span>}
    </span>
  );
}

function statusDotClass(status: string): string {
  if (status === 'running' || status === 'in-progress') return s.dotWarning;
  if (status === 'failed' || status === 'error' || status === 'interrupted') return s.dotError;
  if (status === 'passed' || status === 'success') return s.dotSuccess;
  return s.dotIdle;
}

function isAccentStatus(status: string): string | undefined {
  if (status === 'running' || status === 'in-progress') return 'var(--accent)';
  if (status === 'failed' || status === 'error' || status === 'interrupted') return 'var(--error)';
  return undefined;
}

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
