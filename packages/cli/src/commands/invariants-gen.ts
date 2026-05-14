import type { ContractDoc } from '@contractqa/core';

const TITLES: Record<string, string> = {
  auth: 'Auth',
  lobby: 'Lobby',
  billing: 'Billing',
  admin: 'Admin',
  routes: 'Routes',
};

export function renderInvariantsMd(contracts: ContractDoc[]): string {
  const byArea = new Map<string, ContractDoc[]>();
  for (const c of contracts) {
    if (!byArea.has(c.area)) byArea.set(c.area, []);
    byArea.get(c.area)!.push(c);
  }
  const out: string[] = [
    '# Product Invariants',
    '',
    '> Generated from `qa/contracts/*.yml`. Do not edit by hand.',
    '',
  ];
  for (const [area, list] of [...byArea.entries()].sort()) {
    out.push(`## ${TITLES[area] ?? area}`, '');
    for (const c of list.sort((a, b) => a.id.localeCompare(b.id))) {
      out.push(`- ${c.id}: ${c.title}`);
    }
    out.push('');
  }
  return out.join('\n');
}
