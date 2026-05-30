import { describe, it, expect, vi } from 'vitest';
import { compileContract, type CompiledPage } from '../src/compile.js';
import type { ContractDoc } from '@contractqa/core';

const contract = {
  id: 'INV-A2',
  title: 'logout blocks /agents',
  area: 'auth',
  severity: 'P0',
  risk_tags: [],
  preconditions: { auth_state: 'logged_in', role: 'normal_user' },
  actions: [
    { type: 'goto', path: '/lobby' },
    { type: 'click', target: { role: 'button', name_regex: 'logout' } },
    { type: 'goto', path: '/agents' },
  ],
  expected: { url: { matches: '^/login' } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
} as unknown as ContractDoc;

describe('compileContract', () => {
  it('returns a thunk that performs actions in order', async () => {
    const calls: string[] = [];
    const page: CompiledPage = {
      goto: vi.fn(async (p: string) => {
        calls.push(`goto:${p}`);
        return undefined;
      }),
      getByRole: () => ({
        click: vi.fn(async () => {
          calls.push('click');
        }),
        fill: vi.fn(async () => undefined),
      }),
      url: () => '/login',
      waitForTimeout: vi.fn(async () => undefined),
    };
    const thunk = compileContract(contract);
    await thunk({
      page,
      snapshot: async () => ({ url: '/login', localStorageKeys: [], cookies: [] }),
    });
    expect(calls).toEqual(['goto:/lobby', 'click', 'goto:/agents']);
  });

  it('target.within chains getByRole(within).getByRole(target.role)', async () => {
    const calls: string[] = [];
    const locator: any = {
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      first: vi.fn(() => locator),
      getByRole: vi.fn((role: string) => {
        calls.push(`scoped:getByRole(${role})`);
        return locator;
      }),
    };
    const page: any = {
      goto: vi.fn(async () => undefined),
      url: () => 'http://x/',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn((role: string) => {
        calls.push(`page:getByRole(${role})`);
        return locator;
      }),
    };
    const c: ContractDoc = {
      id: 'INV-T3',
      title: 'within',
      area: 'test',
      severity: 'P2',
      owner: 't',
      risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [
        { type: 'click', target: { role: 'link', name_regex: 'x', within: 'navigation' } },
      ],
      expected: {},
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    await compileContract(c)({
      page,
      snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }),
    });
    expect(calls).toEqual(['page:getByRole(navigation)', 'scoped:getByRole(link)']);
  });

  it('http action: captures last response on returned thunk', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://api.local/v1/cards');
      expect(init.method).toBe('POST');
      return new Response('{"id":"abc","ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', 'x-trace': 't1' },
      });
    });
    const origFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const page: any = {
      goto: vi.fn(),
      url: () => '/',
      waitForTimeout: vi.fn(),
      getByRole: vi.fn(),
    };
    const c: ContractDoc = {
      id: 'http-capture',
      title: 'http capture',
      area: 'api',
      severity: 'P1',
      risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [
        {
          type: 'http',
          method: 'POST',
          path: '/v1/cards',
          body: { suit: 'spade' },
        },
      ],
      expected: { http: { status: 201, body: { contains: ['"ok":true'] } } },
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    try {
      const result = await compileContract(c, { baseUrl: 'http://api.local' })({
        page,
        snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }),
      });
      expect(result.httpResponse?.status).toBe(201);
      expect(result.httpResponse?.body).toContain('"ok":true');
      expect(result.httpResponse?.headers['x-trace']).toBe('t1');
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = origFetch;
    }
  });

  it('G18: throws when expected.dom set but no goto/click/fill action', () => {
    const c: ContractDoc = {
      id: 'g18-violation',
      title: 'dom check with only http',
      area: 'api',
      severity: 'P1',
      risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'http', method: 'GET', path: '/api/x' }],
      expected: { dom: { contains_text: ['Cards'] } },
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    expect(() => compileContract(c, { baseUrl: 'http://x' })).toThrow(/G18/);
  });

  it('G18: passes when expected.dom set AND a goto action is present', () => {
    const c: ContractDoc = {
      id: 'g18-pass',
      title: 'dom check with goto',
      area: 'ui',
      severity: 'P2',
      risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/x' }],
      expected: { dom: { contains_text: ['Hello'] } },
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    expect(() => compileContract(c, { baseUrl: 'http://x' })).not.toThrow();
  });

  it('target.text resolves to getByRole(button, {name: /escaped/i}) — not a bare getByRole that strict-mode-crashes', async () => {
    const calls: Array<{ role: string; name?: string }> = [];
    const locator: any = {
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      first: () => locator,
      getByRole: () => locator,
      getByTestId: () => locator,
    };
    const page: any = {
      goto: vi.fn(async () => undefined),
      url: () => '/',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn((role: string, opts?: { name?: RegExp }) => {
        calls.push({ role, name: opts?.name?.source });
        return locator;
      }),
      getByTestId: vi.fn(() => locator),
    };
    const c = {
      id: 't-text', title: 'text', area: 'ui', severity: 'P2', risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'click', target: { text: 'Barn (Rustic)' } }],
      expected: {}, verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    await compileContract(c)({ page, snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }) });
    // defaults role to 'button'; text becomes a regex-escaped accessible-name match
    expect(calls).toEqual([{ role: 'button', name: 'Barn \\(Rustic\\)' }]);
  });

  it('target.test_id resolves via getByTestId, never getByRole', async () => {
    const calls: string[] = [];
    const locator: any = {
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      first: () => locator,
      getByRole: () => locator,
      getByTestId: () => locator,
    };
    const page: any = {
      goto: vi.fn(async () => undefined),
      url: () => '/',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => { calls.push('getByRole'); return locator; }),
      getByTestId: vi.fn((id: string) => { calls.push(`getByTestId:${id}`); return locator; }),
    };
    const c = {
      id: 't-tid', title: 'tid', area: 'ui', severity: 'P2', risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'click', target: { test_id: 'submit-btn' } }],
      expected: {}, verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    await compileContract(c)({ page, snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }) });
    expect(calls).toEqual(['getByTestId:submit-btn']);
  });

  it('goto.locale calls page.setExtraHTTPHeaders before goto', async () => {
    const calls: string[] = [];
    const locator: any = {
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      first: () => locator,
      getByRole: () => locator,
    };
    const page: any = {
      goto: vi.fn(async (p: string) => calls.push(`goto:${p}`)),
      setExtraHTTPHeaders: vi.fn(async (h: Record<string, string>) =>
        calls.push(`headers:${JSON.stringify(h)}`),
      ),
      url: () => '/',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: () => locator,
    };
    const c: ContractDoc = {
      id: 'INV-T6',
      title: 'locale',
      area: 'test',
      severity: 'P2',
      owner: 't',
      risk_tags: [],
      preconditions: { auth_state: 'anonymous' },
      actions: [{ type: 'goto', path: '/', locale: 'en-US' }],
      expected: {},
      verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
    } as unknown as ContractDoc;
    await compileContract(c)({
      page,
      snapshot: async () => ({ url: '/', localStorageKeys: [], cookies: [] }),
    });
    expect(calls).toEqual(['headers:{"Accept-Language":"en-US"}', 'goto:/']);
  });
});
