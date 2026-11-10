import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const DATA_LAYER = /^@\/data(\/(?!ports$)|$)/;
// A value import in any form it is written in: either kind of quote, with names (`import … from`, `export … from`) or bare (`import 'x'`).
const IMPORT = /^\s*(?:import|export)\s(?!type\b)(?:[^;]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveFile(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { readFileSync(c); return c; } catch { /* next candidate */ }
  }
  return null;
}

/** The first chain of value imports from `file` that reaches the data layer, else null ('use server' files end the walk). */
function reachesData(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  if (/^\s*['"]use server['"]/m.test(text)) return null;
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1]!;
    if (DATA_LAYER.test(spec)) return [file, spec];
    const next = resolveFile(spec, file);
    const chain = next && reachesData(next, seen);
    if (chain) return [file, ...chain];
  }
  return null;
}

describe('what counts as a value import', () => {
  const found = (text: string) => [...text.matchAll(IMPORT)].map((m) => m[1]);
  it('every form a file can be pulled into a bundle by: either kind of quote, a bare import with no names, a re-export, names over several lines', () => {
    expect(found("import { a } from '@/data';")).toEqual(['@/data']);
    expect(found('import { a } from "@/data";')).toEqual(['@/data']);
    expect(found("import '@/data/real/payments-gateway';")).toEqual(['@/data/real/payments-gateway']);
    expect(found('  import "@/data";')).toEqual(['@/data']);
    expect(found('export * from "./load";\nexport { a } from \'./b\';')).toEqual(['./load', './b']);
    expect(found("import {\n  a,\n  b,\n} from \"./many\";")).toEqual(['./many']);
  });
  it('a type import brings no code, and a line that only looks like an import is none', () => {
    expect(found("import type { A } from '@/data';\nexport type { B } from \"@/data\";")).toEqual([]);
    expect(found("export const from = 'x';\nconst important = \"@/data\";")).toEqual([]);
  });
});

// Every client file of the site, not of this feature alone: whatever one of them imports for its value ends up in a browser bundle.
describe('client components stay clear of the data layer', () => {
  const clients = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => join(SRC, f))
    .filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));

  it('finds the client files', () => expect(clients.length).toBeGreaterThan(100));

  it.each(clients.map((f) => [f.slice(SRC.length + 1), f] as const))('%s', (_n, file) => {
    expect(reachesData(file)).toBeNull();
  });
});
