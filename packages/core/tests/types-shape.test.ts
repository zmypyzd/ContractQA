import { describe, it, expectTypeOf } from 'vitest';
import type {
  BrowserSnapshot,
  Verdict,
  IssueJson,
  AuthAdapter,
  AppAdapter,
} from '../src/index.js';

describe('public type surface', () => {
  it('Verdict is one of four states', () => {
    expectTypeOf<Verdict>().toEqualTypeOf<'PASS' | 'FAIL' | 'FLAKY' | 'INCONCLUSIVE'>();
  });
  it('BrowserSnapshot has required fields', () => {
    expectTypeOf<BrowserSnapshot>().toHaveProperty('localStorage');
    expectTypeOf<BrowserSnapshot>().toHaveProperty('cookies');
    expectTypeOf<BrowserSnapshot>().toHaveProperty('console');
  });
  it('IssueJson matches §11.2', () => {
    expectTypeOf<IssueJson>().toHaveProperty('issue_id');
    expectTypeOf<IssueJson>().toHaveProperty('invariants');
    expectTypeOf<IssueJson>().toHaveProperty('confidence');
  });
  it('AuthAdapter exposes sessionKeyPatterns and expectFullyLoggedOut', () => {
    expectTypeOf<AuthAdapter>().toHaveProperty('sessionKeyPatterns');
    expectTypeOf<AuthAdapter>().toHaveProperty('expectFullyLoggedOut');
  });
  it('AppAdapter exposes resetState and seed', () => {
    expectTypeOf<AppAdapter>().toHaveProperty('resetState');
    expectTypeOf<AppAdapter>().toHaveProperty('seed');
  });
});
