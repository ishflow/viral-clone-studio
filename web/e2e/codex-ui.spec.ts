import { test, expect } from '@playwright/test';
import { setCookies } from './helpers';

test('cookie notice fits 320/360 px in both languages and themes', async ({ browser, baseURL }) => {
  for (const width of [320, 360]) for (const locale of ['en', 'tr'] as const) for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      await setCookies(context, baseURL, { locale, theme });
      const page = await context.newPage();
      await page.goto(`${baseURL}/legal/cookies`);
      const region = page.getByRole('region', { name: locale === 'en' ? 'Cookie notice' : 'Çerez bildirimi' });
      await expect(region).toBeVisible();
      await expect(region.getByRole('button')).toHaveCount(2);
      await expect(region.getByRole('link')).toHaveAttribute('href', '/legal/cookies');
      expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const button of await region.getByRole('button').all()) {
        expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), `${width}/${locale}/${theme}: ${await button.textContent()}`).toBe(true);
      }
      const rect = await region.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      if (width === 320 && locale === 'tr') await page.screenshot({ path: `../scratch-codex/cookies-tr-${theme}-320.png`, fullPage: true });
      await region.getByRole('button').last().click();
      await expect(region).toHaveCount(0);
      expect((await context.cookies()).find((cookie) => cookie.name === 'vc_cookies')?.value).toBe('all');
    } finally { await context.close(); }
  }
});

test('admin Publish and email previews fit narrow screens', async ({ browser, request, baseURL }) => {
  for (const width of [320, 360]) for (const locale of ['en', 'tr'] as const) for (const theme of ['light', 'dark'] as const) {
    const { resetStore } = await import('./helpers');
    await resetStore(request);
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      await setCookies(context, baseURL, { locale, theme, session: 'usr-admin', consent: 'necessary' });
      const page = await context.newPage();
      await page.goto(`${baseURL}/admin/templates/tpl-layering`);
      const hide = locale === 'en' ? 'Hide template' : 'Şablonu gizle';
      await page.getByRole('button', { name: hide, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: hide, exact: true }).click();
      const publish = page.getByRole('button', { name: locale === 'en' ? 'Publish' : 'Yayınla', exact: true });
      await expect(publish).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const button of await page.getByRole('button').all()) {
        if ((await button.textContent())?.trim() && await button.isVisible()) expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), `${width}/${locale}/${theme}: ${await button.textContent()}`).toBe(true);
      }
      if (width === 320 && locale === 'tr') await page.screenshot({ path: `../scratch-codex/publish-tr-${theme}-320.png`, fullPage: true });
      await publish.click();
      await expect(publish).toHaveCount(0);
      for (const kind of ['ready', 'stopped']) {
        await page.goto(`${baseURL}/dev/emails/${kind}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 320 && locale === 'tr' && theme === 'light') await page.screenshot({ path: `../scratch-codex/email-${kind}-tr-320.png`, fullPage: true });
      }
    } finally { await context.close(); }
  }
});
