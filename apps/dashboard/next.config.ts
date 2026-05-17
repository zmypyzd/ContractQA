import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // contractqa (autopilot) transitively imports @contractqa/runner → playwright
  // → fsevents (.node native binary). Webpack can't parse the binary. The fix
  // is to mark every package in the autopilot dependency tree as a server-side
  // external so Node loads them via require() at runtime instead of webpack
  // bundling them. serverExternalPackages only catches direct imports, so we
  // also use the webpack hook below to externalize anything matching a regex.
  serverExternalPackages: [
    'contractqa',
    '@contractqa/orchestrator',
    '@contractqa/runner',
    '@contractqa/core',
    '@contractqa/adapters',
    '@contractqa/probes',
    '@contractqa/oracle',
    '@contractqa/evidence',
    '@contractqa/repro',
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/sdk',
    'openai',
    'playwright',
    'playwright-core',
    '@playwright/test',
    'fsevents',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Refuse to bundle anything reached transitively from playwright /
      // @contractqa/* / native modules. The function form of `externals`
      // intercepts every resolve request webpack does on the server.
      const skip = [
        /^playwright(-core)?$/,
        /^@playwright\/test$/,
        /^fsevents$/,
        /^contractqa$/,
        /^@contractqa\//,
        /^@anthropic-ai\//,
        /^openai$/,
        /\.node$/,
      ];
      const original = config.externals;
      const externalsList = Array.isArray(original) ? original : original ? [original] : [];
      externalsList.push(({ request }: { request?: string }, callback: (err: unknown, result?: string) => void) => {
        if (request && skip.some((re) => re.test(request))) {
          return callback(null, `commonjs ${request}`);
        }
        callback(null);
      });
      config.externals = externalsList;
    }
    return config;
  },
};

export default nextConfig;
