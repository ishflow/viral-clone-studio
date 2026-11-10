import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const ROUTE_ERROR = join(SRC, 'app/(site)/(browse)/gallery/error.tsx');
const DATA_LAYER = /^@\/data(\/(?!ports$)|$)/;
const IMPORT = /^\s*(?:import|export)\s(?!type\b)[^;]*?from\s+'([^']+)'/gm;

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

describe('gallery client components stay clear of the data layer', () => {
  const clients = [...readdirSync(__dirname)
    .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
    .map((f) => join(__dirname, f)), ROUTE_ERROR]
    .filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));

  it('finds the client files', () => expect(clients.length).toBeGreaterThan(3));

  it.each(clients.map((f) => [f.slice(__dirname.length + 1), f] as const))('%s', (_n, file) => {
    expect(reachesData(file)).toBeNull();
  });
});
