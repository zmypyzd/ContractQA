import type { DomShape, DomElementSnapshot } from '@contractqa/core';

// Stream 5: Target shape mirrored from packages/core/src/schemas/contract.schema.ts.
// Kept structural-typed here rather than re-imported so the oracle stays free
// of the zod schema layer.
export interface DomTarget {
  role?: string;
  name_regex?: string;
  test_id?: string;
  text?: string;
  icon?: string;
  placeholder?: string;
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
  consistency?: Array<{
    left: ConsistencySignal;
    relation: 'eq' | 'lte' | 'gte' | 'lt' | 'gt';
    right: ConsistencySignal;
  }>;
  // Date constraints — catch MISSING temporal validation (a future-only event/wedding
  // date accepted in the past; an end before a start). `rule` compares the target's
  // date to NOW (relative); `before`/`after` compare it to another displayed date
  // (relational). The date is read from the element's value or visible text and parsed
  // permissively; unparseable → skipped (conservative, no false positive).
  date_constraint?: Array<{
    target: DomTarget;
    rule?: 'future' | 'past' | 'today_or_future' | 'today_or_past';
    after?: DomTarget; // target's date must be >= after's date (e.g. end >= start)
    before?: DomTarget; // target's date must be <= before's date
  }>;
}

// A consistency signal extracts ONE number from the observed DOM. Exactly one
// of count / number_in / sum_of is set.
export interface ConsistencySignal {
  count?: DomTarget;
  number_in?: DomTarget;
  sum_of?: DomTarget;
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
    if (target.placeholder && !(el.attributes['placeholder'] ?? '').includes(target.placeholder)) continue;
    if (target.text && !el.text.includes(target.text)) continue;
    matches.push(el);
  }
  if (matches.length === 0) return null;
  // `first: true` is the default semantically — there's no concept of "all"
  // for these new evaluators since they always assert on a single element.
  return matches[0] ?? null;
}

// All elements matching a DomTarget (consistency's count/sum_of need every match,
// not just the first). Mirrors matchElement's predicate.
function matchAllElements(target: DomTarget, elements: DomElementSnapshot[]): DomElementSnapshot[] {
  return elements.filter((el) => {
    if (target.role && el.role !== target.role) return false;
    if (target.name_regex && !new RegExp(target.name_regex, 'i').test(el.name)) return false;
    if (target.test_id && el.attributes['data-testid'] !== target.test_id) return false;
    if (target.placeholder && !(el.attributes['placeholder'] ?? '').includes(target.placeholder)) return false;
    if (target.text && !el.text.includes(target.text)) return false;
    return true;
  });
}

