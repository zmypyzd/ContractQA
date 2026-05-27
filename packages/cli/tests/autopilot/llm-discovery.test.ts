// packages/cli/tests/autopilot/llm-discovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { discoverByModule } from '../../src/autopilot/llm-discovery.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';
import type { TargetContext } from '../../src/autopilot/bootstrap.js';

function mockClient(payloads: string[]): LLMClient {
  let i = 0;
  return {
    providerName: 'openai-compatible',
    modelHint: 'fake',
    async generate() {
      const p = payloads[i++] ?? '[]';
      return { content: p, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

const ctx: TargetContext = {
  cwd: '/tmp/fake',
  framework: 'next-app',
  authProvider: 'supabase',
  routes: ['/'],
  testCredentials: { source: 'none' },
  envFiles: [],
};

describe('discoverByModule', () => {
  it('emits proposals per module via onModule callback', async () => {
    const llm = mockClient([
      JSON.stringify([{ yaml: 'id: X\n', confidence: 'high', module: 'auth', evidence: { sourceFiles: [], rationale: 'r' } }]),
    ]);
    const seen: Array<{ module: string; count: number }> = [];
    await discoverByModule(ctx, llm, async (m, ps) => { seen.push({ module: m, count: ps.length }); }, new AbortController().signal, {
      modules: ['auth'],
    });
    expect(seen).toEqual([{ module: 'auth', count: 1 }]);
  });

  it('Finding 6: strips LLM preamble before JSON.parse (no longer silent-quarantines)', async () => {
    // Reproduces the 2026-05-27 root cause: Claude consistently prepends
    // "Now I have a comprehensive understanding..." before the JSON array.
    // Before the fix every module silently went to quarantine with generated=0.
    const preambled =
      'Now I have a comprehensive understanding of the auth module. Let me produce the JSON array.\n\n' +
      JSON.stringify([
        { yaml: 'id: INV-AUTH-01\n', confidence: 'high', module: 'auth', evidence: { sourceFiles: [], rationale: 'r' } },
      ]);
    const llm = mockClient([preambled]);
    const seen: number[] = [];
    const quarantined: string[] = [];
    await discoverByModule(ctx, llm, async (_, ps) => { seen.push(ps.length); }, new AbortController().signal, {
      modules: ['auth'],
      onQuarantine: (raw) => quarantined.push(raw),
    });
    expect(quarantined).toEqual([]);
    expect(seen).toEqual([1]);
  });

  it('Finding 7: raw-contract output (no ContractProposal wrapper) is synthesized into wrappers', async () => {
    // Reproduces the second silent-quarantine bug: LLM emits raw contracts
    // instead of wrapping them in {yaml, confidence, module, evidence}.
    // Pre-fix: ProposalSchema rejected the batch and the whole module went
    // to quarantine. Post-fix: parseProposals synthesizes the wrapper.
    const rawContracts = JSON.stringify([
      {
        id: 'INV-AUTH-01',
        title: 'Missing auth returns 401',
        area: 'auth',
        severity: 'P0',
        preconditions: { auth_state: 'anonymous' },
        actions: [{ type: 'http', method: 'GET', path: '/auth/me' }],
        expected: { http: { status: 401 } },
      },
    ]);
    const llm = mockClient(['preamble text here.\n\n' + rawContracts]);
    const seen: Array<{ module: string; count: number; yaml: string }> = [];
    const quarantined: string[] = [];
    await discoverByModule(ctx, llm, async (m, ps) => {
      seen.push({ module: m, count: ps.length, yaml: ps[0]?.yaml ?? '' });
    }, new AbortController().signal, {
      modules: ['auth'],
      onQuarantine: (raw) => quarantined.push(raw),
    });
    expect(quarantined).toEqual([]);
    expect(seen[0]?.count).toBe(1);
    expect(seen[0]?.module).toBe('auth');
    expect(seen[0]?.yaml).toContain('id: INV-AUTH-01');
    expect(seen[0]?.yaml).toContain('http:');
    expect(seen[0]?.yaml).toContain('status: 401');
  });

  it('Finding 6: strips ```json fences', async () => {
    const fenced = '```json\n' + JSON.stringify([
      { yaml: 'id: X\n', confidence: 'high', module: 'auth', evidence: { sourceFiles: [], rationale: 'r' } },
    ]) + '\n```';
    const llm = mockClient([fenced]);
    const seen: number[] = [];
    await discoverByModule(ctx, llm, async (_, ps) => { seen.push(ps.length); }, new AbortController().signal, {
      modules: ['auth'],
    });
    expect(seen).toEqual([1]);
  });

  it('quarantines malformed YAML output and continues', async () => {
    const llm = mockClient(['NOT VALID JSON']);
    const seen: number[] = [];
    const quarantined: string[] = [];
    await discoverByModule(ctx, llm, async (_, ps) => { seen.push(ps.length); }, new AbortController().signal, {
      modules: ['auth'],
      onQuarantine: (raw) => quarantined.push(raw),
    });
    expect(quarantined.length).toBeGreaterThan(0);
    expect(seen).toEqual([0]);
  });

  it('retries on transport error with backoff (mock)', async () => {
    let attempts = 0;
    const llm: LLMClient = {
      providerName: 'openai-compatible',
      modelHint: 'fake',
      async generate() {
        attempts++;
        if (attempts < 2) throw Object.assign(new Error('rate'), { statusCode: 429 });
        return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    await discoverByModule(ctx, llm, async () => {}, new AbortController().signal, {
      modules: ['auth'],
      backoffMs: 1, // small for test
    });
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('AbortSignal abort during backoff exits promptly', async () => {
    const ac = new AbortController();
    let attempts = 0;
    const llm: LLMClient = {
      providerName: 'openai-compatible',
      modelHint: 'fake',
      async generate() {
        attempts++;
        // Always fail with 429 to trigger backoff; abort after first attempt.
        if (attempts === 1) {
          // Schedule abort to fire during the backoff sleep (backoffMs=100ms).
          setTimeout(() => ac.abort(), 10);
        }
        throw Object.assign(new Error('rate'), { statusCode: 429 });
      },
    };
    const start = Date.now();
    // backoffMs=100 → first backoff would be 100ms, but abort fires at 10ms.
    await discoverByModule(ctx, llm, async () => {}, ac.signal, {
      modules: ['auth'],
      backoffMs: 100,
    });
    const elapsed = Date.now() - start;
    // Should exit well before the 100ms backoff completes.
    expect(elapsed).toBeLessThan(500);
  });
});
