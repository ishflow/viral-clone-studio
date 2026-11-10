import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'settings.e2e.ts', outputDir: '/tmp/codext-e2e-results',
  workers: 1, timeout: 120000, expect: { timeout: 15000 }, reporter: [['list']],
  use: { channel: 'chrome' },
});
