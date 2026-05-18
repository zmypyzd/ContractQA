'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  type DetectionResult,
  type RecentProjectRow,
  listRecentProjects,
  recordRecentProject,
  validateProjectPath,
} from './actions';
import type { LauncherEvent, PhaseId, PhaseStatus } from './events';
import { FolderPicker } from './FolderPicker';
import s from './launcher.module.css';

interface PhaseSnapshot {
  status: PhaseStatus;
  /** Server-stamped elapsedMs at the most recent transition into status. */
  elapsedAtTransition: number | null;
  /** Server-stamped elapsedMs at the most recent counter update inside the phase. */
  elapsedLatest: number;
  counters?: NonNullable<Extract<LauncherEvent, { type: 'phase' }>['counters']>;
}

const INITIAL_PHASE: PhaseSnapshot = {
  status: 'idle',
  elapsedAtTransition: null,
  elapsedLatest: 0,
};

const PHASES: ReadonlyArray<{ id: PhaseId; name: string }> = [
  { id: 'A', name: 'A · smoke' },
  { id: 'B', name: 'B · discovery' },
  { id: 'C', name: 'C · auto-fix' },
];

type PhaseMap = Record<PhaseId, PhaseSnapshot>;
const newPhaseMap = (): PhaseMap => ({
  A: { ...INITIAL_PHASE },
  B: { ...INITIAL_PHASE },
  C: { ...INITIAL_PHASE },
});

/**
 * Seed list shown before the DB responds (or when Postgres is down). Replaced
 * by listRecentProjects() on mount.
 */
