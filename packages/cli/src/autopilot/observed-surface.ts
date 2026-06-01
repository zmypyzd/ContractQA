import type { DomShape, DomElementSnapshot } from '@contractqa/core';

// Roles a contract can actually drive a locator to (click/fill/check). Non-
// interactive roles (text / heading / img / generic) are excluded from the
// per-element listing — they only add tokens and tempt the generator to write
// locators it can't act on. Their COUNTS still surface via the role-count line
// so role assumptions (e.g. "cards are role=article") can be grounded.
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'spinbutton',
  'switch',
  'slider',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
]);

// Bound the role-count summary so a large page can't flood the generation
// prompt. 20 highest-count roles is ample to ground role assumptions.
const ROLE_COUNT_CAP = 20;

// Pre-formatted lines describing the REAL interactive elements on a live page,
// fed into generation as `observedSurface` so the agent grounds locators in
// observed reality (real role / accessible name / placeholder / test-id / href)
// instead of inventing names that don't resolve. Observes STRUCTURE only.
export function formatObservedSurface(dom: DomShape): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const el of dom.elements ?? []) {
    if (!INTERACTIVE_ROLES.has(el.role)) continue;
    const line = formatElement(el);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }

  const counts = Object.entries(dom.roleCounts ?? {});
  if (counts.length > 0) {
    const summary = counts
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, ROLE_COUNT_CAP)
      .map(([role, n]) => `${role}=${n}`)
      .join(', ');
    out.push(`(role counts: ${summary})`);
  }

  return out;
}

function formatElement(el: DomElementSnapshot): string | null {
  const attrs = el.attributes ?? {};
  const parts: string[] = [el.role];
  if (el.name) parts.push(`"${el.name}"`);
  if (attrs.placeholder) parts.push(`placeholder="${attrs.placeholder}"`);
  const testid = attrs['data-testid'] ?? attrs['data-test-id'];
  if (testid) parts.push(`testid="${testid}"`);
  if (attrs.type) parts.push(`type=${attrs.type}`);
  if (attrs.href) parts.push(`href="${attrs.href}"`);
  // A line with only the bare role (no name and no grounding handle) is useless
  // to the generator — drop it.
  if (parts.length === 1) return null;
  return parts.join(' ');
}
