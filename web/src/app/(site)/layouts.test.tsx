// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { CookieNotice, Footer, PageFrame } from '@/shared/ui';
import SiteLayout from './layout';

const group = (name: string) => join(__dirname, name);
/** The addresses a route group serves: the folders under it that hold a page. */
function routesOf(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return routesOf(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === 'page.tsx' ? [prefix || '/'] : [];
  });
}
const frameOf = async (name: string) => {
  const layout = (await import(`./${name}/layout`)).default as (props: { children: string }) => ReactElement<{ footer?: ReactElement }>;
  return layout({ children: 'page' });
};

describe('the footer of the public pages (boards: only the marketing pages have one)', () => {
  it('home, pricing, legal and contact are in the group whose frame has the footer', async () => {
    expect(routesOf(group('(marketing)')).sort()).toEqual(['/', '/contact', '/legal/[doc]', '/pricing']);
    const frame = await frameOf('(marketing)');
    expect(frame.type).toBe(PageFrame);
    expect(frame.props.footer?.type).toBe(Footer);
  });

  it('the gallery and the template page are in the group whose frame has none, signed in or not', async () => {
    expect(routesOf(group('(browse)')).sort()).toEqual(['/gallery', '/templates/[id]']);
    const frame = await frameOf('(browse)');
    expect(frame.type).toBe(PageFrame);
    expect(frame.props.footer).toBeUndefined();
  });

  it('no public page is left outside the two groups, and both keep the cookie notice of the (site) layout', async () => {
    expect(existsSync(join(__dirname, 'page.tsx'))).toBe(false);
    expect(readdirSync(__dirname, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()).toEqual(['(browse)', '(marketing)']);
    const site = (await SiteLayout({ children: 'page' })) as ReactElement<{ children: ReactElement[] }>;
    expect(site.props.children.some((child) => typeof child === 'object' && child.type === CookieNotice)).toBe(true);
    expect(site.props.children.some((child) => typeof child === 'object' && child.type === PageFrame)).toBe(false);
  });
});
