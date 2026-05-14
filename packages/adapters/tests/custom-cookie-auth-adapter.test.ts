import { describe, it, expect, vi } from 'vitest';
import { CustomCookieAuthAdapter } from '../src/auth/custom-cookie.js';

describe('CustomCookieAuthAdapter', () => {
  it('loginAs POSTs to the configured login endpoint and adds the cookie', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'apk_sid=abc123; HttpOnly; Path=/' },
      });
    });
    const addCookies = vi.fn(async () => undefined);
    const a = new CustomCookieAuthAdapter({
      cookieName: 'apk_sid',
      loginUrl: '/api/v1/auth/login',
      logoutUrl: '/api/v1/auth/logout',
      baseUrl: 'http://localhost:3000',
      _fetch: fetchMock as unknown as typeof fetch,
    });
    const page = {
      context: () => ({ addCookies, cookies: async () => [] }),
    } as unknown as Parameters<typeof a.loginAs>[1];
    await a.loginAs('user@x.test:pw', page);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/login',
      expect.any(Object),
    );
    expect(addCookies).toHaveBeenCalled();
  });

  it('currentUser reads the cookie from page.context', async () => {
    const a = new CustomCookieAuthAdapter({
      cookieName: 'apk_sid',
      loginUrl: '/x',
      logoutUrl: '/y',
      baseUrl: 'http://localhost:3000',
    });
    const page = {
      context: () => ({
        cookies: async () => [{ name: 'apk_sid', value: 'sid-123' }],
      }),
    } as unknown as Parameters<typeof a.currentUser>[0];
    expect(await a.currentUser(page)).toEqual({ id: 'sid-123', role: 'user' });
  });

  it('isAuthenticated returns true when the named cookie is present', async () => {
    const a = new CustomCookieAuthAdapter({
      cookieName: 'apk_sid',
      loginUrl: '/x',
      logoutUrl: '/y',
      baseUrl: 'http://localhost:3000',
    });
    const present = {
      context: () => ({ cookies: async () => [{ name: 'apk_sid', value: 's' }] }),
    } as unknown as Parameters<typeof a.isAuthenticated>[0];
    const absent = {
      context: () => ({ cookies: async () => [] }),
    } as unknown as Parameters<typeof a.isAuthenticated>[0];
    expect(await a.isAuthenticated(present)).toBe(true);
    expect(await a.isAuthenticated(absent)).toBe(false);
  });

  it('sessionKeyPatterns names the cookie as a regex', () => {
    const a = new CustomCookieAuthAdapter({
      cookieName: 'apk_sid',
      loginUrl: '/x',
      logoutUrl: '/y',
      baseUrl: 'http://localhost:3000',
    });
    const p = a.sessionKeyPatterns();
    expect(p.cookies.some((re) => re.test('apk_sid'))).toBe(true);
    expect(p.localStorage).toEqual([]);
  });
});
