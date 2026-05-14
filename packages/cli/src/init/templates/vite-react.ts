import type { TemplateInput, TemplateOutput } from './index.js';
import { pickProvider } from './index.js';
import { smokeContract, authAdapterFile } from './_shared.js';

const BASE_URL = 'http://localhost:5173';
const HEALTH = '/';

export function viteReactTemplate(input: TemplateInput): TemplateOutput {
  const provider = pickProvider(input.authSignals);
  return {
    files: {
      'contractqa.config.ts': `import { defineConfig } from '@contractqa/runner';
export default defineConfig({
  app: { baseUrl: '${BASE_URL}', healthCheckUrl: '${BASE_URL}${HEALTH}' },
  auth: { provider: '${provider}' },
  contracts: { dir: 'qa/contracts', invariants: 'qa/INVARIANTS.md', noiseProfile: 'qa/noise-profile.yml' },
  artifacts: { root: 'artifacts', s3: null },
  pipelines: {
    critical_path: { blocking: true, timeoutSeconds: 300 },
    shadow_fix: { blocking: false, timeoutSeconds: 1800, maxFixAttempts: 3 },
  },
});
`,
      'qa/contracts/smoke.contract.yaml': smokeContract(input),
      'qa/adapters/app.ts': `import type { AppAdapter } from '@contractqa/adapters/public';
export const app: AppAdapter = {
  baseUrl: '${BASE_URL}',
  healthCheckUrl: '${BASE_URL}${HEALTH}',
  async resetState() { /* fill in for your DB reset hook */ },
  async seed() { /* fill in for fixture loading */ },
};
`,
      'qa/adapters/auth.ts': authAdapterFile(provider, BASE_URL),
      'qa/INVARIANTS.md': `# Product Invariants\n\n_(generated, run \`contractqa invariants:gen\`)_\n`,
      'qa/noise-profile.yml': `project: ${input.projectName}\ngenerated_at: ${new Date().toISOString()}\nignore: {}\n`,
    },
  };
}
