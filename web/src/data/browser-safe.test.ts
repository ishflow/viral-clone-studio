// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = __dirname;
const site = join(root, '..');

/** Every source file under a folder (the data layer, when none is named), without the tests. */
function sources(folder = root): string[] {
  return (readdirSync(folder, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
}

describe('the data layer in a browser bundle', () => {
  // No client component reaches the data layer today, but for the types and constants of `data/ports.ts`:
  // features/checkout/client-bundle.test.ts holds that for every client file under src. Should one import of `@/data` slip into a
  // client file all the same, the whole data layer is bundled for the browser, and a Node module in it stops that bundle
  // ("the chunking context does not support external modules"): every page that uses that client file then fails.
  // So a data file still gets a Node module with `process.getBuiltinModule(...)` inside the function that needs it
  // (see mock/persist.ts), and imports it only for its types.
  it('no data file imports a Node module for its value', () => {
    const broken = sources().filter((file) => /^\s*import\s+(?!type\b)[^;]*?from\s+['"]node:/m.test(readFileSync(join(root, file), 'utf8')));
    expect(broken).toEqual([]);
  });

  // The code of the payment layer is in no browser bundle (the same test). Whatever reaches one later, two things must never be in it:
  // a secret's value (Next writes into a browser bundle only the variables named NEXT_PUBLIC_*), and a tool that makes a Dodo
  // signature (only a test may reach it).
  it('no source file reads a NEXT_PUBLIC_ variable that names a key, a secret, a token or Dodo', () => {
    const leaking = sources(site).filter((file) => /NEXT_PUBLIC_\w*(KEY|SECRET|TOKEN|PASSWORD|DODO)/.test(readFileSync(join(site, file), 'utf8')));
    expect(leaking).toEqual([]);
  });
  it('the tool that signs a Dodo webhook is imported by tests only', () => {
    const importing = sources(site).filter((file) => /dodo-test-helpers|signDodoWebhook/.test(readFileSync(join(site, file), 'utf8')));
    expect(importing).toEqual(['data/real/payments/dodo-test-helpers.ts']);
  });
});
