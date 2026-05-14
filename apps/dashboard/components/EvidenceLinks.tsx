export interface IssueEvidence {
  trace?: string;
  state_diff?: string;
  repro?: string;
  screenshot?: string;
  video?: string;
}

export function EvidenceLinks({
  evidence,
  basePath,
}: {
  evidence: IssueEvidence;
  basePath: string;
}) {
  const entries = Object.entries(evidence).filter(([, v]) => !!v) as Array<[string, string]>;
  return (
    <ul>
      {entries.map(([k, v]) => (
        <li key={k}>
          <a href={`${basePath}/${v}`} target="_blank" rel="noreferrer">
            {k}
          </a>
        </li>
      ))}
    </ul>
  );
}
