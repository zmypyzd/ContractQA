import type { DomShape, DomElementSnapshot } from '@contractqa/core';

// Stream 5: Target shape mirrored from packages/core/src/schemas/contract.schema.ts.
// Kept structural-typed here rather than re-imported so the oracle stays free
// of the zod schema layer.
export interface DomTarget {
  role?: string;
  name_regex?: string;
  test_id?: string;
  text?: string;
  first?: boolean;
  within?: string;
}

export interface DomExpected {
  contains_text?: string[];
  not_contains_text?: string[];
  role_count?: Array<{
    role: string;
    name_regex?: string;
    eq?: number;
    gte?: number;
    lte?: number;
  }>;
  // Stream 5 rich assertions — all locate elements via DomTarget.
  attribute_equals?: Array<{
    target: DomTarget;
    attribute: string;
    equals: string | boolean;
  }>;
  input_value?: Array<{
    target: DomTarget;
    equals?: string;
    matches?: string;
  }>;
  class_contains?: Array<{
    target: DomTarget;
    class: string;
  }>;
  element_text_equals?: Array<{
    target: DomTarget;
    equals: string;
  }>;
}

// Find the first DomElementSnapshot matching a DomTarget. Returns null on
// no match. `within` is intentionally NOT yet implemented (would require
// per-element ancestor data in the snapshot) — contracts that use within
// will get a "no element matched" failure for now; tracked as a known gap
// in docs/stream5-dom-rich-assertions.md.
function matchElement(target: DomTarget, elements: DomElementSnapshot[]): DomElementSnapshot | null {
  const matches: DomElementSnapshot[] = [];
  for (const el of elements) {
    if (target.role && el.role !== target.role) continue;
    if (target.name_regex && !new RegExp(target.name_regex, 'i').test(el.name)) continue;
    if (target.test_id) {
      const testId = el.attributes['data-testid'];
      if (testId !== target.test_id) continue;
    }
    if (target.text && !el.text.includes(target.text)) continue;
    matches.push(el);
  }
  if (matches.length === 0) return null;
  // `first: true` is the default semantically — there's no concept of "all"
  // for these new evaluators since they always assert on a single element.
  return matches[0] ?? null;
}

function targetLabel(target: DomTarget): string {
  const parts: string[] = [];
  if (target.role) parts.push(`role=${target.role}`);
  if (target.name_regex) parts.push(`name=/${target.name_regex}/`);
  if (target.test_id) parts.push(`test_id=${target.test_id}`);
  if (target.text) parts.push(`text=${JSON.stringify(target.text)}`);
  if (target.within) parts.push(`within=${target.within}`);
  return parts.join(' ') || '<unspecified target>';
}

export interface DomClassification {
  passContributions: Array<{ field: string; detail: string }>;
  failContributions: Array<{ field: string; detail: string; actual: unknown }>;
}

