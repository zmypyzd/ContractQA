// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { collectDomShape } from '../src/browser-snapshot.js';

// collectDomShape runs in the page context in production (serialized via
// page.evaluate). Here we drive it directly against a jsdom document — the
// same code path, minus a real browser — to lock down the interactive and
// text-bearing passes without spinning up Playwright.

function setBody(html: string): void {
  document.body.innerHTML = html;
}

const BUDGET = 500;

describe('collectDomShape — interactive pass (unchanged behavior)', () => {
  beforeEach(() => setBody(''));

  it('captures roled/interactive elements with role + attributes + value', () => {
    setBody(`
      <button disabled class="btn primary" aria-pressed="false">All-in</button>
      <input name="seed" type="text" value="abc123" class="input" />
      <a href="/lobby">Lobby</a>
    `);
    const shape = collectDomShape(BUDGET);
    const button = shape.elements.find((e) => e.role === 'button');
    const textbox = shape.elements.find((e) => e.role === 'textbox');
    const link = shape.elements.find((e) => e.role === 'link');

    expect(button).toBeTruthy();
    expect(button?.name).toBe('All-in');
    expect(button?.attributes.disabled).toBe('');
    expect(button?.classes).toEqual(['btn', 'primary']);

    expect(textbox?.attributes.name).toBe('seed');
    expect(textbox?.value).toBe('abc123');

    expect(link?.role).toBe('link');
    // roleCounts still tracks interactive roles.
    expect(shape.roleCounts['button:All-in']).toBe(1);
  });

  it('maps h1-h6 to role heading (h4-h6 were previously dropped)', () => {
    setBody(`<h1>A</h1><h3>B</h3><h5>Deep</h5><h6>Deeper</h6>`);
    const headings = collectDomShape(BUDGET).elements.filter((e) => e.role === 'heading');
    const texts = headings.map((h) => h.text).sort();
    expect(texts).toEqual(['A', 'B', 'Deep', 'Deeper']);
  });
});

describe('collectDomShape — accessible name (ARIA fallback chain)', () => {
  beforeEach(() => setBody(''));

  it('uses placeholder as the accessible name for a label-less input', () => {
    setBody(`<input type="text" placeholder="Search vendors..." />`);
    const tb = collectDomShape(BUDGET).elements.find((e) => e.role === 'textbox');
    expect(tb?.name).toBe('Search vendors...');
  });

  it('prefers an associated <label> over placeholder', () => {
    setBody(`<label for="p1">Partner One</label><input id="p1" type="text" placeholder="Name" />`);
    const tb = collectDomShape(BUDGET).elements.find((e) => e.role === 'textbox');
    expect(tb?.name).toBe('Partner One');
  });

  it('prefers aria-label over label and placeholder', () => {
    setBody(`<label for="b">Budget label</label><input id="b" aria-label="Wedding budget" placeholder="$" />`);
    const tb = collectDomShape(BUDGET).elements.find((e) => e.role === 'textbox');
    expect(tb?.name).toBe('Wedding budget');
  });

  it('resolves aria-labelledby to the referenced element text', () => {
    setBody(`<span id="lbl">Guest count</span><input aria-labelledby="lbl" type="number" />`);
    const tb = collectDomShape(BUDGET).elements.find((e) => e.role === 'textbox');
    expect(tb?.name).toBe('Guest count');
  });

  it('still uses textContent for buttons/links (unchanged)', () => {
    setBody(`<button>Save</button><input placeholder="Name" />`);
    const els = collectDomShape(BUDGET).elements;
    expect(els.find((e) => e.role === 'button')?.name).toBe('Save');
    expect(els.find((e) => e.role === 'textbox')?.name).toBe('Name');
  });
});

describe('collectDomShape — text-bearing pass', () => {
  beforeEach(() => setBody(''));

  it('captures a plain-text date in a <p> as a role:text element', () => {
    setBody(`<p>Wedding date: 2020-01-01</p>`);
    const shape = collectDomShape(BUDGET);
    const textEl = shape.elements.find((e) => e.role === 'text');
    expect(textEl).toBeTruthy();
    expect(textEl?.text).toContain('2020-01-01');
    // Text elements do NOT pollute roleCounts.
    expect(Object.keys(shape.roleCounts).some((k) => k.startsWith('text:'))).toBe(false);
  });

  it('captures a <span> and <time> date, locatable by text', () => {
    setBody(`<span>Jan 1, 2020</span><time datetime="2020-01-01">2020-01-01</time>`);
    const shape = collectDomShape(BUDGET);
    const byText = shape.elements.filter((e) => e.text.includes('2020'));
    expect(byText.length).toBeGreaterThanOrEqual(2);
    expect(byText.every((e) => e.role === 'text')).toBe(true);
  });

  it('captures only the LEAF when text is nested (no duplicate snapshots)', () => {
    setBody(`<p>Date: <span>2020-01-01</span></p>`);
    const shape = collectDomShape(BUDGET);
    const textEls = shape.elements.filter((e) => e.role === 'text');
    // The <p> wraps a child element → skipped; only the leaf <span> captured.
    expect(textEls).toHaveLength(1);
    expect(textEls[0]?.text).toBe('2020-01-01');
  });

  it('skips empty text-bearing elements', () => {
    setBody(`<p></p><span>   </span><li>real</li>`);
    const textEls = collectDomShape(BUDGET).elements.filter((e) => e.role === 'text');
    expect(textEls).toHaveLength(1);
    expect(textEls[0]?.text).toBe('real');
  });

  it('skips text inside links/buttons (already captured as the control text)', () => {
    setBody(`<button><span>Pay 2020 now</span></button><a href="/x"><span>2020 link</span></a>`);
    const shape = collectDomShape(BUDGET);
    const textEls = shape.elements.filter((e) => e.role === 'text');
    expect(textEls).toHaveLength(0);
    // The control text is still present on the interactive elements.
    expect(shape.elements.some((e) => e.role === 'button' && e.text.includes('2020'))).toBe(true);
  });

  it('skips visually hidden text (inline display:none / [hidden] / aria-hidden)', () => {
    setBody(`
      <p style="display:none">2020 hidden-style</p>
      <p hidden>2020 hidden-attr</p>
      <div aria-hidden="true"><p>2020 aria-hidden</p></div>
      <p>2020 visible</p>
    `);
    const textEls = collectDomShape(BUDGET).elements.filter((e) => e.role === 'text');
    expect(textEls).toHaveLength(1);
    expect(textEls[0]?.text).toBe('2020 visible');
  });

  it('captures a role-less [data-testid] text node exactly once, preserving the testid', () => {
    // A <span data-testid> resolves to no implied role in pass 1 (dropped), so
    // pass 2 picks it up as role:text — and focusedAttrs keeps data-testid, so
    // test_id targeting still works. It must appear exactly once.
    setBody(`<span data-testid="amount">2020</span>`);
    const matches = collectDomShape(BUDGET).elements.filter((e) => e.text === '2020');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.attributes['data-testid']).toBe('amount');
  });

  it('does not re-capture an element already taken by the interactive pass', () => {
    // <button> is captured in pass 1 and added to `seen`; its own tag isn't in
    // the text selector, but this guards the dedup contract explicitly.
    setBody(`<button data-testid="b">2020</button>`);
    const matches = collectDomShape(BUDGET).elements.filter((e) => e.text === '2020');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.role).toBe('button');
  });
});
