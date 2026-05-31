// Manifestation audit — app 0003 (JobBoard / Search). 3 pass:false flows.
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8080';
const out = {};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

async function tryEmail(email) {
  await page.goto('/jobs/job-1', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Audit Tester');
  await page.fill('#email', email);
  await page.fill('#message', 'I am a great fit.');
  const valid = await page.locator('#email').evaluate((el) => el.validity.valid);
  await page.locator('button:has-text("Submit Application")').click();
  let toast = false;
  for (let i = 0; i < 20; i++) {
    if (await page.locator('text=/Application submitted/i').first().isVisible().catch(() => false)) { toast = true; break; }
    await page.waitForTimeout(100);
  }
  return { email, nativeValid: valid, submitted: toast };
}

// ---- id9: email format validation ----
out.id9_email_validation = {
  noAtSign: await tryEmail('abc'),          // clearly malformed — native should block
  weakButAtSign: await tryEmail('a@b'),     // passes native HTML5 but arguably invalid format
};

// ---- id11: duplicate application same contact/position ----
await page.goto('/jobs/job-1', { waitUntil: 'networkidle' });
async function submitApp() {
  await page.fill('#name', 'Dup Tester');
  await page.fill('#email', 'dup@test.com');
  await page.fill('#message', 'Applying again.');
  await page.locator('button:has-text("Submit Application")').click();
  for (let i = 0; i < 20; i++) {
    if (await page.locator('text=/Application submitted/i').first().isVisible().catch(() => false)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
const firstSubmit = await submitApp();
await page.waitForTimeout(1200);   // let toast clear
const secondSubmit = await submitApp();
out.id11_duplicate_application = { firstSubmit, secondSubmit, note: 'both true = no dedup, dup allowed' };

// ---- id12: "Post a Job" button presence + any job-seeker role switcher ----
await page.goto('/', { waitUntil: 'networkidle' });
const postJobVisible = await page.locator('header').locator('text=/Post a Job/i').first().isVisible().catch(() => false);
// search for any control that switches to a "job seeker" / candidate profile
const roleSwitchControls = await page.locator('text=/job seeker|seeker profile|switch.*profile|candidate/i').allTextContents().catch(() => []);
out.id12_post_job_always_visible = { postJobVisibleOnHome: postJobVisible, jobSeekerRoleControlsFound: roleSwitchControls, note: 'no role switcher = "job seeker profile" doesn\'t exist in app' };

console.log(JSON.stringify(out, null, 2));
await browser.close();
