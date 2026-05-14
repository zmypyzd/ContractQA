import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthProviderName } from '@contractqa/core';

export async function initProject(opts: {
  cwd: string;
  provider: AuthProviderName;
}): Promise<void> {
  const qa = path.join(opts.cwd, 'qa');
  await mkdir(path.join(qa, 'contracts'), { recursive: true });
  await mkdir(path.join(qa, 'adapters'), { recursive: true });
  await writeFile(
    path.join(qa, 'INVARIANTS.md'),
    '# Product Invariants\n\n_(generated, run `contractqa invariants:gen`)_\n',
  );
  await writeFile(
    path.join(qa, 'noise-profile.yml'),
    `project: ${path.basename(opts.cwd)}\ngenerated_at: ${new Date().toISOString()}\nignore: {}\n`,
  );
  await writeFile(
    path.join(opts.cwd, 'contractqa.config.ts'),
    `import { defineConfig } from '@contractqa/runner';
export default defineConfig({
  app: { baseUrl: 'http://localhost:3000', healthCheckUrl: 'http://localhost:3000/api/health' },
  auth: { provider: '${opts.provider}' },
  contracts: { dir: 'qa/contracts', invariants: 'qa/INVARIANTS.md', noiseProfile: 'qa/noise-profile.yml' },
  artifacts: { root: 'artifacts', s3: null },
  pipelines: {
    critical_path: { blocking: true, timeoutSeconds: 300 },
    shadow_fix: { blocking: false, timeoutSeconds: 1800, maxFixAttempts: 3 },
  },
});
`,
  );
}
