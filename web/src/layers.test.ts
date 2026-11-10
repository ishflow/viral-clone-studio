// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = __dirname;

// Spec §15: what each layer must not know. `core` reads the session user through `data`, so that pair is allowed.
const FORBIDDEN: Record<string, string[]> = {
  core: ['shared', 'features', 'app'],
  shared: ['data', 'features', 'app'],
  data: ['shared', 'features', 'app'],
  features: ['app'],
};

/** Every source file of a layer. Tests are left out: a test may reach up to the route it checks. */
function sources(layer: string): string[] {
  return (readdirSync(join(root, layer), { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => `${layer}/${file}`);
}

/** The `@/…` paths a file imports (layers are always crossed through the alias). */
function imports(file: string): string[] {
  const source = readFileSync(join(root, file), 'utf8');
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]@\/([^'"]+)['"]/g)].map((match) => match[1]!);
}

describe('layers', () => {
  for (const [layer, forbidden] of Object.entries(FORBIDDEN)) {
    it(`${layer} does not import ${forbidden.join(', ')}`, () => {
      const broken = sources(layer).flatMap((file) =>
        imports(file).filter((path) => forbidden.includes(path.split('/')[0]!)).map((path) => `${file} → @/${path}`));
      expect(broken).toEqual([]);
    });
  }

  it('a feature does not import another feature', () => {
    const broken = sources('features').flatMap((file) => {
      const own = file.split('/')[1];
      return imports(file)
        .filter((path) => path.startsWith('features/') && path.split('/')[1] !== own)
        .map((path) => `${file} → @/${path}`);
    });
    expect(broken).toEqual([]);
  });
});
