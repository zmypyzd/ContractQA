// NOTE: This e2e verifies preflight + watch-loop startup against the stub gh.
// To exercise the full fix → commit → PR path, an LLM stub must be wired via
// the orchestrator's `LLMClient` injection. Tracked: see future plan for
// `contractqa autopilot --watch --auto-pr --llm-recording <fixture>` (a
// RecordingLLMClient already exists at packages/orchestrator/src/llm/recording-client.ts).
//
// LIMITATION: Without an LLM stub, the test only verifies that:
//   1. The watch loop starts without unhandled-rejection errors.
//   2. Preflight ran: `gh --version` and `gh auth status` were called via stub.
// The full fix → commit → PR path is NOT exercised here.

import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('autopilot --watch --auto-pr end-to-end with stub gh', () => {
  it(
    'runs preflight (gh --version + gh auth status called via stub) and starts watch loop without crash',
    async () => {
      // Both tmp (git repo) and auxDir (stub-bin + log) live in the OS temp dir.
      // auxDir is NOT inside tmp, so autopilot's `git stash push -u` cannot stash
      // our stub log or stub binary.
      const tmp = await mkdtemp(path.join(tmpdir(), 'night-shift-e2e-'));
      const auxDir = await mkdtemp(path.join(tmpdir(), 'night-shift-aux-'));
      const stubLog = path.join(auxDir, 'gh-stub-calls.log');
      try {
        // 1. Initialize a tiny git repo with a package.json so autopilot bootstrap passes.
        await runShell('git init -b main', tmp);
        await runShell('git remote add origin git@github.com:stub/repo.git', tmp);
        await writeFile(path.join(tmp, 'README.md'), 'fixture\n');
        // Minimal package.json so autopilot bootstrap doesn't fail before preflight assertions.
        await writeFile(
          path.join(tmp, 'package.json'),
          JSON.stringify({ name: 'e2e-fixture', version: '0.0.0', private: true }),
        );
        await runShell(
          'git add . && git -c user.email=test@e.com -c user.name=t commit -m init',
          tmp,
        );

        await mkdir(path.join(tmp, 'qa/contracts/_smoke'), { recursive: true });
        await writeFile(
          path.join(tmp, 'qa/contracts/_smoke/will-fail.yml'),
          `id: will-fail
description: always fails (port 1 never listens)
http:
  request: { method: GET, url: "http://127.0.0.1:1/nope" }
  expect: { status: 200 }
`,
        );

        // 2. Prepare PATH with stub gh using Node's fs.symlink (no shell needed).
        // stub-bin lives in auxDir (outside the git repo) so `git stash -u` can't touch it.
        const stubBin = path.join(auxDir, 'bin');
        await mkdir(stubBin);
        const stubGh = path.resolve(__dirname, 'stub-gh.sh');
        // Use fs.symlink directly (avoids shell quoting issues).
        await symlink(stubGh, path.join(stubBin, 'gh'));

        const cliPath = path.resolve(__dirname, '../packages/cli/dist/bin/contractqa.js');

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          PATH: `${stubBin}:${process.env.PATH}`,
          GH_STUB_LOG: stubLog,
          // No ANTHROPIC_API_KEY is set deliberately — the test verifies preflight
          // only (preflight runs before any LLM is invoked). Without an LLM key
          // the watch loop will start, run preflight, then error on the first
          // attempt to fix a failing contract. That's expected and acceptable.
        };

        // 3. Spawn: run for ~8 seconds then SIGINT + SIGKILL fallback.
        const child = spawn(
          'node',
          [cliPath, 'autopilot', '--watch', '--auto-pr', '--yes', '--time-budget', '5000'],
          {
            cwd: tmp,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let combinedOutput = '';
        child.stdout.on('data', (d) => (combinedOutput += d.toString()));
        child.stderr.on('data', (d) => (combinedOutput += d.toString()));

        // Wait 8 seconds — enough time for preflight + watch loop to start.
        await new Promise<void>((r) => setTimeout(r, 8_000));

        // Send SIGINT to trigger graceful shutdown.
        child.kill('SIGINT');

        // Wait up to 5 seconds for clean exit; SIGKILL if it hangs.
        await new Promise<void>((r) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            r();
          }, 5_000);
          child.on('exit', () => {
            clearTimeout(timer);
            r();
          });
        });

        // 4. Assert stub gh was called for preflight.
        let log = '';
        try {
          log = await readFile(stubLog, 'utf8');
        } catch {
          // If the log file doesn't exist, the assertions below will fail with a clear message.
          log = '';
        }

        // Preflight always calls these two regardless of contract outcomes.
        expect(log, `stub-gh log should contain --version call; combined output:\n${combinedOutput}`).toContain('--version');
        expect(log, `stub-gh log should contain "auth status" call; combined output:\n${combinedOutput}`).toContain('auth status');

        // Ensure no unhandled-rejection text leaked from Node runtime.
        expect(
          combinedOutput,
          'Should not have unhandledRejection in output',
        ).not.toContain('UnhandledPromiseRejection');

        // NOTE: `pr create` assertion is intentionally omitted because the LLM
        // stub is not wired — the test verifies preflight only. See file header.
      } finally {
        await rm(tmp, { recursive: true, force: true });
        // auxDir holds stub-bin + log (outside the git repo), clean it up too.
        await rm(auxDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

function runShell(cmd: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', cmd], { cwd, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} → ${code}`))));
  });
}
