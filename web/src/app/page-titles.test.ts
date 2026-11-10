import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en/titles.json';

const APP = join(__dirname);

function files(dir: string, name: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'dev' ? [] : files(path, name);
    return name.test(e.name) ? [path] : [];
  });
}

const EXPORTS_TITLE = /export (const metadata\b|const generateMetadata\b|(async )?function generateMetadata\b)/;
const rel = (p: string) => relative(APP, p);
const HOME = join(APP, '(site)', '(marketing)', 'page.tsx');

describe('page titles', () => {
  it('every page under src/app except dev exports a title (metadata or generateMetadata), the home page aside', () => {
    const missing = files(APP, /^(page|not-found)\.tsx$/)
      .filter((p) => p !== HOME)
      .filter((p) => !EXPORTS_TITLE.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it('a page about one record says "Page not found" in the tab when the record is not there (recordTitle)', () => {
    const records = [
      '(app)/invoices/[id]/page.tsx',
      '(app)/jobs/[id]/page.tsx',
      '(app)/jobs/[id]/compare/page.tsx',
      '(app)/templates/[id]/generate/page.tsx',
      '(site)/(browse)/templates/[id]/page.tsx',
      'admin/users/[id]/page.tsx',
      'admin/templates/[id]/page.tsx',
    ];
    expect(records.filter((p) => !/generateMetadata = async .*\n?\s*recordTitle\('\w+'/.test(readFileSync(join(APP, p), 'utf8')))).toEqual([]);
  });

  it('the home page leaves the title to the site name (its metadata is the share card, no title)', () => {
    expect(readFileSync(HOME, 'utf8')).not.toMatch(/pageTitle|recordTitle|export const metadata\b/);
  });

  it('every title a page asks for is in titles.json', () => {
    const asked = files(APP, /^(page|not-found)\.tsx$/).flatMap((p) =>
      [...readFileSync(p, 'utf8').matchAll(/(?:pageTitle|recordTitle)\('(\w+)'/g)].map((m) => ({ file: rel(p), key: m[1] ?? '' })),
    );
    expect(asked.length).toBeGreaterThan(30);
    expect(asked.filter(({ key }) => !(key in en))).toEqual([]);
  });

  it('the site name closes every title: "Pricing · Viral Clone"', () => {
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/template: '%s · ' \+ SITE\.name/);
    expect(layout).toMatch(/default: SITE\.name/);
  });
});
