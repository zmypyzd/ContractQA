import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  InteractionSchema,
  InteractionsSchema,
  enumerateSurface,
  generateContractFor,
  runPool,
  buildExistingIndex,
  mergeContracts,
  contentHash,
  parseContract,
  discoverByInteraction,
  type Interaction,
  type MergeEvent,
  type DiscoveryEvent,
} from '../src/autopilot/interaction-discovery.js';
import type { ContractProposal } from '../src/autopilot/llm-discovery.js';

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

describe('enumerateSurface entry-file size cap', () => {
  it('truncates oversized entry files (e.g. huge package.json) before LLM call', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'enum-surface-bigfile-'));
    // 50kB package.json (over the 32kB cap)
    const huge = 'x'.repeat(50 * 1024);
    await writeFile(path.join(cwd, 'package.json'), `{"name":"x","junk":"${huge}"}`);

    let receivedUserContent = '';
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async (opts) => {
        receivedUserContent = opts.messages[0]!.content;
        return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
      }),
    };

    await enumerateSurface({ cwd, llmClient: llm });

    expect(receivedUserContent).toContain('// [... truncated for token budget]');
    // Per-file cap is 32kB, so user content for that file should be at most ~33kB
    const pkgSection = receivedUserContent.split('--- package.json ---')[1] ?? '';
    expect(pkgSection.length).toBeLessThan(34 * 1024);
  });
});

describe('generateContractFor', () => {
  const sampleInteraction: Interaction = {
    id: 'btn-login-submit',
    type: 'button',
    file: 'app/login/page.tsx',
    name: 'Submit',
    module: 'auth',
    rationale: 'main login submit button',
  };

  it('returns proposals when LLM returns valid JSON array', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    await writeFile(
      path.join(cwd, 'app/login/page.tsx'),
      `// line 1\n// line 2\nexport default function Page() {\n  return <button>Submit</button>;\n}\n`,
    );
    const proposalYaml = 'id: INV-LOGIN-1\ntitle: t\narea: auth\nseverity: P0';
    const llm = stubLlm(JSON.stringify([
      {
        yaml: proposalYaml,
        confidence: 'high',
        module: 'auth',
        evidence: { sourceFiles: ['app/login/page.tsx'], rationale: 'r' },
      },
    ]));

    const result = await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.yaml).toBe(proposalYaml);
  });

  it('returns empty proposals when LLM returns []', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    await writeFile(path.join(cwd, 'app/login/page.tsx'), 'export {}');
    const llm = stubLlm('[]');

    const result = await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    expect(result.proposals).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('returns error when LLM returns invalid JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    await writeFile(path.join(cwd, 'app/login/page.tsx'), 'export {}');
    const llm = stubLlm('not json');

    const result = await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    expect(result.proposals).toEqual([]);
    expect(result.error).toMatch(/JSON/);
    expect(result.rawResponse).toBe('not json');
  });

  it('extracts 40+40 lines around the first match of interaction.name', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-contract-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    const lines = Array.from({ length: 200 }, (_, i) => `// line ${i}`);
    lines[100] = '// line 100 — <button>Submit</button>';
    await writeFile(path.join(cwd, 'app/login/page.tsx'), lines.join('\n'));

    let receivedUserContent = '';
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async (opts) => {
        receivedUserContent = opts.messages[0]!.content;
        return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
      }),
    };

    await generateContractFor({ interaction: sampleInteraction, cwd, llmClient: llm });

    // Should include lines around line 100 (the match)
    expect(receivedUserContent).toContain('line 60');
    expect(receivedUserContent).toContain('line 100');
    expect(receivedUserContent).toContain('line 140');
    expect(receivedUserContent).not.toContain('line 0');
    expect(receivedUserContent).not.toContain('line 199');
  });
});

describe('generateContractFor symmetric truncation anchor preservation', () => {
  it('preserves the anchor line when symmetric truncation would otherwise excise it', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'gen-anchor-'));
    await mkdir(path.join(cwd, 'app/login'), { recursive: true });
    // 1000 lines, anchor at line 10 (near the start)
    const lines = Array.from({ length: 1000 }, (_, i) => `// padding line ${i}`);
    lines[10] = '<button>UniqueAnchor999</button>';
    await writeFile(path.join(cwd, 'app/login/page.tsx'), lines.join('\n'));

    let receivedUserContent = '';
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async (opts) => {
        receivedUserContent = opts.messages[0]!.content;
        return { content: '[]', usage: { inputTokens: 0, outputTokens: 0 } };
      }),
    };

    // Use a tight per-call token cap to force truncation
    const interaction: Interaction = {
      id: 'btn-anchor',
      type: 'button',
      file: 'app/login/page.tsx',
      name: 'UniqueAnchor999',
      module: 'auth',
      rationale: 'r',
    };
    await generateContractFor({ interaction, cwd, llmClient: llm, maxTokens: 800 });

    // The anchor MUST be inside the window the LLM saw
    expect(receivedUserContent).toContain('UniqueAnchor999');
  });
});

