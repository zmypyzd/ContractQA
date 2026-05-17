import s from './EvidenceLinks.module.css';

export interface IssueEvidence {
  trace?: string;
  state_diff?: string;
  repro?: string;
  screenshot?: string;
  video?: string;
}

const LABELS: Record<keyof IssueEvidence, string> = {
  trace: 'trace.har',
  state_diff: 'state-diff.json',
  repro: 'repro.spec.ts',
  screenshot: 'screenshot.png',
  video: 'video.mp4',
};

export function EvidenceLinks({
  evidence,
  basePath,
}: {
  evidence: IssueEvidence;
  basePath: string;
}) {
  const entries = Object.entries(evidence).filter(([, v]) => !!v) as Array<
    [keyof IssueEvidence, string]
  >;

  if (entries.length === 0) {
    return null;
  }

  return (
    <ul className={s.wrap}>
      {entries.map(([k, v]) => (
        <li key={k} className={s.item}>
          <a
            className={s.link}
            href={`${basePath}/${v}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className={s.label}>{k.replace(/_/g, '-')}</span>
            <span className={s.value}>{LABELS[k] ?? v}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