// First number in a string ("Showing 2 of 8" → 2; "$1,200.00" → 1200; "500 available" → 500).
function firstNumber(s: string): number | null {
  const m = (s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Resolve a ConsistencySignal to a number, or null if it can't be grounded
// (no matching element / no parseable number) → caller skips (conservative).
function evalSignal(sig: ConsistencySignal, els: DomElementSnapshot[]): { value: number | null; label: string } {
  if (sig.count) return { value: matchAllElements(sig.count, els).length, label: `count(${targetLabel(sig.count)})` };
  if (sig.number_in) {
    const el = matchElement(sig.number_in, els);
    return { value: el ? firstNumber(el.text) : null, label: `number_in(${targetLabel(sig.number_in)})` };
  }
  if (sig.sum_of) {
    const ms = matchAllElements(sig.sum_of, els);
    const nums = ms.map((e) => firstNumber(e.text)).filter((n): n is number => n != null);
    return { value: nums.length ? nums.reduce((a, b) => a + b, 0) : null, label: `sum_of(${targetLabel(sig.sum_of)})` };
  }
  return { value: null, label: '<empty signal>' };
}

// Parse a date from an element's value/text into epoch ms, or null if unparseable.
// Handles ISO ("2020-01-01"), locale-ish ("Jan 1, 2020", "January 1, 2020"), and
// date-input values. Conservative: a non-date string → null → caller skips.
function parseDateFrom(el: DomElementSnapshot): number | null {
  for (const raw of [el.value, el.text]) {
    const s = (raw ?? '').trim();
    if (!s) continue;
    // Require something date-shaped to avoid parsing bare numbers/prices as dates.
    if (!/\d{4}|\d{1,2}[/\-.]\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) continue;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function relationHolds(a: number, rel: string, b: number): boolean {
  switch (rel) {
    case 'eq': return a === b;
    case 'lte': return a <= b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'gt': return a > b;
    default: return false;
  }
}

function targetLabel(target: DomTarget): string {
  const parts: string[] = [];
  if (target.role) parts.push(`role=${target.role}`);
  if (target.name_regex) parts.push(`name=/${target.name_regex}/`);
  if (target.test_id) parts.push(`test_id=${target.test_id}`);
  if (target.placeholder) parts.push(`placeholder=${JSON.stringify(target.placeholder)}`);
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
    !!expected.element_text_equals ||
    !!expected.consistency ||
    !!expected.date_constraint;
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

  if (expected.consistency) {
    for (const c of expected.consistency) {
      const L = evalSignal(c.left, els);
      const R = evalSignal(c.right, els);
      const label = `${L.label} ${c.relation} ${R.label}`;
      // Conservative: if either signal can't be grounded, skip (no false positive).
      if (L.value === null || R.value === null) continue;
      if (relationHolds(L.value, c.relation, R.value)) {
        out.passContributions.push({ field: 'dom.consistency', detail: `${label} (${L.value} ${c.relation} ${R.value})` });
      } else {
        out.failContributions.push({
          field: 'dom.consistency',
          detail: `${label} VIOLATED: ${L.value} ${c.relation} ${R.value} is false`,
          actual: { left: L.value, right: R.value },
        });
      }
    }
  }

  if (expected.date_constraint) {
    const now = Date.now();
    for (const dc of expected.date_constraint) {
      const label = targetLabel(dc.target);
      const el = matchElement(dc.target, els);
      // No match → skip (conservative). A self-calibrating target like {text:"2020"}
      // deliberately won't match when the illegal date was rejected (correct app) — that
      // must NOT be a false-fail. (If the displayed date is simply not snapshot-captured,
      // skipping also avoids a spurious fail; capturing text nodes is a separate concern.)
      if (!el) continue;
      const d = parseDateFrom(el);
      if (d === null) continue; // unparseable → skip (conservative)
      if (dc.rule) {
        const ok =
          dc.rule === 'future' ? d > now :
          dc.rule === 'past' ? d < now :
          dc.rule === 'today_or_future' ? d >= now - 86_400_000 :
          /* today_or_past */ d <= now + 86_400_000;
        if (ok) out.passContributions.push({ field: 'dom.date_constraint', detail: `${label} is ${dc.rule}` });
        else out.failContributions.push({ field: 'dom.date_constraint', detail: `${label} expected ${dc.rule}`, actual: new Date(d).toISOString().slice(0, 10) });
      }
      for (const [other, rel] of [[dc.after, 'gte'], [dc.before, 'lte']] as const) {
        if (!other) continue;
        const oel = matchElement(other, els);
        const od = oel ? parseDateFrom(oel) : null;
        if (od === null) continue; // can't ground the comparator → skip
        const ok = rel === 'gte' ? d >= od : d <= od;
        const sym = rel === 'gte' ? '>=' : '<=';
        if (ok) out.passContributions.push({ field: 'dom.date_constraint', detail: `${label} ${sym} ${targetLabel(other)}` });
        else out.failContributions.push({ field: 'dom.date_constraint', detail: `${label} expected ${sym} ${targetLabel(other)}`, actual: { target: new Date(d).toISOString().slice(0, 10), other: new Date(od).toISOString().slice(0, 10) } });
      }
    }
  }

  return out;
}
