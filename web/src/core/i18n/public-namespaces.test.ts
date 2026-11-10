// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMessages, otherMessages, PUBLIC_NAMESPACES, publicMessages, REGISTERED_NAMESPACES } from './messages';

const SRC = resolve(__dirname, '../..');
const NAMESPACES = REGISTERED_NAMESPACES('en');

/** The public pages: every route under `(site)`, plus what the root layout renders around any page (error, forbidden, not-found, global-error). */
const ENTRIES = [
  ...(readdirSync(join(SRC, 'app/(site)'), { recursive: true }) as string[]).map((file) => join('app/(site)', file)),
  'app/layout.tsx',
  'app/error.tsx',
  'app/forbidden.tsx',
  'app/not-found.tsx',
  'app/global-error.tsx',
].filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

function resolveFile(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(join(SRC, from)), spec) : null;
  if (!base) return null;
  const found = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')].find((file) => existsSync(file) && statSync(file).isFile());
  return found?.startsWith(`${SRC}/`) ? found.slice(SRC.length + 1) : null;
}

const names = (clause: string) => clause.split(',').map((part) => part.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0]!.trim()).filter(Boolean);

/**
 * Every file a public page can load. A barrel (`index.ts` made only of `export … from`) hands on only the files of the names asked of it,
 * so a page that takes `startCheckout` from the checkout barrel does not count the checkout views.
 */
function reachable(): Set<string> {
  const seen = new Set<string>();
  const queue: { file: string; wanted: string[] | null }[] = ENTRIES.map((file) => ({ file, wanted: null }));
  while (queue.length) {
    const { file, wanted } = queue.pop()!;
    const source = readFileSync(join(SRC, file), 'utf8');
    const barrel = wanted && /^index\.tsx?$/.test(file.split('/').at(-1)!) && !/^(import|const|function|export (const|function|default))/m.test(source);
    if (barrel) {
      for (const [, clause, spec] of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
        const target = resolveFile(file, spec!);
        if (target && names(clause!).some((name) => wanted.includes(name))) queue.push({ file: target, wanted: null });
      }
      for (const [, spec] of source.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) {
        const target = resolveFile(file, spec!);
        if (target) queue.push({ file: target, wanted: null });
      }
      continue;
    }
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, clause, spec] of source.matchAll(/import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?(?:\{([^}]*)\}|[\w$*\s]+)?\s*(?:from)?\s*'([^']+)'/g)) {
      const target = resolveFile(file, spec!);
      if (target && !/\.test\./.test(target)) queue.push({ file: target, wanted: clause === undefined ? null : names(clause) });
    }
    for (const [, spec] of source.matchAll(/import\(\s*'([^']+)'\s*\)/g)) {
      const target = resolveFile(file, spec!);
      if (target) queue.push({ file: target, wanted: null });
    }
  }
  return seen;
}

describe('the messages sent with the public pages', () => {
  it('keep to namespaces the public pages use: no file they load names a key of any other namespace', () => {
    const others = NAMESPACES.filter((ns) => !PUBLIC_NAMESPACES.includes(ns));
    const pattern = new RegExp(`['"\`](${others.join('|')})\\.[\\w.$\\{]`, 'g');
    const found = [...reachable()].flatMap((file) =>
      [...readFileSync(join(SRC, file), 'utf8').matchAll(pattern)].map((match) => `${file}: ${match[0]}`));
    expect(found).toEqual([]);
  });

  it('no file they load builds a key from a variable namespace (`t(`${x}.title`)`), which no scan could check', () => {
    const found = [...reachable()].filter((file) => /\bt\(\s*`\$\{/.test(readFileSync(join(SRC, file), 'utf8')));
    expect(found).toEqual([]);
  });

  it('reach the pages the test starts from, and the shared header, footer and cookie notice they carry', () => {
    const files = reachable();
    for (const file of ['app/(site)/(marketing)/layout.tsx', 'shared/ui/SessionHeader.tsx', 'shared/ui/HeaderCustomer.tsx', 'shared/ui/Footer.tsx', 'shared/ui/CookieNotice.tsx', 'features/marketing/LegalView.tsx', 'features/gallery/TemplateDetail.tsx']) {
      expect(files.has(file), file).toBe(true);
    }
    expect(files.has('features/checkout/InvoiceSheet.tsx')).toBe(false);
  });

  it('split the whole dictionary in two without losing or repeating a key, in both languages', () => {
    for (const locale of ['en', 'tr'] as const) {
      const all = loadMessages(locale);
      const pub = publicMessages(all);
      const rest = otherMessages(all);
      expect(Object.keys(pub).length + Object.keys(rest).length).toBe(Object.keys(all).length);
      expect({ ...pub, ...rest }).toEqual(all);
      expect(new Set(Object.keys(pub).map((key) => key.split('.')[0]))).toEqual(new Set(PUBLIC_NAMESPACES));
    }
  });
});
