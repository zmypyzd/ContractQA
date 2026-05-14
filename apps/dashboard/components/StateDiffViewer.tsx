import type { ReactElement } from 'react';

export interface StateDiff {
  url: { before: string; after: string; changed: boolean };
  localStorage: { added: string[]; removed: string[] };
  cookies: { added: string[]; removed: string[] };
}

export function StateDiffViewer({ diff }: { diff: StateDiff }): ReactElement {
  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>State Diff</h3>
      <table>
        <tbody>
          <tr>
            <th>url</th>
            <td>{diff.url.before}</td>
            <td>→</td>
            <td>{diff.url.after}</td>
          </tr>
        </tbody>
      </table>
      <h4>localStorage</h4>
      <ul>
        {diff.localStorage.added.map((k) => (
          <li key={`a${k}`}>+ {k}</li>
        ))}
      </ul>
      <ul>
        {diff.localStorage.removed.map((k) => (
          <li key={`r${k}`}>− {k}</li>
        ))}
      </ul>
      <h4>cookies</h4>
      <ul>
        {diff.cookies.added.map((k) => (
          <li key={`ca${k}`}>+ {k}</li>
        ))}
      </ul>
      <ul>
        {diff.cookies.removed.map((k) => (
          <li key={`cr${k}`}>− {k}</li>
        ))}
      </ul>
    </section>
  );
}
