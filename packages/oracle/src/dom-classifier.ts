import type { DomShape } from '@contractqa/core';

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
