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
});
