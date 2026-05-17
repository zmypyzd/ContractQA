'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { type DetectionResult, validateProjectPath } from './actions';
import type { LauncherEvent, PhaseId, PhaseStatus } from './events';
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

const RECENT_ITEMS = [
  { path: '/Users/zmy/intership/5.10+/qa-agent', label: 'qa-agent', when: '2h ago' },
  { path: 'fix/logout-cookie-leak', label: 'fix/logout-cookie-leak', when: 'yesterday' },
  { path: 'feat/dashboard-launcher', label: 'feat/dashboard-launcher', when: '3d ago' },
  { path: 'dogfood/sentinel', label: 'dogfood/sentinel', when: '5d ago' },
];

type RunOutcome = 'pending' | 'success' | 'budget' | 'interrupt' | 'error';

export default function LauncherPage() {
  const [path, setPath] = useState('/Users/zmy/intership/5.10+/qa-agent');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const [phases, setPhases] = useState<PhaseMap>(newPhaseMap);
  const [runId, setRunId] = useState<string | null>(null);
  const [runOutcome, setRunOutcome] = useState<RunOutcome>('pending');
  const [running, setRunning] = useState(false);
  const [elapsedNow, setElapsedNow] = useState(0);
  const [logs, setLogs] = useState<Array<{ message: string; level: 'info' | 'warn' | 'error' }>>([]);

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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!detection?.ok) return;

      // Reset state from any prior run.
      sourceRef.current?.close();
      setPhases(newPhaseMap());
      setLogs([]);
      setRunId(null);
      setRunOutcome('pending');
      runStartedAtRef.current = Date.now();
      setElapsedNow(0);
      setRunning(true);

      const url = `/launcher/stream?cwd=${encodeURIComponent(detection.resolvedPath)}&fix=true`;
      const es = new EventSource(url);
      sourceRef.current = es;

      es.addEventListener('run-start', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'run-start' }>;
        runStartedAtRef.current = data.startedAt;
        setRunId(data.runId);
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
      });

      es.addEventListener('run-end', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Extract<LauncherEvent, { type: 'run-end' }>;
        setRunOutcome(data.outcome);
        setRunning(false);
        es.close();
        sourceRef.current = null;
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
    [detection],
  );

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
                  />
                </div>
                <button type="button" className={s.btn} disabled>
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
                  <span aria-hidden>▶</span> {running ? 'Running…' : 'Run autopilot'}
                </button>
                <button type="button" className={s.btn} disabled>
                  contractqa run (existing contracts)
                </button>
                <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnMono}`} disabled>
                  --dry-run
                </button>
              </div>
            </div>
          </form>

          <aside className={s.recent} aria-label="Recent projects on this machine">
            <h4>Recent · this machine</h4>
            {RECENT_ITEMS.map((item) => (
              <button
                key={item.path}
                type="button"
                className={s.recentItem}
                onClick={() =>
                  setPath(
                    item.path.startsWith('/')
                      ? item.path
                      : `/Users/zmy/intership/5.10+/${item.path}`,
                  )
                }
              >
                <span className={s.recentPath}>{item.label}</span>
                <span className={s.recentWhen}>{item.when}</span>
              </button>
            ))}
          </aside>
        </section>

        {showProgress && (
          <section id="progress" className={s.progress}>
            <div className={s.progressHead}>
              <p className={s.eyebrow} style={{ margin: 0 }}>
                {runOutcomeHeader(runOutcome, running)} · {formatElapsed(elapsedNow)}
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
    if (counters.generated != null) parts.push(`${counters.generated} gen`);
    if (counters.failed) parts.push(`${counters.failed} fail`);
    if (counters.deferred) parts.push(`${counters.deferred} deferred`);
    const yn = (counters.userConfirmed ?? 0) + (counters.userRejected ?? 0);
    if (yn) parts.push(`${yn} y/n`);
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