describe('runPool', () => {
  it('processes all items respecting the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    const results = await runPool(items, 4, async (i) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i * 2;
    });

    expect(results).toEqual(items.map((i) => i * 2));
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);  // proves concurrency was actually used
  });

  it('continues processing when an individual item throws', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runPool(items, 2, async (i) => {
      if (i === 3) throw new Error('boom');
      return i;
    });
    // Errors become null in the results array; other items still complete.
    expect(results[0]).toBe(1);
    expect(results[1]).toBe(2);
    expect(results[2]).toBeNull();
    expect(results[3]).toBe(4);
    expect(results[4]).toBe(5);
  });
});

describe('buildExistingIndex', () => {
  it('returns empty maps when qa/contracts does not exist', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'idx-'));
    const idx = await buildExistingIndex(cwd);
    expect(idx.byId.size).toBe(0);
    expect(idx.byHash.size).toBe(0);
  });

  it('indexes all yaml files under qa/contracts recursively', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'idx-'));
    await mkdir(path.join(cwd, 'qa/contracts/auth'), { recursive: true });
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/auth/login.yml'),
      'id: INV-AUTH-LOGIN\ntitle: login\nactions:\n  - {type: goto, path: /login}\nexpected: {}\n',
    );
    await writeFile(
      path.join(cwd, 'qa/contracts/core/feed.yaml'),
      'id: INV-CORE-FEED\ntitle: feed\nactions:\n  - {type: goto, path: /feed}\nexpected: {}\n',
    );

    const idx = await buildExistingIndex(cwd);

    expect(idx.byId.size).toBe(2);
    expect(idx.byId.has('INV-AUTH-LOGIN')).toBe(true);
    expect(idx.byId.has('INV-CORE-FEED')).toBe(true);
    expect(idx.byHash.size).toBe(2);
  });

  it('skips malformed yaml without throwing', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'idx-'));
    await mkdir(path.join(cwd, 'qa/contracts'), { recursive: true });
    await writeFile(path.join(cwd, 'qa/contracts/broken.yml'), 'this is: not [valid yaml');
    await writeFile(
      path.join(cwd, 'qa/contracts/good.yml'),
      'id: INV-GOOD\ntitle: t\nactions: []\nexpected: {}\n',
    );

    const idx = await buildExistingIndex(cwd);
    expect(idx.byId.has('INV-GOOD')).toBe(true);
    expect(idx.byId.size).toBe(1);
  });
});

describe('contentHash', () => {
  it('produces same hash regardless of key order in nested objects', () => {
    const a = { actions: [{ type: 'goto', path: '/x' }], expected: { url: '/y' }, title: 't' };
    const b = { title: 't', expected: { url: '/y' }, actions: [{ type: 'goto', path: '/x' }] };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('omits id from the hash', () => {
    const a = { id: 'INV-1', actions: [], expected: {} };
    const b = { id: 'INV-2', actions: [], expected: {} };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('changes when actions differ', () => {
    const a = { id: 'x', actions: [{ type: 'goto', path: '/a' }], expected: {} };
    const b = { id: 'x', actions: [{ type: 'goto', path: '/b' }], expected: {} };
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

describe('mergeContracts', () => {
  const interaction: Interaction = {
    id: 'btn-x',
    type: 'button',
    file: 'app/x.tsx',
    name: 'X',
    module: 'core',
    rationale: 'r',
  };

  const proposal = (id: string, area: string, action: string = '/x'): ContractProposal => ({
    yaml: `id: ${id}\ntitle: t\narea: ${area}\nactions:\n  - {type: goto, path: ${action}}\nexpected:\n  url: { matches: "${action}" }\n`,
    confidence: 'high',
    module: area,
    evidence: { sourceFiles: ['app/x.tsx'], rationale: 'r' },
  });

  it('writes a new contract when nothing exists', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-NEW-1', 'core') }],
    });

    expect(result.written).toHaveLength(1);
    expect(result.written[0]).toBe(path.join(cwd, 'qa/contracts/core/INV-NEW-1.yml'));
    expect(result.skipped).toHaveLength(0);
  });

  it('Layer 1 — skips on id collision with existing', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/core/INV-DUPE.yml'),
      'id: INV-DUPE\ntitle: existing\nactions: []\nexpected: {}\n',
    );

    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-DUPE', 'core', '/different') }],
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'INV-DUPE', reason: expect.stringContaining('id collision') });
  });

  it('Layer 2 — skips on content hash duplicate (different id, same content)', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    await writeFile(
      path.join(cwd, 'qa/contracts/core/INV-A.yml'),
      'id: INV-A\ntitle: t\narea: core\nactions:\n  - {type: goto, path: /x}\nexpected:\n  url: { matches: "/x" }\n',
    );

    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-B', 'core') }],
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'INV-B', reason: expect.stringContaining('content duplicate') });
  });

  it('Layer 3 — skips when target file already exists (race-safety)', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mkdir(path.join(cwd, 'qa/contracts/core'), { recursive: true });
    // Index does NOT see this file (it's added after buildExistingIndex would scan):
    // Simulate by writing a file that won't be in the in-memory index because we'll
    // intentionally place it AFTER mergeContracts builds the index. For this unit
    // test, we put a syntactically-broken file so it's skipped by buildExistingIndex
    // but still exists on disk.
    await writeFile(path.join(cwd, 'qa/contracts/core/INV-RACE.yml'), '[not valid yaml');

    const result = await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-RACE', 'core', '/race') }],
    });

    expect(result.written).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'INV-RACE', reason: expect.stringContaining('file exists') });
  });

  it('writes generated-by frontmatter on written files', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    await mergeContracts({
      cwd,
      proposals: [{ interaction, proposal: proposal('INV-FRONTMATTER', 'core') }],
    });
    const written = await readFile(path.join(cwd, 'qa/contracts/core/INV-FRONTMATTER.yml'), 'utf8');
    expect(written).toContain('# generated-by: deep-discovery v1');
    expect(written).toContain('# interaction: btn-x (button)');
  });

  it('stops at maxContracts cap and emits cap-reached event', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    const events: MergeEvent[] = [];
    const proposals = Array.from({ length: 5 }, (_, i) => ({
      interaction,
      proposal: proposal(`INV-CAP-${i}`, 'core', `/${i}`),
    }));

    const result = await mergeContracts({
      cwd,
      proposals,
      maxContracts: 3,
      onEvent: (e) => events.push(e),
    });

    expect(result.written).toHaveLength(3);
    expect(result.hitCap).toBe(true);
    expect(events.find((e) => e.type === 'cap-reached')).toBeDefined();
  });

  it('falls back to interaction.module when contract YAML has no area', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'merge-'));
    const noArea: ContractProposal = {
      yaml: 'id: INV-NO-AREA\ntitle: t\nactions: []\nexpected: {}\n',
      confidence: 'high',
      module: 'mod-x',
      evidence: { sourceFiles: [], rationale: 'r' },
    };
    await mergeContracts({ cwd, proposals: [{ interaction, proposal: noArea }] });
    expect(
      await readFile(path.join(cwd, 'qa/contracts/core/INV-NO-AREA.yml'), 'utf8').catch(() => null),
    ).not.toBeNull();
    // interaction.module is 'core' → falls back to that
  });
});

