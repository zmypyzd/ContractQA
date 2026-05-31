import { describe, it, expect } from 'vitest';
import { classifyDom } from '../src/dom-classifier.js';
import type { DomShape } from '@contractqa/core';

const dom: DomShape = {
  roleCounts: { 'link:Login': 2, 'heading:WolfMind': 1 },
  visibleText: 'Welcome to WolfMind. Click Login to start.',
};

describe('classifyDom', () => {
  it('contains_text PASSes when every needle appears', () => {
    const r = classifyDom(dom, { contains_text: ['WolfMind', 'Login'] });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions.length).toBe(2);
  });

  it('contains_text FAILs the missing needles', () => {
    const r = classifyDom(dom, { contains_text: ['WolfMind', 'Logout'] });
    expect(r.failContributions.some((f) => f.detail.includes('Logout'))).toBe(true);
  });

  it('not_contains_text FAILs when a banned string appears', () => {
    const r = classifyDom(dom, { not_contains_text: ['Welcome'] });
    expect(r.failContributions[0]!.detail).toContain('Welcome');
  });

  it('role_count.eq PASSes on exact match', () => {
    const r = classifyDom(dom, { role_count: [{ role: 'link', name_regex: 'Login', eq: 2 }] });
    expect(r.failContributions).toEqual([]);
  });

  it('role_count.lte FAILs on over-count', () => {
    const r = classifyDom(dom, { role_count: [{ role: 'link', name_regex: 'Login', lte: 1 }] });
    expect(r.failContributions.length).toBeGreaterThan(0);
  });

  it('role_count.gte PASSes when at-least count is met', () => {
    const r = classifyDom(dom, { role_count: [{ role: 'link', name_regex: 'Login', gte: 2 }] });
    expect(r.failContributions).toEqual([]);
  });
});

describe('classifyDom — Stream 5 rich assertions', () => {
  const domWithElements: DomShape = {
    roleCounts: { 'button:All-in': 1, 'textbox:seed': 1, 'button:Tab Featured': 1 },
    visibleText: 'All-in seed Featured',
    elements: [
      {
        role: 'button',
        name: 'All-in',
        attributes: { disabled: '', class: 'btn primary', 'aria-pressed': 'false' },
        classes: ['btn', 'primary'],
        text: 'All-in',
      },
      {
        role: 'textbox',
        name: 'seed',
        attributes: { name: 'seed', type: 'text', 'data-testid': 'seed-input' },
        value: 'abc123',
        classes: ['input'],
        text: '',
      },
      {
        role: 'button',
        name: 'Tab Featured',
        attributes: { 'aria-selected': 'true', 'data-testid': 'tab-featured', class: 'tab active' },
        classes: ['tab', 'active'],
        text: 'Featured',
      },
    ],
  };

  it('attribute_equals: boolean true PASSes when attr is present', () => {
    const r = classifyDom(domWithElements, {
      attribute_equals: [{ target: { role: 'button', name_regex: 'All-?in' }, attribute: 'disabled', equals: true }],
    });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions.length).toBe(1);
  });

  it('attribute_equals: boolean false PASSes when attr is absent', () => {
    const r = classifyDom(domWithElements, {
      attribute_equals: [{ target: { test_id: 'seed-input' }, attribute: 'disabled', equals: false }],
    });
    expect(r.failContributions).toEqual([]);
  });

  it('attribute_equals: string equals matches exact attr value', () => {
    const r = classifyDom(domWithElements, {
      attribute_equals: [{ target: { test_id: 'tab-featured' }, attribute: 'aria-selected', equals: 'true' }],
    });
    expect(r.failContributions).toEqual([]);
  });

  it('attribute_equals: mismatch FAILs with actual', () => {
    const r = classifyDom(domWithElements, {
      attribute_equals: [{ target: { test_id: 'tab-featured' }, attribute: 'aria-selected', equals: 'false' }],
    });
    expect(r.failContributions[0]?.actual).toBe('true');
  });

  it('attribute_equals: no element matched → FAIL with null actual', () => {
    const r = classifyDom(domWithElements, {
      attribute_equals: [{ target: { test_id: 'does-not-exist' }, attribute: 'disabled', equals: true }],
    });
    expect(r.failContributions[0]?.actual).toBe(null);
    expect(r.failContributions[0]?.detail).toContain('no element matched');
  });

  it('input_value.equals PASSes', () => {
    const r = classifyDom(domWithElements, {
      input_value: [{ target: { test_id: 'seed-input' }, equals: 'abc123' }],
    });
    expect(r.failContributions).toEqual([]);
  });

  it('input_value.matches (regex) PASSes', () => {
    const r = classifyDom(domWithElements, {
      input_value: [{ target: { test_id: 'seed-input' }, matches: '^abc\\d+$' }],
    });
    expect(r.failContributions).toEqual([]);
  });

  it('input_value mismatch FAILs', () => {
    const r = classifyDom(domWithElements, {
      input_value: [{ target: { test_id: 'seed-input' }, equals: 'wrong' }],
    });
    expect(r.failContributions[0]?.actual).toBe('abc123');
  });

  it('class_contains PASSes on tokenized class match', () => {
    const r = classifyDom(domWithElements, {
      class_contains: [{ target: { test_id: 'tab-featured' }, class: 'active' }],
    });
    expect(r.failContributions).toEqual([]);
  });

  it('class_contains FAILs with class list as actual', () => {
    const r = classifyDom(domWithElements, {
      class_contains: [{ target: { test_id: 'tab-featured' }, class: 'inactive' }],
    });
    expect(r.failContributions[0]?.actual).toEqual(['tab', 'active']);
  });

  it('element_text_equals PASSes on exact text match', () => {
    const r = classifyDom(domWithElements, {
      element_text_equals: [{ target: { test_id: 'tab-featured' }, equals: 'Featured' }],
    });
    expect(r.failContributions).toEqual([]);
  });

  it('element_text_equals FAILs with actual text', () => {
    const r = classifyDom(domWithElements, {
      element_text_equals: [{ target: { test_id: 'tab-featured' }, equals: 'Wrong' }],
    });
    expect(r.failContributions[0]?.actual).toBe('Featured');
  });

  it('rich assertion against snapshot missing elements → single clear failure', () => {
    const oldStyleDom: DomShape = {
      roleCounts: { 'button:Submit': 1 },
      visibleText: 'Submit',
      // intentionally no elements field — pre-Stream-5 snapshot
    };
    const r = classifyDom(oldStyleDom, {
      attribute_equals: [{ target: { role: 'button' }, attribute: 'disabled', equals: true }],
    });
    expect(r.failContributions[0]?.field).toBe('dom.elements');
    expect(r.failContributions[0]?.detail).toContain('predates Stream 5');
  });
});

