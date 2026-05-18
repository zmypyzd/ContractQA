/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StateDiffViewer } from '../components/StateDiffViewer.js';

describe('StateDiffViewer', () => {
  it('renders before/after url and grouped localStorage adds/removes', () => {
    render(
      <StateDiffViewer
        diff={{
          url: { before: '/lobby', after: '/agents', changed: true },
          localStorage: { added: ['posthog-id'], removed: ['theme'] },
          cookies: { added: [], removed: ['app_sid'] },
        }}
      />,
    );
    // `url` appears in both the head ("url changed") and the row label.
    // Match the row label exactly so the test doesn't break when the head
    // copy is reworded.
    expect(screen.getByText('url', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('/lobby')).toBeTruthy();
    expect(screen.getByText('/agents')).toBeTruthy();
    expect(screen.getByText(/posthog-id/)).toBeTruthy();
    expect(screen.getByText(/app_sid/)).toBeTruthy();
  });
});
