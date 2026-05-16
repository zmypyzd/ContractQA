// packages/orchestrator/tests/llm/recording-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingLLMClient } from '../../src/llm/recording-client.js';
import type { LLMClient } from '../../src/llm/index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cqa-cassette-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

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
    delete process.env.UPDATE_CASSETTES;
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
});
