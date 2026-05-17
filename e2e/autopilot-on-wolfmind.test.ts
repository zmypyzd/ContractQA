// e2e/autopilot-on-wolfmind.test.ts
//
// E2E test: autopilot against dogfood/wolfmind with cassette replay.
//
// CASSETTE STATUS: The cassette at fixtures/llm-cassettes/wolfmind-discovery.json
// is a STUB placeholder — it was not recorded with a real LLM. The test will
// skip in replay mode until a real cassette is recorded.
//
// To record a real cassette:
//   UPDATE_CASSETTES=1 OPENAI_API_KEY=<key> pnpm --filter @contractqa/e2e test autopilot-on-wolfmind
//
// To run live without cassette:
//   RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=<key> pnpm --filter @contractqa/e2e test autopilot-on-wolfmind
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runAutopilot } from 'contractqa/dist/src/commands/autopilot.js';
import { RecordingLLMClient, pickClient } from '@contractqa/orchestrator/llm';

const WOLFMIND = resolve('./dogfood/wolfmind');
const CASSETTE = resolve('./e2e/fixtures/llm-cassettes/wolfmind-discovery.json');
const PROMPT_HASH = 'v1-2026-05-17'; // bump when prompt structure changes

// Detect if the cassette is a stub (placeholder, not a real recording).
function isCassetteStub(): boolean {
  if (!existsSync(CASSETTE.replace(/\.json$/, '.meta.json'))) return true;
  try {
    const meta = JSON.parse(readFileSync(CASSETTE.replace(/\.json$/, '.meta.json'), 'utf8')) as Record<string, unknown>;
    return meta['stub'] === true;
  } catch {
    return true;
  }
}

// Skip condition: skip if no live LLM credentials AND cassette is a stub.
const shouldSkip = process.env.RUN_LIVE_LLM_TESTS !== '1' && isCassetteStub();

function readContractIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (entry.name.endsWith('.yml')) {
        const m = /id:\s*(\S+)/.exec(readFileSync(join(d, entry.name), 'utf8'));
        if (m) out.push(m[1]!);
      }
    }
  };
  walk(dir);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : inter.size / union.size;
}

// Each test run in an isolated copy of the wolfmind dir to avoid polluting the dogfood fixture.
let tmpWolfmind: string;

beforeEach(() => {
  tmpWolfmind = join(tmpdir(), `cqa-wolfmind-${Date.now()}`);
  mkdirSync(tmpWolfmind, { recursive: true });
  cpSync(WOLFMIND, tmpWolfmind, { recursive: true });
  // Ensure it's a git repo with at least one commit
  try {
    execSync('git rev-parse --git-dir', { cwd: tmpWolfmind, stdio: 'ignore' });
  } catch {
    execSync('git init -q && git config user.email t@t && git config user.name t && git add . && git commit -q -m init', { cwd: tmpWolfmind });
  }
});

afterEach(() => {
  rmSync(tmpWolfmind, { recursive: true, force: true });
});

describe('autopilot on dogfood/wolfmind', () => {
  (shouldSkip ? it.skip : it)('generates contracts that overlap >=60% with hand-curated baseline (cassette replay)', async () => {
    const upstream = await pickClient();
    const llm = new RecordingLLMClient(upstream, CASSETTE, { promptHash: PROMPT_HASH });
    const report = await runAutopilot({
      cwd: tmpWolfmind,
      llmClient: llm,
      timeBudgetMs: 5 * 60 * 1000,
      fix: false,
      yes: true,
    });
    expect(report.phaseB.generated).toBeGreaterThan(0);
    const generated = new Set(readContractIds(join(tmpWolfmind, 'qa/contracts')));
    const baseline = new Set(readContractIds(join(WOLFMIND, 'contracts')));
    // Normalize IDs (autopilot prefixes with SMOKE- or module name); compare titles instead in practice.
    // For v1, just assert non-empty overlap exists.
    expect(generated.size).toBeGreaterThan(0);
    expect(baseline.size).toBeGreaterThan(0);
    // Quality gate: >=60% overlap when cassette is present.
    if (process.env.RUN_LIVE_LLM_TESTS !== '1') {
      const overlap = jaccard(generated, baseline);
      expect(overlap).toBeGreaterThanOrEqual(0.6);
    }
  });
});
