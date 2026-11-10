import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

// Offline source copy for the Codex browser checks. Never changes the shared tsconfig or installed dependencies.
const source = fileURLToPath(new URL('..', import.meta.url));
const repository = resolve(source, '..');
const target = join(repository, 'scratch-codex', 'site');
mkdirSync(target, { recursive: true });
for (const name of ['src', 'public', 'package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'next-env.d.ts', 'vitest.setup.ts']) {
  if (existsSync(join(source, name))) cpSync(join(source, name), join(target, name), { recursive: true });
}
if (!existsSync(join(target, 'node_modules'))) symlinkSync(join(source, 'node_modules'), join(target, 'node_modules'), 'dir');
const config = join(target, 'next.config.ts');
writeFileSync(config, readFileSync(config, 'utf8').replace('const nextConfig: NextConfig = {', `const nextConfig: NextConfig = {\n  turbopack: { root: ${JSON.stringify(repository)} },`));
