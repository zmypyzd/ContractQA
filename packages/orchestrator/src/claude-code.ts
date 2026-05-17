import { spawn as nodeSpawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { LLMClient } from './llm/index.js';

export interface ClaudeFixInput {
  promptPath: string;
  cwd: string;
  allowedTools: string[];
  /**
   * Injectable LLMClient. When provided, the fix call goes through
   * `LLMClient.generate()` instead of spawning `claude --bare -p`.
   * Preferred over `spawn` for new callers. `spawn` is kept for backward
   * compatibility with existing integrations and tests.
   */
  llmClient?: LLMClient;
  /** AbortSignal forwarded to llmClient.generate(). */
  signal?: AbortSignal;
  /**
   * Injectable spawn function. Only used when `llmClient` is NOT provided.
   * Kept for backward compatibility.
   */
  spawn?: (
    cmd: string,
    args: string[],
    opts: { cwd: string },
  ) => Promise<{ exitCode: number; stdout: string }>;
  claudeBin?: string;
}

export interface ClaudeFixResult {
  root_cause?: string;
  files_changed?: string[];
  tests_run?: string[];
  validation_result: 'PASS' | 'FAIL' | 'PARSE_ERROR';
  proposed_contract_revision?: unknown;
  /** Unified diff of changes made by the fix. Populated when LLMClient path is used. */
  patch_diff?: string;
  raw_stdout: string;
}

const SYSTEM_PROMPT =
  'You are Claude Code working in a git worktree to fix a failing contract test. ' +
  'Read the prompt file carefully, apply a minimal fix to the production code, ' +
  'run the failing repro, and respond with a JSON object containing:\n' +
  '  root_cause (string), files_changed (string[]), tests_run (string[]),\n' +
  '  validation_result ("PASS"|"FAIL"|"PARSE_ERROR"),\n' +
  '  patch_diff (string, unified diff of your changes, optional),\n' +
  '  proposed_contract_revision (object, only if the contract itself is wrong).\n' +
  'Respond with ONLY the JSON object — no markdown fences, no prose.';

export async function runClaudeFix(i: ClaudeFixInput): Promise<ClaudeFixResult> {
  // Prefer LLMClient path when provided
  if (i.llmClient) {
    return runViaLLMClient(i, i.llmClient);
  }
  return runViaSpawn(i);
}

async function runViaLLMClient(
  i: ClaudeFixInput,
  llm: LLMClient,
): Promise<ClaudeFixResult> {
  let promptText: string;
  try {
    promptText = await readFile(i.promptPath, 'utf8');
  } catch (err) {
    return {
      validation_result: 'FAIL',
      raw_stdout: `Failed to read prompt file: ${(err as Error).message}`,
    };
  }

  let content: string;
  try {
    const result = await llm.generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: promptText }],
      signal: i.signal,
    });
    content = result.content;
  } catch (err) {
    return {
      validation_result: 'FAIL',
      raw_stdout: `LLM call failed: ${(err as Error).message}`,
    };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      ...parsed,
      validation_result: parsed.validation_result ?? 'PASS',
      raw_stdout: content,
    };
  } catch {
    return { validation_result: 'PARSE_ERROR', raw_stdout: content };
  }
}

async function runViaSpawn(i: ClaudeFixInput): Promise<ClaudeFixResult> {
  const run = i.spawn ?? defaultSpawn;
  const args = [
    '--bare',
    '-p',
    i.promptPath,
    '--allowedTools',
    i.allowedTools.join(','),
    '--output-format',
    'json',
  ];
  const { exitCode, stdout } = await run(i.claudeBin ?? 'claude', args, { cwd: i.cwd });
  if (exitCode !== 0) return { validation_result: 'FAIL', raw_stdout: stdout };
  try {
    const parsed = JSON.parse(stdout);
    return {
      ...parsed,
      validation_result: parsed.validation_result ?? 'PASS',
      raw_stdout: stdout,
    };
  } catch {
    return { validation_result: 'PARSE_ERROR', raw_stdout: stdout };
  }
}

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string }) {
  return new Promise<{ exitCode: number; stdout: string }>((resolve) => {
    const proc = nodeSpawn(cmd, args, { cwd: opts.cwd });
    let stdout = '';
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.on('exit', (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}
