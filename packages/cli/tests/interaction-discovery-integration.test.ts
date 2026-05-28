import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, cp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverByInteraction } from '../src/autopilot/interaction-discovery.js';
import type { LLMClient } from '@contractqa/orchestrator/llm';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures/interaction-discovery');

describe('discoverByInteraction integration', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'deep-fixture-'));
    await cp(FIXTURE, cwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  });

  it('walks fixture, enumerates 3 interactions, writes 3 contracts', async () => {
    let callIdx = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          // Stage 1: 3 interactions matching the fixture
          return {
            content: JSON.stringify([
              { id: 'btn-app-greet', type: 'button', file: 'app/page.tsx', name: 'Greet', module: 'app', rationale: 'main CTA' },
              { id: 'form-login-signin', type: 'form', file: 'app/login/page.tsx', name: 'Sign in', module: 'auth', rationale: 'login form' },
              { id: 'api-runs-post', type: 'api-endpoint', file: 'api/runs/route.ts', name: 'POST /api/runs', module: 'api', route: '/api/runs', rationale: 'create run' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        // Stage 2: 1 proposal per interaction with unique id
        const id = `INV-${callIdx - 1}`;
        const area = callIdx === 2 ? 'app' : callIdx === 3 ? 'auth' : 'api';
        return {
          content: JSON.stringify([
            {
              yaml: `id: ${id}\ntitle: t-${id}\narea: ${area}\nactions:\n  - {type: goto, path: /${callIdx}}\nexpected:\n  url: { matches: "/${callIdx}" }\n`,
              confidence: 'high',
              module: area,
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
      concurrency: 1,  // deterministic ordering for callIdx assertions
      enableReflexion: false,  // test counts Stage 2 outputs exactly
    });

    expect(result.interactionsFound).toBe(3);
    expect(result.contractsWritten).toBe(3);
    expect(result.fallbackUsed).toBe(false);

    // Verify the 3 YAMLs landed at expected paths
    const appFiles = await readdir(path.join(cwd, 'qa/contracts/app'));
    const authFiles = await readdir(path.join(cwd, 'qa/contracts/auth'));
    const apiFiles = await readdir(path.join(cwd, 'qa/contracts/api'));
    expect(appFiles).toContain('INV-1.yml');
    expect(authFiles).toContain('INV-2.yml');
    expect(apiFiles).toContain('INV-3.yml');

    // Verify generated-by frontmatter
    const written = await readFile(path.join(cwd, 'qa/contracts/app/INV-1.yml'), 'utf8');
    expect(written).toContain('# generated-by: deep-discovery v1');
    expect(written).toContain('# interaction: btn-app-greet');
  });

  it('re-run produces 0 new contracts (dedup works)', async () => {
    // Same LLM stub as above — first run writes, second should skip all 3
    let callIdx = 0;
    const llm: LLMClient = {
      providerName: 'anthropic-sdk',
      modelHint: 'test',
      generate: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1 || callIdx === 5) {
          // Stage 1 of each run
          return {
            content: JSON.stringify([
              { id: 'btn-x', type: 'button', file: 'app/page.tsx', name: 'Greet', module: 'app', rationale: 'r' },
            ]),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return {
          content: JSON.stringify([
            { yaml: 'id: INV-DEDUPE\ntitle: t\nactions: []\nexpected: {}\n', confidence: 'high', module: 'app',
              evidence: { sourceFiles: [], rationale: 'r' } },
          ]),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const first = await discoverByInteraction({ cwd, llmClient: llm, signal: new AbortController().signal, concurrency: 1 });
    expect(first.contractsWritten).toBe(1);

    // Run again — should write 0
    callIdx = 4;  // reset so callIdx === 5 hits Stage 1 again
    const second = await discoverByInteraction({ cwd, llmClient: llm, signal: new AbortController().signal, concurrency: 1 });
    expect(second.contractsWritten).toBe(0);
  });
});
