// packages/orchestrator/tests/llm/recording-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingLLMClient } from '../../src/llm/recording-client.js';
import type { LLMClient } from '../../src/llm/index.js';

let tmp: string;
let origUpdate: string | undefined;
beforeEach(() => {
  origUpdate = process.env.UPDATE_CASSETTES;
  tmp = mkdtempSync(join(tmpdir(), 'cqa-cassette-'));
});
afterEach(() => {
  if (origUpdate === undefined) delete process.env.UPDATE_CASSETTES;
  else process.env.UPDATE_CASSETTES = origUpdate;
  rmSync(tmp, { recursive: true, force: true });
});

function fakeUpstream(content: string): LLMClient {
  return {
    providerName: 'openai-compatible',
    modelHint: 'fake',
    async generate() { return { content, usage: { inputTokens: 1, outputTokens: 1 } }; },
  };
}

describe('RecordingLLMClient', () => {
  it('records to cassette on first call when UPDATE_CASSETTES=1', async () => {
    process.env.UPDATE_CASSETTES = '1';
    const cassette = join(tmp, 'auth.json');
    const meta = join(tmp, 'auth.meta.json');
    const c = new RecordingLLMClient(fakeUpstream('recorded text'), cassette, { promptHash: 'abc' });
    await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(existsSync(cassette)).toBe(true);
    expect(existsSync(meta)).toBe(true);
    const m = JSON.parse(readFileSync(meta, 'utf8'));
    expect(m.promptHash).toBe('abc');
    expect(m.provider).toBe('openai-compatible');
  });

  it('replays from cassette when UPDATE_CASSETTES not set', async () => {
    const cassette = join(tmp, 'auth.json');
    const meta = join(tmp, 'auth.meta.json');
    writeFileSync(cassette, JSON.stringify([{ request: { messages: [{ role: 'user', content: 'Hi' }] }, response: { content: 'replayed', usage: { inputTokens: 2, outputTokens: 3 } } }]));
    writeFileSync(meta, JSON.stringify({ provider: 'openai-compatible', model: 'fake', capturedAt: new Date().toISOString(), promptHash: 'abc' }));
    const c = new RecordingLLMClient(fakeUpstream('SHOULD NOT BE CALLED'), cassette, { promptHash: 'abc' });
    const r = await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(r.content).toBe('replayed');
    expect(r.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
  });

  it('throws when promptHash drifts and UPDATE_CASSETTES not set', async () => {
    const cassette = join(tmp, 'auth.json');
    const meta = join(tmp, 'auth.meta.json');
    writeFileSync(cassette, JSON.stringify([]));
    writeFileSync(meta, JSON.stringify({ provider: 'openai-compatible', model: 'fake', capturedAt: new Date().toISOString(), promptHash: 'OLD' }));
    const c = new RecordingLLMClient(fakeUpstream('x'), cassette, { promptHash: 'NEW' });
    await expect(c.generate({ messages: [{ role: 'user', content: 'Hi' }] }))
      .rejects.toThrow(/promptHash drift/);
  });

  it('warns when cassette is >90 days old', async () => {
    const cassette = join(tmp, 'auth.json');
    const meta = join(tmp, 'auth.meta.json');
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(cassette, JSON.stringify([{ request: { messages: [{ role: 'user', content: 'Hi' }] }, response: { content: 'ok', usage: { inputTokens: 0, outputTokens: 0 } } }]));
    writeFileSync(meta, JSON.stringify({ provider: 'openai-compatible', model: 'fake', capturedAt: oldDate, promptHash: 'abc' }));
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => warns.push(m);
    try {
      const c = new RecordingLLMClient(fakeUpstream('x'), cassette, { promptHash: 'abc' });
      await c.generate({ messages: [{ role: 'user', content: 'Hi' }] });
    } finally {
      console.warn = origWarn;
    }
    expect(warns.some((w) => /90 days/.test(w))).toBe(true);
  });

  it('cassette miss when system prompt differs (system is part of key)', async () => {
    const cassette = join(tmp, 'sys.json');
    const meta = join(tmp, 'sys.meta.json');
    // Write a cassette recorded with system='A'
    writeFileSync(cassette, JSON.stringify([{
      request: { system: 'A', messages: [{ role: 'user', content: 'Hi' }] },
      response: { content: 'with-A', usage: { inputTokens: 1, outputTokens: 1 } },
    }]));
    writeFileSync(meta, JSON.stringify({ provider: 'openai-compatible', model: 'fake', capturedAt: new Date().toISOString(), promptHash: 'abc' }));
    const c = new RecordingLLMClient(fakeUpstream('x'), cassette, { promptHash: 'abc' });
    // Replay with system='B' — should miss, not replay
    await expect(c.generate({ system: 'B', messages: [{ role: 'user', content: 'Hi' }] }))
      .rejects.toThrow(/Cassette miss/);
  });

  it('upserts cassette entries on re-record — no accumulation', async () => {
    process.env.UPDATE_CASSETTES = '1';
    const cassette = join(tmp, 'upsert.json');
    const opts = { messages: [{ role: 'user' as const, content: 'Hi' }] };
    const c1 = new RecordingLLMClient(fakeUpstream('first'), cassette, { promptHash: 'abc' });
    await c1.generate(opts);
    const c2 = new RecordingLLMClient(fakeUpstream('second'), cassette, { promptHash: 'abc' });
    await c2.generate(opts);
    const entries = JSON.parse(readFileSync(cassette, 'utf8'));
    expect(entries).toHaveLength(1);
    expect(entries[0].response.content).toBe('second');
  });
});
