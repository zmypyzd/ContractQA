// packages/cli/tests/autopilot/observed-surface.test.ts
import { describe, it, expect } from 'vitest';
import type { DomShape } from '@contractqa/core';
import { formatObservedSurface } from '../../src/autopilot/observed-surface.js';

const dom = (over: Partial<DomShape>): DomShape => ({
  roleCounts: {},
  visibleText: '',
  elements: [],
  ...over,
});

describe('formatObservedSurface', () => {
  it('formats a button by role + accessible name', () => {
    const lines = formatObservedSurface(
      dom({ elements: [{ role: 'button', name: 'Get Started', attributes: {}, classes: [], text: 'Get Started' }] }),
    );
    expect(lines).toContain('button "Get Started"');
  });

  it('includes placeholder and type for a named textbox', () => {
    const lines = formatObservedSurface(
      dom({
        elements: [
          { role: 'textbox', name: 'Partner One', attributes: { placeholder: 'e.g. Jordan', type: 'text' }, classes: [], text: '' },
        ],
      }),
    );
    expect(lines).toContain('textbox "Partner One" placeholder="e.g. Jordan" type=text');
  });

  it('surfaces a name-less input by its placeholder so it is still groundable', () => {
    const lines = formatObservedSurface(
      dom({ elements: [{ role: 'textbox', name: '', attributes: { placeholder: 'Partner One' }, classes: [], text: '' }] }),
    );
    expect(lines).toContain('textbox placeholder="Partner One"');
  });

  it('includes data-testid and href when present', () => {
    const lines = formatObservedSurface(
      dom({
        elements: [
          { role: 'link', name: 'Venues', attributes: { href: '/venues', 'data-testid': 'nav-venues' }, classes: [], text: 'Venues' },
        ],
      }),
    );
    expect(lines).toContain('link "Venues" testid="nav-venues" href="/venues"');
  });

  it('excludes non-interactive roles (text / heading / img) from per-element lines', () => {
    const lines = formatObservedSurface(
      dom({
        elements: [
          { role: 'text', name: '', attributes: {}, classes: [], text: 'Jan 1 2020' },
          { role: 'heading', name: 'Dashboard', attributes: {}, classes: [], text: 'Dashboard' },
          { role: 'img', name: 'photo', attributes: {}, classes: [], text: '' },
          { role: 'button', name: 'Save', attributes: {}, classes: [], text: 'Save' },
        ],
      }),
    );
    expect(lines.some((l) => l.startsWith('text'))).toBe(false);
    expect(lines.some((l) => l.startsWith('heading'))).toBe(false);
    expect(lines.some((l) => l.startsWith('img'))).toBe(false);
    expect(lines).toContain('button "Save"');
  });

  it('appends a role-count summary so role assumptions (cards != article) can be grounded', () => {
    const lines = formatObservedSurface(
      dom({ roleCounts: { article: 0, listitem: 8, button: 12 }, elements: [] }),
    );
    expect(lines.some((l) => l.includes('role counts:') && l.includes('listitem=8') && l.includes('article=0'))).toBe(true);
  });

  it('caps the role-count summary to the top 20 entries by count (bounds prompt tokens on large pages)', () => {
    const roleCounts: Record<string, number> = {};
    for (let i = 0; i < 30; i++) roleCounts[`role${i}`] = 30 - i;
    const lines = formatObservedSurface(dom({ roleCounts }));
    const summary = lines.find((l) => l.startsWith('(role counts:'))!;
    expect((summary.match(/=/g) ?? []).length).toBe(20);
    // Highest-count entries are kept, lowest dropped.
    expect(summary).toContain('role0=30');
    expect(summary).not.toContain('role29=1');
  });

  it('dedups identical element lines', () => {
    const el = { role: 'button', name: 'Edit', attributes: {}, classes: [], text: 'Edit' };
    const lines = formatObservedSurface(dom({ elements: [el, { ...el }] }));
    expect(lines.filter((l) => l === 'button "Edit"')).toHaveLength(1);
  });
});
