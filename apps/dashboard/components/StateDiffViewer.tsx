import type { ReactElement } from 'react';
import s from './StateDiffViewer.module.css';

export interface StateDiff {
  url: { before: string; after: string; changed: boolean };
  localStorage: { added: string[]; removed: string[] };
  cookies: { added: string[]; removed: string[] };
}

export function StateDiffViewer({ diff }: { diff: StateDiff }): ReactElement {
  const noLocalStorage = diff.localStorage.added.length === 0 && diff.localStorage.removed.length === 0;
  const noCookies = diff.cookies.added.length === 0 && diff.cookies.removed.length === 0;
  return (
    <section className={s.diff} aria-label="State diff">
      <div className={s.head}>
        <span>state diff · before → after</span>
        {diff.url.changed ? <span className={s.changed}>url changed</span> : <span>url unchanged</span>}
      </div>

      <div className={s.row}>
        <div className={s.k}>url</div>
        <div className={s.v}>
          {diff.url.before === diff.url.after ? (
            <span>{diff.url.before}</span>
          ) : (
            <>
              <span className={s.removed}>{diff.url.before}</span>
              <br />
              <span className={s.added}>{diff.url.after}</span>
            </>
          )}
        </div>
      </div>

      <div className={s.row}>
        <div className={s.k}>localStorage</div>
        <div className={s.v}>
          {noLocalStorage ? (
            <span className={s.empty}>no changes</span>
          ) : (
            <>
              {diff.localStorage.removed.map((k) => (
                <div key={`r${k}`} className={s.removed}>
                  {k}
                </div>
              ))}
              {diff.localStorage.added.map((k) => (
                <div key={`a${k}`} className={s.added}>
                  {k}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className={s.row}>
        <div className={s.k}>cookies</div>
        <div className={s.v}>
          {noCookies ? (
            <span className={s.empty}>no changes</span>
          ) : (
            <>
              {diff.cookies.removed.map((k) => (
                <div key={`cr${k}`} className={s.removed}>
                  {k}
                </div>
              ))}
              {diff.cookies.added.map((k) => (
                <div key={`ca${k}`} className={s.added}>
                  {k}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
