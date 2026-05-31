// Decisive experiment: does an EXPRESSIBLE outcome oracle catch app4's MISSING-ATTRIBUTE
// omission bugs (budget>0 id8, guests>=0 id9, future-date id11) when it reaches the gated
// planning modal + runs? Mirrors what a contract does: fill illegal -> Save -> inspect the
// dashboard stat card (not_contains_text-style outcome oracle).
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8080';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const out = {};

async function setFieldsAndSave({ budget, guests, date }) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Get Started"), button:has-text("Update Details")').first().click();
  await page.waitForSelector('text=Wedding Details');
  if (budget !== undefined) await page.locator('input[type="number"]').nth(0).fill(String(budget));
  if (guests !== undefined) await page.locator('input[type="number"]').nth(1).fill(String(guests));
  if (date !== undefined) await page.locator('input[type="date"]').first().fill(date);
  await page.locator('button:has-text("Save")').click();
  await page.waitForTimeout(400);
  return (await page.locator('body').innerText()).replace(/\n+/g, ' ');
}

// id8 budget>0 (numeric outcome oracle)
const b = await setFieldsAndSave({ budget: -5000 });
out.id8_budget = { negativeShown: /\$-\s?5,?000|-5,000/.test(b), oracle: /-5,000/.test(b) ? 'CATCHES (not_contains_text:["-5,000"] fails on buggy app)' : 'misses' };

// id9 guests>=0 (numeric outcome oracle)
const g = await setFieldsAndSave({ guests: -10 });
const guestCard = g.match(/Guest Count\s*\$?(-?\d+)/i);
out.id9_guests = { rawNear: guestCard ? guestCard[0] : '(not found)', negativeShown: /Guest Count\s*-?10|-10/.test(g), oracle: /-10/.test(g) ? 'CATCHES (not_contains_text:["-10"] fails on buggy app)' : 'misses' };

// id11 wedding date past (DATE outcome — needs a RELATIVE before-today judgment)
const d = await setFieldsAndSave({ date: '2020-01-01' });
const dateShown = /2020|Jan 1, 2020/.test(d);
out.id11_date = {
  pastDateShown: dateShown,
  static_oracle: 'NOT generically expressible — "date must be before today" needs computed/relative assertion; not_contains_text:["2020"] is app/date-specific and brittle',
  note: dateShown ? 'past date persisted & displayed (bug manifests), but the OUTCOME assertion is relative-to-today → expressibility gap, not epistemic' : 'not shown',
};

console.log(JSON.stringify(out, null, 2));
await browser.close();
