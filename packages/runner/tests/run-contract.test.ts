import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runContract } from '../src/run-contract.js';
import type { ContractDoc } from '@contractqa/core';

const contract: ContractDoc = {
  id: 'INV-T1',
  title: 'tiny',
  area: 'test',
  severity: 'P2',
  owner: 'test',
  risk_tags: [],
  preconditions: { auth_state: 'anonymous' },
  actions: [{ type: 'goto', path: '/' }],
  expected: { url: { matches: '^/$' } },
  verification: { wait_ms: 0, retries: 0, evidence_required: ['state_diff'] },
};

function fakePage(url: string) {
  const locator: any = {
    click: async () => undefined,
    fill: async () => undefined,
    first() { return locator; },
    getByRole() { return locator; },
  };
  return {
    url: () => url,
    title: async () => 't',
    viewportSize: () => ({ width: 1, height: 1 }),
    screenshot: async () => Buffer.from([0]),
    content: async () => '<html></html>',
    // In a real Playwright page, evaluate serializes the fn and runs it in
    // the browser. Our fake stubs that boundary — Object.keys(localStorage)
    // is undefined in node, so we substitute an empty result.
    evaluate: async (_fn: any) => {
      try {
        return _fn();
      } catch {
        return [];
      }
    },
    context: () => ({ cookies: async () => [] }),
    on: () => undefined,
    goto: async () => undefined,
    getByRole: () => locator,
    waitForTimeout: async () => undefined,
  };
}

describe('runContract', () => {
  it('runs end-to-end and returns a verdict + bundle dir on PASS + alwaysBundle', async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'run-contract-test-'));
    try {
      const result = await runContract({
        contract,
        page: fakePage('http://localhost:3000/') as any,
        stripBaseUrl: 'http://localhost:3000',
        noise: {
          project: 't',
          generated_at: '2026-05-14T00:00:00Z',
          ignore: {
            localStorage_keys: [],
            sessionStorage_keys: [],
            cookies: [],
            network_url_patterns: [],
            console_patterns: [],
          },
        },
        artifactsRoot: path.join(scratch, 'artifacts'),
        tracePath: path.join(scratch, 'trace.zip'),
        harPath: path.join(scratch, 'net.har'),
        screenshotPaths: { before: path.join(scratch, 'b.png'), after: path.join(scratch, 'a.png') },
        attachments: [],
        alwaysBundle: true,
        readFile: vi.fn(async () => Buffer.from([0])) as any,
      });
      expect(result.verdict.verdict).toBe('PASS');
      expect(result.runId).toContain('INV-T1');
      expect(result.bundleDir).toContain('runs/');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('skips bundle on PASS when alwaysBundle is not set', async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'run-contract-test-'));
    try {
      const result = await runContract({
        contract,
        page: fakePage('http://localhost:3000/') as any,
        stripBaseUrl: 'http://localhost:3000',
        noise: {
          project: 't',
          generated_at: '2026-05-14T00:00:00Z',
          ignore: {
            localStorage_keys: [],
            sessionStorage_keys: [],
            cookies: [],
            network_url_patterns: [],
            console_patterns: [],
          },
        },
        artifactsRoot: path.join(scratch, 'artifacts'),
        tracePath: path.join(scratch, 'trace.zip'),
        harPath: path.join(scratch, 'net.har'),
        screenshotPaths: { before: path.join(scratch, 'b.png'), after: path.join(scratch, 'a.png') },
        attachments: [],
      });
      expect(result.verdict.verdict).toBe('PASS');
      expect(result.bundleDir).toBeNull();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
