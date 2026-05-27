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
