import { describe, it, expect } from 'vitest';
import { extractAbiHint } from '../../src/lib/host-probe.js';

describe('extractAbiHint', () => {
  it('parses NODE_MODULE_VERSION mismatch from node stderr', () => {
    const stderr = `Error: The module '/x/build/Release/foo.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 115. This version of Node.js requires
NODE_MODULE_VERSION 127. Please try re-compiling`;
    expect(extractAbiHint(stderr)).toEqual({ built: '115', runtime: '127' });
  });

  it('returns null on unrelated stderr', () => {
    expect(extractAbiHint('something completely different')).toBeNull();
  });
});
