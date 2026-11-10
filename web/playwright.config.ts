import { defineConfig } from "@playwright/test";
import { E2E_SESSION_SECRET } from "./e2e/session";

// Another port when 3100 is taken: `VC_E2E_PORT=3116 NEXT_DIST_DIR=.next-e2e pnpm e2e`. A second `next dev` needs its own build dir, and
// with one `next dev` adds that dir to tsconfig.json `include` and points next-env.d.ts at it: take those two edits back afterwards.
const PORT = Number(process.env.VC_E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // The fake store lives in the memory of the one dev server and every test resets it: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { channel: "chrome", baseURL: `http://localhost:${PORT}` },
  webServer: {
    // The default build dir (`.next/dev`): `next dev` then leaves tsconfig.json alone.
    command: `pnpm dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    // 20× fake time: a job finishes in about 2 seconds, a template made from a link is ready in 1.
    // The session secret is the one e2e/session.ts signs the test cookies with. The fixture accounts log in with the documented dev password
    // (demo-password; VC_DEV_PASSWORD overrides it).
    // VC_FAKE_SWAP: the fixtures hold a person-swap video and person swap is switched on (e2e/swap.spec.ts); the admin's Settings screen
    // switches it off and on again (e2e/swap-flag.spec.ts).
    env: { VC_FAKE_SPEED: "20", VC_SESSION_SECRET: E2E_SESSION_SECRET, VC_FAKE_SWAP: "1" },
  },
});
