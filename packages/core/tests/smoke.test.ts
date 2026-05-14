import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@contractqa/core', () => {
  it('exposes a VERSION string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
