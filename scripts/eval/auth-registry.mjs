// auth-registry.mjs — per-app auth bootstrap for the exec-detection scorer.
//
// SCORER-SIDE ONLY. The blind-only rule covers contract GENERATION; scoring /
// reflection may inspect the app freely. This registry tells the scorer how to put
// the browser into a logged-in state so `auth_state: logged_in` contracts reach the
// gated surface instead of dying at the login wall (Entry 16: 21% auth_unreached).
//
// Strategies:
//   { strategy: 'localStorage', initPath, seed }
//     navigate initPath (to trigger the app's own storage seeding), then set the
//     given localStorage keys. For client-side-auth SPAs.
//   { strategy: 'register-ui', path, fields: {username,email,password} }
//     drive the register form (fallback for apps without client-side auth).
//
// Add an entry per app whose source you've inspected. Apps absent here keep the
// `auth_unreached` classification (honestly: "we have no bootstrap for this app").

export const AUTH_REGISTRY = {
  // CodeForge — client-side localStorage auth (src/lib/auth.ts).
  // `codeforge_current_user` = logged-in user id; demo user alice has id '1' and is
  // seeded by initializeStorage(), which runs on the /login route mount.
  '0008': {
    strategy: 'localStorage',
    initPath: '/login',
    seed: { codeforge_current_user: '1' },
    note: 'alice_codes (id 1), seeded via initializeStorage on /login mount',
  },
};

// Apply an auth entry to a live page (already in a context with baseURL set).
// Leaves localStorage in a logged-in state; the caller's contract navigates next.
export async function applyAuth(page, entry) {
  if (!entry) return false;
  if (entry.strategy === 'localStorage') {
    await page.goto(entry.initPath || '/', { waitUntil: 'load' });
    await page.evaluate((seed) => {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, entry.seed || {});
    return true;
  }
  if (entry.strategy === 'register-ui') {
    await page.goto(entry.path || '/register', { waitUntil: 'load' });
    const f = entry.fields || {};
    if (f.username) await page.locator(f.username).fill(`tester_${Date.now()}`);
    if (f.email) await page.locator(f.email).fill(`tester_${Date.now()}@demo.com`);
    if (f.password) await page.locator(f.password).fill('Test1234!');
    if (entry.submit) await page.locator(entry.submit).click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}
