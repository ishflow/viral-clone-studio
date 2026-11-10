import { expect, test, type Page } from '@playwright/test';
import { header, setCookies } from './helpers';

// The admin menu has seven sections: the wide header holds them on one line from 1024 px up (no wrap, no sideways scroll). Below that
// (900-1023 px) it takes two deliberate rows (logo and "View site", then the menu), not "View site" dropped on a row of its own.
const VIEW_SITE = /View site|Siteyi gör/;
const MENU = /Admin menu|Yönetim menüsü/;

async function openAdmin(page: Page, context: Parameters<typeof setCookies>[0], baseURL: string | undefined, locale: 'en' | 'tr', width: number) {
  await setCookies(context, baseURL, { session: 'usr-admin', consent: 'necessary', locale });
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/admin');
  const bar = header(page);
  const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!;
  return {
    bar,
    logo: await box(bar.getByRole('link').first()),
    menu: await box(bar.getByRole('navigation', { name: MENU })),
    view: await box(bar.getByRole('link', { name: VIEW_SITE })),
    overflow: (await page.evaluate(() => document.documentElement.scrollWidth)) - width,
  };
}

for (const locale of ['en', 'tr'] as const) {
  for (const width of [1024, 1100, 1280, 1440]) {
    test(`admin header (${locale}, ${width} px): logo, menu and View site share one line`, async ({ page, context, baseURL }) => {
      const { logo, menu, view, overflow } = await openAdmin(page, context, baseURL, locale, width);
      expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
      expect(menu.y, 'the menu starts on the logo line').toBeLessThan(logo.y + logo.height);
      expect(view.y, 'View site starts on the logo line').toBeLessThan(logo.y + logo.height);
      expect(menu.x + menu.width, 'the menu ends before View site starts').toBeLessThanOrEqual(view.x);
      expect(logo.x + logo.width, 'the logo ends before the menu starts').toBeLessThanOrEqual(menu.x);
    });
  }
  for (const width of [900, 960]) {
    test(`admin header (${locale}, ${width} px): two rows, nothing sticks out`, async ({ page, context, baseURL }) => {
      const { logo, menu, view, overflow } = await openAdmin(page, context, baseURL, locale, width);
      expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
      expect(view.y, 'View site shares the logo row').toBeLessThan(logo.y + logo.height);
      expect(menu.y, 'the menu has its own row below').toBeGreaterThanOrEqual(logo.y + logo.height);
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    });
  }
}
