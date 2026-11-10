import { defineConfig } from 'vitest/config';

// `pnpm test`: the fast tests. `pnpm test:render`: the tests that start a real HyperFrames render (`*.render.test.ts`), one file at a time.
const render = process.env.VE_RENDER === '1';

export default defineConfig({
  test: render
    ? { include: ['src/**/*.render.test.ts'], environment: 'node', globalSetup: ['src/testing/global-setup.ts'], testTimeout: 300_000, hookTimeout: 300_000, fileParallelism: false }
    : { include: ['src/**/*.test.ts'], exclude: ['src/**/*.render.test.ts', 'node_modules/**'], environment: 'node', globalSetup: ['src/testing/global-setup.ts'] },
});
