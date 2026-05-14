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
