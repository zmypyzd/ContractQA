'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { type DetectionResult, validateProjectPath } from './actions';
import s from './launcher.module.css';

type Phase = 'idle' | 'active' | 'done';
type PhaseId = 'A' | 'B' | 'C' | 'D' | 'E';

const PHASES: Array<{ id: PhaseId; name: string }> = [
  { id: 'A', name: 'A · smoke' },
  { id: 'B', name: 'B · read' },
  { id: 'C', name: 'C · generate' },
  { id: 'D', name: 'D · verify' },
  { id: 'E', name: 'E · fix' },
];

const RECENT_ITEMS = [
  { path: '/Users/zmy/intership/5.10+/qa-agent', label: 'qa-agent', when: '2h ago' },
  { path: 'fix/logout-cookie-leak', label: 'fix/logout-cookie-leak', when: 'yesterday' },
  { path: 'feat/dashboard-launcher', label: 'feat/dashboard-launcher', when: '3d ago' },
  { path: 'dogfood/sentinel', label: 'dogfood/sentinel', when: '5d ago' },
];

export default function LauncherPage() {
  const [path, setPath] = useState('/Users/zmy/intership/5.10+/qa-agent');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Validate path on input change (debounced).
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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!detection?.ok) return;
      setRunning(true);
      // TODO: open SSE stream to orchestrator. For now, just reveal the
      // progress strip so the visual flow is testable.
      requestAnimationFrame(() => {
        document.getElementById('progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [detection],
  );

  const phaseState = (id: PhaseId): Phase => {
    if (!running) return 'idle';
    if (id === 'A' || id === 'B') return 'done';
    if (id === 'C') return 'active';
    return 'idle';
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  };

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
                onClick={() => setPath(item.path.startsWith('/') ? item.path : `/Users/zmy/intership/5.10+/${item.path}`)}
              >
                <span className={s.recentPath}>{item.label}</span>
                <span className={s.recentWhen}>{item.when}</span>
              </button>
            ))}
          </aside>
        </section>

        {running && (
          <section id="progress" className={s.progress}>
            <div className={s.progressHead}>
              <p className={s.eyebrow} style={{ margin: 0 }}>
                Run in progress · <span>00:12.847</span>
              </p>
              <div className={s.progressTotal}>
                <span className={s.progressTotalLabel}>run</span>
                <span>r_01HX7E…</span>
              </div>
            </div>
            <div className={s.phases}>
              {PHASES.map((p) => {
                const state = phaseState(p.id);
                return (
                  <div
                    key={p.id}
                    className={`${s.phase} ${
                      state === 'done' ? s.phaseDone : state === 'active' ? s.phaseActive : s.phaseIdle
                    }`}
                  >
                    <div className={s.phaseName}>
                      <span className={s.phaseDot} />
                      {p.name}
                    </div>
                    <div className={s.phaseTime}>
                      {state === 'done' && (p.id === 'A' ? '2.30s' : '4.11s')}
                      {state === 'active' && '6.42s'}
                      {state === 'idle' && '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <p className={s.footnote}>ContractQA · Diagnostic Modern · /launcher</p>
      </main>
    </>
  );
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
  const { packageManager, isWorkspace, packageCount, hasNext, nextLocation, hasContracts, contractsCount } =
    detection.detected;
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