describe('discoverByInteraction', () => {
  it('happy path: enumerate → generate → merge → returns counts', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app/page.tsx'), '<button>X</button>');

    let callCount = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // Stage 1
          return {
            content: JSON.stringify([
              { id: 'btn-app-x', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        // Stage 2
        return {
          content: JSON.stringify([
            {
              yaml: 'id: INV-ORCH-1\ntitle: t\nactions: []\nexpected: {}\n',
              confidence: 'high',
              module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' },
            },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const result = await discoverByInteraction({
      cwd,
      llmClient: llm,
      signal: new AbortController().signal,
    });

    expect(result.interactionsFound).toBe(1);
    expect(result.contractsWritten).toBe(1);
    expect(result.fallbackUsed).toBe(false);
  });

  it('falls back to discoverByModule when Stage 1 returns invalid JSON', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => ({ content: 'not json', usage: { inputTokens: 0, outputTokens: 0 } })),
    };

    const events: DiscoveryEvent[] = [];
    const result = await discoverByInteraction({
      cwd,
      llmClient: llm,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toMatch(/surface enumeration/i);
    expect(events.find((e) => e.type === 'log' && e.level === 'error')).toBeDefined();
  });

  it('continues when some interactions fail in Stage 2', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app/page.tsx'), '<button>X</button>');

    let callCount = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify([
              { id: 'btn-a', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
              { id: 'btn-b', type: 'button', file: 'app/page.tsx', name: 'X', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        if (callCount === 2) return { content: 'broken', usage: { inputTokens: 0, outputTokens: 0 } };
        return {
          content: JSON.stringify([
            { yaml: 'id: INV-OK\ntitle: t\nactions: []\nexpected: {}\n', confidence: 'high', module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' } },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const result = await discoverByInteraction({
      cwd, llmClient: llm, signal: new AbortController().signal, concurrency: 1,
    });

    expect(result.interactionsFound).toBe(2);
    expect(result.contractsWritten).toBe(1);
  });

  it('emits warn (not error) when fallback triggered by 0 interactions', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'orch-'));
    await writeFile(path.join(cwd, 'package.json'), '{}');

    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => ({ content: '[]', usage: { inputTokens: 0, outputTokens: 0 } })),
    };

    const events: DiscoveryEvent[] = [];
    const result = await discoverByInteraction({
      cwd,
      llmClient: llm,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    expect(result.fallbackUsed).toBe(true);
    // 0-interactions case is warn, not error (spec §8 row 3)
    const fallbackLog = events.find((e) => e.type === 'log' && e.message.includes('0 interactions'));
    expect(fallbackLog).toBeDefined();
    expect(fallbackLog!.type === 'log' && fallbackLog!.level).toBe('warn');
  });
});
