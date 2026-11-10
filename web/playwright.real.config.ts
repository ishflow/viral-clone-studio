import { defineConfig } from "@playwright/test";

// The real end-to-end: the site (production build, NEXT_DIST_DIR=.next-real) + the real worker with the fake provider, started by the
// specs themselves (e2e/real/world.ts). Build first: `NEXT_DIST_DIR=.next-real pnpm build`. Run: `pnpm real:e2e` (port 3200).
export default defineConfig({
  testDir: "./e2e/real",
  outputDir: "./test-results-real",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { channel: "chrome", baseURL: "http://127.0.0.1:3200", actionTimeout: 15_000, navigationTimeout: 30_000 },
});
