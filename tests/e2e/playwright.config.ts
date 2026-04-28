import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.MINDOS_URL ?? 'http://localhost:3456',
    screenshot: 'only-on-failure',
  },
  outputDir: './results',
  webServer: undefined, // assume dev server is already running
});
