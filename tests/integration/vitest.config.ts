import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    testTimeout: 15_000,
    env: {
      MINDOS_URL: process.env.MINDOS_URL ?? 'http://localhost:3456',
    },
  },
});