const RECENT_SEED: RecentProjectRow[] = [
  {
    absolutePath: '/Users/zmy/intership/5.10+/qa-agent',
    label: 'qa-agent',
    lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    runCount: 0,
  },
];

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / (60 * 60 * 1000))}h ago`;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

type RunOutcome = 'pending' | 'success' | 'budget' | 'interrupt' | 'error';

export default function LauncherPage() {
  const [path, setPath] = useState('/Users/zmy/intership/5.10+/qa-agent');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [recentItems, setRecentItems] = useState<RecentProjectRow[]>(RECENT_SEED);
  const [isPending, startTransition] = useTransition();
  const [watchMode, setWatchMode] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const [errors, setErrors] = useState<Array<{ id: number; message: string }>>([]);
  const errorIdRef = useRef(0);

  const [pickerOpen, setPickerOpen] = useState(false);

  const [phases, setPhases] = useState<PhaseMap>(newPhaseMap);
  const [runId, setRunId] = useState<string | null>(null);
  const [runOutcome, setRunOutcome] = useState<RunOutcome>('pending');
  const [running, setRunning] = useState(false);
  const [elapsedNow, setElapsedNow] = useState(0);
  const [logs, setLogs] = useState<Array<{ message: string; level: 'info' | 'warn' | 'error' }>>([]);
  const [iteration, setIteration] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);
  const runStartedAtRef = useRef<number | null>(null);

  // Debounced path validation.
  useEffect(() => {
    const trimmed = path.trim();
    if (!trimmed) {
      setDetection(null);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await validateProjectPath(trimmed);
        setDetection(result);
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [path]);

  // Live elapsed clock while running. Server stamps elapsedMs on every event,
  // but between events we still want the header timer to tick — so we run a
  // local rAF clock that resets when the run starts.
  useEffect(() => {
    if (!running || runStartedAtRef.current == null) return;
    let raf = 0;
    const tick = () => {
      const startedAt = runStartedAtRef.current;
      if (startedAt != null) setElapsedNow(Date.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Cleanup the EventSource on unmount.
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  // Load real recent projects on mount; fall back silently to the seed when
  // Postgres is unavailable (listRecentProjects returns []).
  useEffect(() => {
    let cancelled = false;
    listRecentProjects(8).then((rows) => {
      if (cancelled) return;
      if (rows.length > 0) setRecentItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const startRun = useCallback(
    (mode: 'regular' | 'night-shift') => {
      if (!detection?.ok) return;

      // Night-shift implies watch (continuous re-run on file change).
      const isContinuous = mode === 'night-shift' || watchMode;

      // Reset state from any prior run.
      sourceRef.current?.close();
      setPhases(newPhaseMap());
      setLogs([]);
      setRunId(null);
      setRunOutcome('pending');
      setIteration(0);
      runStartedAtRef.current = Date.now();
      setElapsedNow(0);
      setRunning(true);
      setErrors([]);  // a fresh run clears stale errors

      // Fire-and-forget: persist this project as a recent. Server action
      // swallows errors so DB outages can't break the run.
      void recordRecentProject(detection.resolvedPath, detection.detected);

      const params = new URLSearchParams({
        cwd: detection.resolvedPath,
        fix: 'true',
      });
      if (isContinuous) params.set('watch', 'true');
      if (mode === 'night-shift') params.set('autoPr', 'true');
      if (deepMode) params.set('discoveryMode', 'deep');  // ← new
      const url = `/launcher/stream?${params.toString()}`;
      const es = new EventSource(url);
      sourceRef.current = es;

      es.addEventListener('run-start', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'run-start' }>;
        runStartedAtRef.current = data.startedAt;
        setRunId(data.runId);
        // In watch mode, run-start fires for every iteration. Reset phases /
        // logs / elapsed for the new iteration so the strip starts fresh.
        setIteration((prev) => {
          const nextIter = prev + 1;
          // Auto-scroll the progress section into view on every subsequent
          // iteration so a user who scrolled away during a long pause sees
          // the new run start immediately. The first iteration is already
          // scrolled-to by handleSubmit, so skip iter 1 here.
          if (nextIter > 1) {
            requestAnimationFrame(() => {
              document.getElementById('progress')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              });
            });
          }
          return nextIter;
        });
        setPhases(newPhaseMap());
        setLogs([]);
        setRunOutcome('pending');
        setRunning(true);
        setElapsedNow(0);
      });

      es.addEventListener('phase', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'phase' }>;
        setPhases((prev) => {
          const next = { ...prev };
          const current = next[data.phase];
          const transitioning = current.status !== data.status;
          next[data.phase] = {
            status: data.status,
            elapsedAtTransition: transitioning ? data.elapsedMs : current.elapsedAtTransition,
            elapsedLatest: data.elapsedMs,
            counters: data.counters ?? current.counters,
          };
          return next;
        });
      });

      es.addEventListener('log', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'log' }>;
        setLogs((prev) => [...prev.slice(-9), { message: data.message, level: data.level }]);
        if (data.level === 'error') {
          const id = ++errorIdRef.current;
          setErrors((prev) => [...prev, { id, message: data.message }]);
        }
      });

      es.addEventListener('run-end', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'run-end' }>;
        setRunOutcome(data.outcome);
        setRunning(false);
        // In continuous modes (watch or night-shift), the stream stays open
        // and another run-start may fire. Only close for one-shot runs.
        if (!isContinuous) {
          es.close();
          sourceRef.current = null;
        }
      });

      es.onerror = () => {
        // Network drop or server close. Mark the run as errored if it was still
        // in flight; the run-end handler already runs on a clean server close.
        setRunOutcome((prev) => (prev === 'pending' ? 'error' : prev));
        setRunning(false);
        es.close();
        sourceRef.current = null;
      };

      requestAnimationFrame(() => {
        document.getElementById('progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [detection, watchMode, deepMode],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      startRun('regular');
    },
    [startRun],
  );

  const handleNightShift = useCallback(() => {
    startRun('night-shift');
  }, [startRun]);

  const toggleTheme = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  };

  const showProgress = running || runOutcome !== 'pending';

  return (
    <>
      <header className={s.toolbar}>
        <div className={s.brand}>
          <svg className={s.duck} viewBox="0 0 24 24" aria-label="ContractQA">
            <path d="M14 5a3 3 0 0 0-3 3v.4c-2.5.3-4.5 2.4-4.5 5 0 1.5.7 2.8 1.7 3.7L6 19.5c-.3.4 0 .9.5.9h11a.6.6 0 0 0 .5-.9l-2.2-2.4c1-.9 1.7-2.2 1.7-3.7 0-2.6-2-4.7-4.5-5V8a3 3 0 0 0 1-2.3v-.2A.5.5 0 0 0 13.5 5H14zm-1.5 6c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3zm.5 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
          </svg>
          contractqa
          <span className={s.versionBadge}>v1.1.0-beta.2</span>
        </div>
        <div className={s.toolbarMeta}>launcher · contractqa autopilot</div>
        <div className={s.controls}>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost} ${s.btnMono}`}
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            ↹ theme
          </button>
          <a className={`${s.btn} ${s.btnMono}`} href="/runs">
            recent runs →
          </a>
        </div>
      </header>

      <main className={s.shell}>
        <p className={s.eyebrow}>contractqa autopilot · zero-yaml onboarding</p>
        <h1 className={s.hDisplay}>
          Run on a <em>project</em>.
        </h1>
        <p className={s.lede}>
          Point at a folder. We write 6 universal smoke patterns, read your source, generate
          per-module contracts, ask Y/N when uncertain, and{' '}
          <strong>auto-fix what we can</strong>. All deterministic — no LLM-as-judge.
        </p>

        <section className={s.launcher}>
          <form onSubmit={handleSubmit} autoComplete="off">
            <div className={s.field}>
              <label className={s.label} htmlFor="folder">
                Project folder <span className={s.req}>·</span>
              </label>
              <div className={s.rowFiles}>
                <div className={s.inputWrap}>
                  <input
                    id="folder"
                    type="text"
                    spellCheck={false}
                    className={`${s.input} ${
                      detection && !detection.ok ? s.inputInvalid : ''
                    }`}
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    // Password managers and form-autofill extensions inject
                    // style/data-* attrs onto inputs before React hydrates,
                    // producing a hydration mismatch under React 19.
                    suppressHydrationWarning
                  />
                </div>
                <button type="button" className={s.btn} onClick={() => setPickerOpen(true)}>
                  Browse…
                </button>
              </div>
              {renderHint(detection, isPending)}
            </div>

            <div className={s.field}>
              <label className={s.label}>LLM provider</label>
              <div className={s.row}>
                <span className={`${s.pill} ${s.pillAccent}`}>
                  <span className="dot" /> OPENAI_API_KEY · server-side
                </span>
                <span className={`${s.pill} ${s.pillDim}`}>OPENAI_BASE_URL · configurable</span>
              </div>
              <p className={s.hint}>
                Override in <code>~/.gstack/openai.json</code> to use Anthropic or Claude Code.
              </p>
            </div>

            <div className={s.field}>
              <label className={s.label}>What to run</label>
              <div className={s.row}>
                <button
                  type="submit"
                  className={`${s.btn} ${s.btnPrimary}`}
                  disabled={!detection?.ok || running}
                >
                  <span aria-hidden>▶</span>{' '}
                  {running ? 'Running…' : watchMode ? 'Watch & re-run' : 'Run autopilot'}
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnNightShift}`}
                  disabled={!detection?.ok || running}
                  onClick={handleNightShift}
                  title="Night-shift: watch + auto-PR. Requires gh CLI + git remote. Each fix opens its own PR."
                >
                  <span aria-hidden>🌙</span>{' '}
                  夜班
                </button>
                <label className={s.toggle} title="Re-run autopilot every time a source file changes">
                  <input
                    type="checkbox"
                    className={s.toggleInput}
                    checked={watchMode}
                    onChange={(e) => setWatchMode(e.target.checked)}
                    disabled={running}
                    suppressHydrationWarning
                  />
                  <span className={s.toggleSwitch} aria-hidden />
                  <span className={s.toggleLabel}>Watch</span>
                  <span className={s.toggleSubLabel}>re-run on file change</span>
                </label>
                <label className={s.toggle} title="Scan all UI/API surfaces, 1 contract per interaction. 5-15 min, ~$3-5 LLM.">
                  <input
                    type="checkbox"
                    className={s.toggleInput}
                    checked={deepMode}
                    onChange={(e) => setDeepMode(e.target.checked)}
                    disabled={running}
                    suppressHydrationWarning
                  />
                  <span className={s.toggleSwitch} aria-hidden />
                  <span className={s.toggleLabel}>DEEP</span>
                  <span className={s.toggleSubLabel}>discover all interactions</span>
                </label>
              </div>
            </div>
          </form>

          <aside className={s.recent} aria-label="Recent projects on this machine">
            <h4>Recent · this machine</h4>
            {recentItems.length === 0 ? (
              <p className={s.hint} style={{ margin: 0 }}>
                No history yet. Run autopilot once and this list fills in.
              </p>
            ) : (
              recentItems.map((item) => (
                <button
                  key={item.absolutePath}
                  type="button"
                  className={s.recentItem}
                  onClick={() => setPath(item.absolutePath)}
                  title={item.absolutePath}
                >
                  <span className={s.recentPath}>{item.label}</span>
                  <span className={s.recentWhen}>{formatRelativeTime(item.lastUsedAt)}</span>
                </button>
              ))
            )}
          </aside>
        </section>

        {errors.length > 0 && (
          <section className={s.errorsBanner} aria-label="Errors during this session">
            <header>
              <strong>{errors.length} error{errors.length === 1 ? '' : 's'}</strong>
              <button type="button" className={s.errorsClear} onClick={() => setErrors([])}>
                Clear
              </button>
            </header>
            <ul>
              {errors.map((e) => (
                <li key={e.id}>{e.message}</li>
              ))}
            </ul>
          </section>
        )}

        {showProgress && (
          <section id="progress" className={s.progress}>
            <div className={s.progressHead}>
              <p className={s.eyebrow} style={{ margin: 0 }}>
                {runOutcomeHeader(runOutcome, running)} · {formatElapsed(elapsedNow)}
                {watchMode && iteration > 0 && (
                  <span className={s.iterationCounter}>iteration {iteration}</span>
                )}
              </p>
              <div className={s.progressTotal}>
                <span className={s.progressTotalLabel}>run</span>
                <span>{runId ?? '—'}</span>
              </div>
            </div>
            <div className={s.phases}>
              {PHASES.map((p) => (
                <PhaseCard key={p.id} id={p.id} name={p.name} snapshot={phases[p.id]} />
              ))}
            </div>
            {logs.length > 0 && (
              <ul className={s.logList} aria-label="Run log">
                {logs.map((entry, i) => (
                  <li key={i} className={s.logItem} data-level={entry.level}>
                    {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <p className={s.footnote}>ContractQA · Diagnostic Modern · /launcher</p>
      </main>
      {pickerOpen && (
        <FolderPicker
          initialPath={path}
          onSelect={(p) => {
            setPath(p);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

function PhaseCard({ id, name, snapshot }: { id: PhaseId; name: string; snapshot: PhaseSnapshot }) {
  const stateClass =
    snapshot.status === 'done'
      ? s.phaseDone
      : snapshot.status === 'active'
        ? s.phaseActive
        : snapshot.status === 'skipped'
          ? s.phaseSkipped
          : s.phaseIdle;

  const timeText =
    snapshot.status === 'idle'
      ? '—'
      : snapshot.status === 'skipped'
        ? 'skipped'
        : formatElapsed(snapshot.elapsedLatest);

  return (
    <div className={`${s.phase} ${stateClass}`}>
      <div className={s.phaseName}>
        <span className={s.phaseDot} />
        {name}
      </div>
      <div className={s.phaseTime}>{timeText}</div>
      {snapshot.counters && <div className={s.phaseCounters}>{renderCounters(id, snapshot.counters)}</div>}
    </div>
  );
}

function renderCounters(
  phase: PhaseId,
  counters: NonNullable<Extract<LauncherEvent, { type: 'phase' }>['counters']>,
): string {
  if (phase === 'A') {
    const parts: string[] = [];
    if (counters.passed != null) parts.push(`${counters.passed} ok`);
    if (counters.failed) parts.push(`${counters.failed} fail`);
    if (counters.deferred) parts.push(`${counters.deferred} deferred`);
    return parts.join(' · ');
  }
  if (phase === 'B') {
    const parts: string[] = [];
    // Deep-discovery diagnostics: surface "found N → wrote M" when present.
    // Modules path leaves interactionsFound undefined → falls through to the
    // simple "M gen" rendering, no behavior change for the default mode.
    if (counters.interactionsFound != null) {
      parts.push(`found ${counters.interactionsFound}`);
      parts.push(`wrote ${counters.generated ?? 0}`);
    } else if (counters.generated != null) {
      parts.push(`${counters.generated} gen`);
    }
    if (counters.failed) parts.push(`${counters.failed} fail`);
    if (counters.deferred) parts.push(`${counters.deferred} deferred`);
    const yn = (counters.userConfirmed ?? 0) + (counters.userRejected ?? 0);
    if (yn) parts.push(`${yn} y/n`);
    if (counters.fallbackUsed) {
      parts.push(`⚠ fell back: ${counters.fallbackReason ?? 'unknown'}`);
    }
    return parts.join(' · ');
  }
  // C
  const parts: string[] = [];
  if (counters.attempted != null && counters.attempted > 0) parts.push(`${counters.attempted} tried`);
  if (counters.fixed != null && counters.fixed > 0) parts.push(`${counters.fixed} fixed`);
  if (counters.givenUp != null && counters.givenUp > 0) parts.push(`${counters.givenUp} gave up`);
  return parts.join(' · ');
}

function formatElapsed(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec - m * 60).toFixed(2);
  return `${m.toString().padStart(2, '0')}:${s.padStart(5, '0')}`;
}

function runOutcomeHeader(outcome: RunOutcome, running: boolean): string {
  if (running) return 'Run in progress';
  switch (outcome) {
    case 'success':
      return 'Run complete';
    case 'budget':
      return 'Run hit time budget';
    case 'interrupt':
      return 'Run interrupted';
    case 'error':
      return 'Run failed';
    default:
      return 'Run pending';
  }
}

function renderHint(detection: DetectionResult | null, isPending: boolean) {
  if (isPending && !detection) {
    return <p className={s.hint}>Checking path…</p>;
  }
  if (!detection) {
    return <p className={s.hint}>Type or paste a project folder path above.</p>;
  }
  if (!detection.ok) {
    return <p className={s.error}>{detection.error}</p>;
  }
  const {
    packageManager,
    isWorkspace,
    packageCount,
    hasNext,
    nextLocation,
    hasContracts,
    contractsCount,
  } = detection.detected;
  const parts: string[] = [];
  if (packageManager !== 'unknown') parts.push(packageManager);
  if (isWorkspace) parts.push(`${packageCount} packages`);
  if (hasNext) parts.push(`Next.js at ${nextLocation}`);
  if (hasContracts) parts.push(`${contractsCount} existing contracts`);
  return (
    <p className={s.hint}>
      Detected: {parts.length === 0 ? <em>nothing notable</em> : parts.join(' · ')}.
    </p>
  );
}