export function classifyDom(dom: DomShape, expected: DomExpected): DomClassification {
  const out: DomClassification = { passContributions: [], failContributions: [] };

  if (expected.contains_text) {
    for (const needle of expected.contains_text) {
      if (dom.visibleText.includes(needle)) {
        out.passContributions.push({
          field: 'dom.contains_text',
          detail: `contains "${needle}"`,
        });
      } else {
        out.failContributions.push({
          field: 'dom.contains_text',
          detail: `missing expected text "${needle}"`,
          actual: dom.visibleText.slice(0, 200),
        });
      }
    }
  }

  if (expected.not_contains_text) {
    for (const banned of expected.not_contains_text) {
      if (dom.visibleText.includes(banned)) {
        out.failContributions.push({
          field: 'dom.not_contains_text',
          detail: `unexpectedly contains "${banned}"`,
          actual: banned,
        });
      }
    }
  }

  // Stream 5 rich evaluators. All require dom.elements; if it's missing
  // (snapshot predates Stream 5), surface a single, clear failure rather
  // than degrading silently.
  const needsElements =
    !!expected.attribute_equals ||
    !!expected.input_value ||
    !!expected.class_contains ||
    !!expected.element_text_equals;
  if (needsElements && !dom.elements) {
    out.failContributions.push({
      field: 'dom.elements',
      detail:
        'rich dom assertion declared but snapshot has no DomShape.elements ' +
        '(probe predates Stream 5 or captureDom: false). Rebuild probe + ' +
        'rerun snapshot, or remove the assertion.',
      actual: null,
    });
  }

  const els = dom.elements ?? [];

  if (expected.attribute_equals) {
    for (const a of expected.attribute_equals) {
      const el = matchElement(a.target, els);
      const label = `${targetLabel(a.target)} attr=${a.attribute}`;
      if (!el) {
        out.failContributions.push({
          field: 'dom.attribute_equals',
          detail: `${label} — no element matched target`,
          actual: null,
        });
        continue;
      }
      const got = el.attributes[a.attribute.toLowerCase()];
      // Boolean equals semantics: true means the attribute is present at all
      // (HTML boolean attrs like `disabled` use `disabled=""`); false means
      // absent. String equals semantics: exact string match.
      const pass =
        typeof a.equals === 'boolean'
          ? a.equals
            ? got !== undefined
            : got === undefined
          : got === a.equals;
      if (pass) {
        out.passContributions.push({
          field: 'dom.attribute_equals',
          detail: `${label} = ${JSON.stringify(a.equals)}`,
        });
      } else {
        out.failContributions.push({
          field: 'dom.attribute_equals',
          detail: `${label} expected ${JSON.stringify(a.equals)}`,
          actual: got ?? null,
        });
      }
    }
  }

  if (expected.input_value) {
    for (const iv of expected.input_value) {
      const el = matchElement(iv.target, els);
      const label = targetLabel(iv.target);
      if (!el) {
        out.failContributions.push({
          field: 'dom.input_value',
          detail: `${label} — no element matched target`,
          actual: null,
        });
        continue;
      }
      const got = el.value ?? '';
      if (iv.equals !== undefined) {
        if (got === iv.equals) {
          out.passContributions.push({
            field: 'dom.input_value',
            detail: `${label} value = ${JSON.stringify(iv.equals)}`,
          });
        } else {
          out.failContributions.push({
            field: 'dom.input_value',
            detail: `${label} expected value = ${JSON.stringify(iv.equals)}`,
            actual: got,
          });
        }
      } else if (iv.matches !== undefined) {
        if (new RegExp(iv.matches).test(got)) {
          out.passContributions.push({
            field: 'dom.input_value',
            detail: `${label} value matches /${iv.matches}/`,
          });
        } else {
          out.failContributions.push({
            field: 'dom.input_value',
            detail: `${label} expected value to match /${iv.matches}/`,
            actual: got,
          });
        }
      }
    }
  }

  if (expected.class_contains) {
    for (const cc of expected.class_contains) {
      const el = matchElement(cc.target, els);
      const label = `${targetLabel(cc.target)} class=${cc.class}`;
      if (!el) {
        out.failContributions.push({
          field: 'dom.class_contains',
          detail: `${label} — no element matched target`,
          actual: null,
        });
        continue;
      }
      if (el.classes.includes(cc.class)) {
        out.passContributions.push({
          field: 'dom.class_contains',
          detail: label,
        });
      } else {
        out.failContributions.push({
          field: 'dom.class_contains',
          detail: `${label} not present`,
          actual: el.classes,
        });
      }
    }
  }

  if (expected.element_text_equals) {
    for (const et of expected.element_text_equals) {
      const el = matchElement(et.target, els);
      const label = `${targetLabel(et.target)} text`;
      if (!el) {
        out.failContributions.push({
          field: 'dom.element_text_equals',
          detail: `${label} — no element matched target`,
          actual: null,
        });
        continue;
      }
      if (el.text === et.equals) {
        out.passContributions.push({
          field: 'dom.element_text_equals',
          detail: `${label} = ${JSON.stringify(et.equals)}`,
        });
      } else {
        out.failContributions.push({
          field: 'dom.element_text_equals',
          detail: `${label} expected ${JSON.stringify(et.equals)}`,
          actual: el.text,
        });
      }
    }
  }

  if (expected.role_count) {
    for (const rc of expected.role_count) {
      let total = 0;
      for (const [key, count] of Object.entries(dom.roleCounts)) {
        const [role, ...rest] = key.split(':');
        const name = rest.join(':');
        if (role !== rc.role) continue;
        if (rc.name_regex && !new RegExp(rc.name_regex).test(name)) continue;
        total += count;
      }
      const label = `role=${rc.role}${rc.name_regex ? ` name=/${rc.name_regex}/` : ''}`;
      if (rc.eq !== undefined && total !== rc.eq) {
        out.failContributions.push({
          field: 'dom.role_count',
          detail: `${label} expected ==${rc.eq}`,
          actual: total,
        });
      } else if (rc.gte !== undefined && total < rc.gte) {
        out.failContributions.push({
          field: 'dom.role_count',
          detail: `${label} expected >=${rc.gte}`,
          actual: total,
        });
      } else if (rc.lte !== undefined && total > rc.lte) {
        out.failContributions.push({
          field: 'dom.role_count',
          detail: `${label} expected <=${rc.lte}`,
          actual: total,
        });
      } else {
        out.passContributions.push({
          field: 'dom.role_count',
          detail: `${label} = ${total}`,
        });
      }
    }
  }

  return out;
}
