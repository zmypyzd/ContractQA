// consistency-oracles.mjs — TEMPLATE-instantiated cross-signal consistency oracles
// (tuning-log Entry 33, approach B). These are DETERMINISTIC, LLM-free oracles that
// cross-check a value the UI DISPLAYS against what an interaction ACTUALLY does. The
// bug lives in the GAP between the two, and the oracle never trusts a (possibly buggy)
// code constant — defeating the blind-from-buggy-source wall for the consistency class.
//
// Why templates, not LLM generation (Entry 33 PoC-2): prompting the LLM to "assert the
// displayed value, not the constant" failed — with the buggy `Math.min(qty,10)` in the
// code window it anchored on the constant and encoded the cap. A template never reads
// imperative source, so it can't be anchored.
//
// Each template returns { id, surface, violations: [{detail, displayed, actual}] }.
// A non-empty `violations` array = a candidate bug (cross-signal inconsistency).
//
// Usage: node scripts/eval/consistency-oracles.mjs --base-url http://localhost:PORT --route /event/1

import { chromium } from '@playwright/test';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return a;
}

// ── Template 1: DISPLAYED-LIMIT ≥ STEPPER-REACHABLE ──
// If the UI displays an availability/stock count N next to a +/- quantity stepper, the
// stepper must let the user reach min(N, probe) — silently capping BELOW the displayed
// availability is an inconsistency (e.g. "500 available" but the + disables at 10).
const AVAIL_RE = /([\d,]+)\s*(?:tickets?|items?|seats?|units?|in stock|left|remaining|available)/i;

async function templateDisplayedLimitVsStepper(page) {
  const violations = [];
  const availLocs = page.getByText(AVAIL_RE);
  const n = await availLocs.count();
  // Steppers in DOM order; the i-th availability text pairs with the i-th stepper/quantity.
  const plus = page.getByRole('button').filter({ has: page.locator('svg.lucide-plus') });
  const qty = page.locator('span.w-8');
  const rows = Math.min(n, await plus.count(), await qty.count());
  for (let i = 0; i < rows; i++) {
    const txt = (await availLocs.nth(i).innerText()).trim();
    const m = txt.match(AVAIL_RE);
    if (!m) continue;
    const displayed = parseInt(m[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(displayed) || displayed <= 1) continue;
    const probe = Math.min(displayed, 15); // don't click 500 times; reaching 15 disproves a small cap
    const plusI = plus.nth(i);
    let reached = parseInt((await qty.nth(i).innerText().catch(() => '0')).trim(), 10) || 0;
    let cappedBelow = false;
    for (let c = 0; c < probe; c++) {
      if (await plusI.isDisabled().catch(() => true)) { cappedBelow = reached < probe; break; }
      await plusI.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(80);
      reached = parseInt((await qty.nth(i).innerText().catch(() => String(reached))).trim(), 10) || reached;
    }
    if (cappedBelow || reached < probe) {
      violations.push({
        detail: `stepper #${i + 1} caps selection at ${reached} but UI displays ${displayed} available (must allow up to min(${displayed},${probe})=${probe})`,
        displayed, actual: reached,
      });
    }
  }
  return { id: 'displayed-limit-vs-stepper', surface: 'quantity steppers vs displayed availability', violations };
}

const TEMPLATES = [templateDisplayedLimitVsStepper];

export async function runConsistencyOracles(page) {
  const results = [];
  for (const t of TEMPLATES) {
    try { results.push(await t(page)); }
    catch (e) { results.push({ id: t.name, error: String(e.message || e).slice(0, 120), violations: [] }); }
  }
  return results;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const baseUrl = typeof args['base-url'] === 'string' ? args['base-url'] : null;
  const route = typeof args.route === 'string' ? args.route : '/';
  if (!baseUrl) { console.error('usage: --base-url URL [--route /path]'); process.exit(1); }
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ baseURL: baseUrl })).newPage();
  await page.goto(route, { waitUntil: 'networkidle' });
  const results = await runConsistencyOracles(page);
  await browser.close();
  const total = results.reduce((s, r) => s + (r.violations?.length || 0), 0);
  console.log(JSON.stringify({ route, total_violations: total, results }, null, 2));
}
