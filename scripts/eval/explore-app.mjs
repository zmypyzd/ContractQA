// explore-app.mjs — deterministic "observed surface map" of a LIVE app (Tier-2 grounding,
// tuning-log Entry 35). Drives the running app with Playwright and records the REAL interactive
// elements (role + accessible name + key attrs) per route, so generation can ground locators in
// OBSERVED reality instead of statically guessing names that don't resolve ("no element matched").
//
// This observes STRUCTURE (where things are / what exists), NOT intent — intent still comes from
// the codebase per [[feedback_no_overfit_generalize]] / user constraint.
//
// Usage: node scripts/eval/explore-app.mjs --base-url http://localhost:PORT --routes /,/jobs/1

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

// Snapshot the interactive surface of the current page: every element that has a role and is a
// plausible interaction/assertion target, with its REAL accessible name + grounding-relevant attrs.
async function observeSurface(page) {
  return page.evaluate(() => {
    const SEL = '[role], a, button, input, select, textarea, [aria-label], [data-testid], h1, h2, h3';
    const out = [];
    for (const el of Array.from(document.querySelectorAll(SEL)).slice(0, 400)) {
      const tag = el.tagName;
      const role = el.getAttribute('role') ?? ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox', H1: 'heading', H2: 'heading', H3: 'heading' }[tag] ?? null);
      if (!role) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 60);
      const svg = el.querySelector('svg')?.getAttribute('class') || null;
      const rec = { role, name };
      const ph = el.getAttribute('placeholder'); if (ph) rec.placeholder = ph;
      const type = el.getAttribute('type'); if (type) rec.type = type;
      const tid = el.getAttribute('data-testid'); if (tid) rec.test_id = tid;
      if (!name && svg) rec.icon = svg;        // icon-only control → record its svg class
      if (el.hasAttribute('required')) rec.required = true;
      out.push(rec);
    }
    return out;
  });
}

export async function exploreRoutes(baseUrl, routes) {
  const browser = await chromium.launch({ headless: true });
  const map = {};
  for (const route of routes) {
    const p = await (await browser.newContext({ baseURL: baseUrl })).newPage();
    try {
      await p.goto(route, { waitUntil: 'networkidle', timeout: 20000 });
      const surface = await observeSurface(p);
      // dedupe identical (role,name) and keep interactive/form roles up front
      const seen = new Set();
      map[route] = surface.filter((r) => { const k = r.role + '|' + r.name + '|' + (r.placeholder || ''); if (seen.has(k)) return false; seen.add(k); return true; });
    } catch (e) { map[route] = { error: String(e.message || e).split('\n')[0].slice(0, 80) }; }
    await p.context().close();
  }
  await browser.close();
  return map;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const baseUrl = typeof args['base-url'] === 'string' ? args['base-url'] : null;
  const routes = (typeof args.routes === 'string' ? args.routes : '/').split(',');
  if (!baseUrl) { console.error('usage: --base-url URL [--routes /a,/b]'); process.exit(1); }
  const map = await exploreRoutes(baseUrl, routes);
  // print just textboxes/buttons (the grounding-relevant interactive set) per route
  for (const [route, surface] of Object.entries(map)) {
    console.log(`\n=== ${route} ===`);
    if (surface.error) { console.log('  ERROR', surface.error); continue; }
    const interactive = surface.filter((r) => ['textbox', 'button', 'combobox', 'link'].includes(r.role));
    for (const r of interactive.slice(0, 40)) console.log('  ' + JSON.stringify(r));
  }
}
