// Manifestation audit — app 0004 (Wedding planner / Workflow). 7 pass:false flows.
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8080';
const out = {};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// ---- id3 + id12 + id16: venue list content + View Details redirect ----
await page.goto('/venues', { waitUntil: 'networkidle' });
const venueCards = page.locator('.group:has(button:has-text("View Details"))');
const vCount = await venueCards.count();
const firstVenueText = vCount ? (await venueCards.first().innerText()).replace(/\n+/g, ' | ') : null;
// numeric specific price present anywhere on a venue card?
const venueHasNumericPrice = vCount ? /\$\s?\d/.test(await venueCards.first().innerText()) : false;
const urlBefore = page.url();
await page.locator('button:has-text("View Details")').first().click();
await page.waitForTimeout(600);
const urlAfterViewDetails = page.url();
out.id3_venue_list_content = { venueCount: vCount, firstVenueText };
out.id12_view_details_redirect = { urlBefore, urlAfterViewDetails, redirected: urlAfterViewDetails !== urlBefore };
out.id16_specific_price = { venueHasNumericPrice, note: 'data model has priceRange enum only (budget/moderate/luxury), no numeric price' };

// ---- id4: vendor (supplier) list price-range display ----
await page.goto('/vendors', { waitUntil: 'networkidle' });
const vendorCards = page.locator('.group:has(button:has-text("View Profile"))');
const vendCount = await vendorCards.count();
const firstVendorText = vendCount ? (await vendorCards.first().innerText()).replace(/\n+/g, ' | ') : null;
const vendorPriceBadge = vendCount ? /budget|moderate|luxury/i.test(await vendorCards.first().innerText()) : false;
out.id4_vendor_price_range = { vendorCount: vendCount, firstVendorText, priceRangeLabelShown: vendorPriceBadge };

// ---- id8 + id9 + id11: planning modal validation (budget>0, guests>=0 int, future date) ----
await page.goto('/', { waitUntil: 'networkidle' });
await page.locator('button:has-text("Get Started"), button:has-text("Update Details")').first().click();
await page.waitForSelector('text=Wedding Details');
const budgetEl = page.locator('input[type="number"]').nth(0);
const guestEl = page.locator('input[type="number"]').nth(1);
const dateEl = page.locator('input[type="date"]').first();
const attrs = {
  budget_min: await budgetEl.getAttribute('min'),
  guest_min: await guestEl.getAttribute('min'),
  guest_step: await guestEl.getAttribute('step'),
  date_min: await dateEl.getAttribute('min'),
};
await budgetEl.fill('-5000');
await guestEl.fill('-10');
await dateEl.fill('2020-01-01');   // past
await page.locator('button:has-text("Save")').click();
await page.waitForTimeout(500);
// read back the dashboard stat cards
const bodyText = await page.locator('body').innerText();
out.id8_id9_id11_planning_validation = {
  inputAttrs: attrs,
  savedNegativeBudgetShown: /\$-5,?000|\$-5000/.test(bodyText),
  savedNegativeGuestsShown: /-10/.test(bodyText),
  savedPastDateShown: /2020|Jan 1, 2020/.test(bodyText),
  note: 'no min attrs + handleSave has no guard → invalid values persist',
};

console.log(JSON.stringify(out, null, 2));
await browser.close();
