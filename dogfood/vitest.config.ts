import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 180_000,
  },
});