describe('classifyDom consistency (cross-signal relations)', () => {
  const els = [
    { role: 'heading', name: 'Showing 2 of 8 venues', text: 'Showing 2 of 8 venues', attributes: {}, classes: [], value: undefined },
    { role: 'article', name: 'A', text: 'A', attributes: {}, classes: [], value: undefined },
    { role: 'article', name: 'B', text: 'B', attributes: {}, classes: [], value: undefined },
    { role: 'article', name: 'C', text: 'C', attributes: {}, classes: [], value: undefined },
  ];
  const domE = (e = els): DomShape => ({ roleCounts: {}, visibleText: '', elements: e });

  it('FAILs when displayed count != rendered count (2 != 3)', () => {
    const r = classifyDom(domE(), { consistency: [{ left: { number_in: { text: 'Showing' } }, relation: 'eq', right: { count: { role: 'article' } } }] });
    expect(r.failContributions.some((f) => f.field === 'dom.consistency' && /2 eq 3/.test(f.detail))).toBe(true);
  });

  it('PASSes when displayed count == rendered count', () => {
    const e2 = els.map((x) => (x.role === 'heading' ? { ...x, text: 'Showing 3 of 8 venues', name: 'Showing 3 of 8 venues' } : x));
    const r = classifyDom(domE(e2), { consistency: [{ left: { number_in: { text: 'Showing' } }, relation: 'eq', right: { count: { role: 'article' } } }] });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions.some((p) => p.field === 'dom.consistency')).toBe(true);
  });

  it('SKIPs (no fail, no pass) when a signal cannot be grounded — conservative, no false positive', () => {
    const r = classifyDom(domE(), { consistency: [{ left: { number_in: { text: 'Nonexistent' } }, relation: 'eq', right: { count: { role: 'article' } } }] });
    expect(r.failContributions.filter((f) => f.field === 'dom.consistency')).toEqual([]);
    expect(r.passContributions.filter((p) => p.field === 'dom.consistency')).toEqual([]);
  });

  it('sum_of: total == sum of item numbers', () => {
    const e = [
      { role: 'heading', name: 'Total 60', text: 'Total 60', attributes: {}, classes: [], value: undefined },
      { role: 'listitem', name: 'i1', text: '$20', attributes: {}, classes: [], value: undefined },
      { role: 'listitem', name: 'i2', text: '$40', attributes: {}, classes: [], value: undefined },
    ];
    const r = classifyDom(domE(e), { consistency: [{ left: { number_in: { text: 'Total' } }, relation: 'eq', right: { sum_of: { role: 'listitem' } } }] });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions.some((p) => p.field === 'dom.consistency')).toBe(true);
  });
});

describe('classifyDom — date_constraint', () => {
  const domWithDate = (text: string, value?: string): DomShape => ({
    roleCounts: {},
    visibleText: text,
    elements: [{ role: 'text', name: 'Wedding Date', attributes: {}, classes: [], text, ...(value !== undefined ? { value } : {}) }],
  });

  it('rule:future FAILs on a past date (catches accepted past date)', () => {
    const r = classifyDom(domWithDate('Jan 1, 2020'), { date_constraint: [{ target: { text: 'Jan 1, 2020' }, rule: 'future' }] });
    expect(r.failContributions.some((f) => f.field === 'dom.date_constraint')).toBe(true);
  });

  it('rule:future PASSes on a clearly-future date', () => {
    const r = classifyDom(domWithDate('Jan 1, 2099'), { date_constraint: [{ target: { text: 'Jan 1, 2099' }, rule: 'future' }] });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions.some((p) => p.field === 'dom.date_constraint')).toBe(true);
  });

  it('unparseable target → skipped (no false positive)', () => {
    const r = classifyDom(domWithDate('not a date'), { date_constraint: [{ target: { text: 'not a date' }, rule: 'future' }] });
    expect(r.failContributions).toEqual([]);
    expect(r.passContributions).toEqual([]);
  });

  it('relational after: end before start FAILs', () => {
    const dom: DomShape = {
      roleCounts: {}, visibleText: 'start end',
      elements: [
        { role: 'text', name: 'start', attributes: {}, classes: [], text: '2025-06-01' },
        { role: 'text', name: 'end', attributes: {}, classes: [], text: '2020-01-01' },
      ],
    };
    const r = classifyDom(dom, { date_constraint: [{ target: { name_regex: '^end$' }, after: { name_regex: '^start$' } }] });
    expect(r.failContributions.some((f) => f.field === 'dom.date_constraint')).toBe(true);
  });
});
