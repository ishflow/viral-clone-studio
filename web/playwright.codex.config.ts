import { defineConfig } from '@playwright/test';
import { E2E_SESSION_SECRET } from './e2e/session';

// Isolated source copy avoids sharing a Next compilation directory with the real-e2e owner.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['reset.spec.ts', 'codex-ui.spec.ts'],
  outputDir: '../scratch-codex/playwright-results',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:3201' },
  webServer: {
    command: 'node scripts/prepare-codex-site.mjs && pnpm exec next dev ../scratch-codex/site -H 127.0.0.1 -p 3201',
    url: 'http://127.0.0.1:3201',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VC_FAKE_SPEED: '20', VC_SESSION_SECRET: E2E_SESSION_SECRET, NEXT_TELEMETRY_DISABLED: '1' },
  },
});
