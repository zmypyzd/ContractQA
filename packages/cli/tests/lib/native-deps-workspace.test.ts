import { describe, it, expect } from 'vitest';
import { detectNativeDepMismatch } from '../../src/lib/native-deps.js';

describe('detectNativeDepMismatch (workspace + ABI-aware)', () => {
  it('flags a binding whose built ABI differs from runtime', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [
        { path: '/n_m/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node', abi: '115' },
      ],
      _runtimeAbi: '127',
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      binding: 'better_sqlite3.node',
      builtAbi: '115',
      runtimeAbi: '127',
    });
    expect(r[0].suggestion).toMatch(/cd .* && npm run install/);
  });

  it('omits a binding whose built ABI matches runtime', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [{ path: '/n_m/foo/foo.node', abi: '127' }],
      _runtimeAbi: '127',
    });
    expect(r).toEqual([]);
  });

  it('suggestion command points at the .pnpm package dir, not target root', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [{ path: '/repo/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node', abi: '115' }],
      _runtimeAbi: '127',
    });
    expect(r[0].suggestion).toContain('/repo/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3');
    expect(r[0].suggestion).toContain('npm run install');
  });

  it('derives the correct pkg dir for scoped packages', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [{
        path: '/repo/node_modules/.pnpm/@mapbox+node-pre-gyp@1.0.0/node_modules/@mapbox/node-pre-gyp/build/Release/foo.node',
        abi: '115',
      }],
      _runtimeAbi: '127',
    });
    expect(r[0].suggestion).toContain('/repo/node_modules/.pnpm/@mapbox+node-pre-gyp@1.0.0/node_modules/@mapbox/node-pre-gyp');
  });

  it('falls back to dirname-walk for non-pnpm node_modules layouts', async () => {
    const r = await detectNativeDepMismatch('/unused', {
      _stubFiles: [{
        path: '/proj/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
        abi: '115',
      }],
      _runtimeAbi: '127',
    });
    expect(r[0].suggestion).toContain('/proj/node_modules/better-sqlite3');
  });
});
