// Manifestation audit — app 0002 (Eventify / Commerce). Drives the 5 pass:false flows
// and records ACTUAL runtime behavior, to classify each as M(anifests)/N(o)/C(lass-mismatch).
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8080';
const out = {};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// ---- id10 + id16: ticket count cap + total-count display ----
await page.goto('/event/1', { waitUntil: 'networkidle' });
const firstPlus = page.locator('button:has(svg.lucide-plus):visible').first();
const qtySpan = page.locator('span.w-8:visible').first();
let clicks = 0, lastQty = null, plusDisabledAt = null;
for (let i = 0; i < 14; i++) {
  if (await firstPlus.isDisabled()) { plusDisabledAt = (await qtySpan.textContent())?.trim(); break; }
  await firstPlus.click();
  clicks++;
  lastQty = (await qtySpan.textContent())?.trim();
}
const totalText = await page.locator('text=/Total \\(\\d+ tickets\\)/').first().textContent().catch(() => null);
out.id10_max_ticket_cap = { clicks, lastQty, plusDisabledAt, totalText };
out.id16_total_count = { totalText, perTicketQty: lastQty, note: 'does Total(N) reflect added qty?' };

// ---- id9 + id12: success toast + phone validation on checkout ----
await page.locator('button:has-text("Continue to Checkout"):visible').first().click();
await page.waitForSelector('text=Complete Your Reservation');
await page.fill('#name', 'Audit Tester');
await page.fill('#email', 'audit@test.com');
await page.fill('#phone', 'not-a-phone-xyz');     // deliberately invalid format
const phoneEl = page.locator('#phone');
const phoneAttrs = {
  type: await phoneEl.getAttribute('type'),
  pattern: await phoneEl.getAttribute('pattern'),
  required: await phoneEl.getAttribute('required') !== null,
};
const urlBeforeSubmit = page.url();
await page.locator('button:has-text("Confirm Reservation")').click();
// toast fires then navigate('/') after 1500ms setTimeout. Poll for toast text quickly.
let toastSeen = false, toastText = null;
for (let i = 0; i < 25; i++) {
  const t = await page.locator('text=/Reservation Confirmed/i').first().textContent().catch(() => null);
  if (t) { toastSeen = true; toastText = t.trim(); break; }
  await page.waitForTimeout(100);
}
await page.waitForTimeout(1800);
const urlAfter = page.url();
out.id12_phone_validation = { phoneAttrs, submittedInvalidPhone: 'not-a-phone-xyz', navigatedAway: urlAfter !== urlBeforeSubmit, urlAfter };
out.id9_success_toast = { toastSeen, toastText, urlAfter };

// ---- id11: past-date selectable on event creation ----
await page.goto('/organizer', { waitUntil: 'networkidle' });
const createBtn = page.locator('button:has-text("Create Event"), button:has-text("Create"), button:has-text("New Event")').first();
await createBtn.click().catch(() => {});
await page.waitForTimeout(500);
const dateEl = page.locator('#date');
const dateAttrs = await dateEl.count() ? {
  exists: true,
  min: await dateEl.getAttribute('min'),
  type: await dateEl.getAttribute('type'),
} : { exists: false };
let pastDateAccepted = null;
if (dateAttrs.exists) {
  await dateEl.fill('2020-01-01');
  pastDateAccepted = (await dateEl.inputValue()) === '2020-01-01';
}
out.id11_past_date = { dateAttrs, pastDateAccepted };

console.log(JSON.stringify(out, null, 2));
await browser.close();
