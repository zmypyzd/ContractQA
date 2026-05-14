import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
