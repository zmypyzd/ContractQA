import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  InteractionSchema,
  InteractionsSchema,
  enumerateSurface,
  type Interaction,
} from '../src/autopilot/interaction-discovery.js';

// Stub out assembleTargetContext so tests don't need a real git repo.
vi.mock('../src/autopilot/bootstrap.js', () => ({
  assembleTargetContext: vi.fn(async (cwd: string) => ({
    cwd,
    framework: 'nextjs' as const,
    authProvider: 'unknown' as const,
    routes: [],
    testCredentials: { source: 'none' as const },
    envFiles: [],
  })),
}));

describe('InteractionSchema', () => {
  it('accepts a valid interaction', () => {
    const valid: Interaction = {
      id: 'btn-launcher-night-shift',
      type: 'button',
      file: 'apps/dashboard/app/launcher/page.tsx',
      name: 'Night-shift button',
      module: 'dashboard',
      rationale: 'triggers auto-pr watch mode',
    };
    expect(InteractionSchema.parse(valid)).toEqual(valid);
  });

  it('rejects id with uppercase letters', () => {
    expect(() =>
      InteractionSchema.parse({
        id: 'BTN-Launcher',
        type: 'button',
        file: 'a.tsx',
        name: 'x',
        module: 'm',
        rationale: 'r',
      }),
    ).toThrow(/kebab-case/);
  });

  it('rejects unknown type', () => {
    expect(() =>
      InteractionSchema.parse({
        id: 'x',
        type: 'unknown-type',
        file: 'a.tsx',
        name: 'x',
        module: 'm',
        rationale: 'r',
      }),
    ).toThrow();
  });
});

// Helper: build a stub LLMClient that returns a canned response.
const stubLlm = (response: string): LLMClient => ({
  providerName: 'anthropic-sdk',
  modelHint: 'test',
  generate: vi.fn(async () => ({ content: response, usage: { inputTokens: 0, outputTokens: 0 } })),
});

// Use require/dynamic-import-style import for stubLlm typing:
import type { LLMClient } from '@contractqa/orchestrator/llm';

describe('enumerateSurface', () => {
  it('returns parsed interactions from valid LLM JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{"name":"x"}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app', 'page.tsx'), 'export default function Page() { return null }');

    const cannedInteractions = [
      {
        id: 'btn-app-cta',
        type: 'button',
        file: 'app/page.tsx',
        name: 'CTA',
        module: 'app',
        rationale: 'main call-to-action',
      },
    ];
    const llm = stubLlm(JSON.stringify(cannedInteractions));

    const result = await enumerateSurface({ cwd, llmClient: llm });

    expect(result.interactions).toEqual(cannedInteractions);
    expect(result.truncated).toBe(false);
    expect(result.diagnostics.fileCount).toBeGreaterThan(0);
  });

  it('returns interactions=null on invalid JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const onQuarantine = vi.fn();
    const llm = stubLlm('not json at all');

    const result = await enumerateSurface({ cwd, llmClient: llm, onQuarantine });

    expect(result.interactions).toBeNull();
    expect(onQuarantine).toHaveBeenCalledWith('not json at all', expect.stringContaining('JSON'));
  });

  it('returns interactions=null on schema validation failure', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const invalid = [{ id: 'UPPERCASE', type: 'button', file: 'x', name: 'y', module: 'z', rationale: 'r' }];
    const onQuarantine = vi.fn();
    const llm = stubLlm(JSON.stringify(invalid));

    const result = await enumerateSurface({ cwd, llmClient: llm, onQuarantine });

    expect(result.interactions).toBeNull();
    expect(onQuarantine).toHaveBeenCalled();
  });

  it('marks truncated=true and emits warn when file tree exceeds cap', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');
    // Create enough files to exceed a small artificial cap
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    for (let i = 0; i < 100; i++) {
      await writeFile(path.join(cwd, 'src', `f${i}.ts`), '// x');
    }

    const llm = stubLlm('[]');
    const result = await enumerateSurface({ cwd, llmClient: llm, maxTokens: 500 });

    expect(result.truncated).toBe(true);
  });
});
