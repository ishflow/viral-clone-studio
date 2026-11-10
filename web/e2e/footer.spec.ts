import { expect, test } from '@playwright/test';
import { header, resetStore, setCookies } from './helpers';

test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { consent: 'necessary' });
});

const MARKETING = ['/', '/pricing', '/legal/terms', '/contact'];
const BROWSE = ['/gallery', '/templates/tpl-layering'];

// The boards have a footer on the marketing pages only; the gallery and the template page have none.
for (const session of [undefined, 'usr-demo'] as const) {
  test(`the footer is on the marketing pages only (${session ? 'signed in' : 'visitor'})`, async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { session });
    for (const path of MARKETING) {
      await page.goto(path);
      await expect(page.getByRole('contentinfo'), path).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Footer menu' }).getByRole('link')).toHaveCount(8);
    }
    for (const path of BROWSE) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
      await expect(page.getByRole('contentinfo'), path).toHaveCount(0);
    }
  });
}

test('the footer follows a navigation inside the site: it goes when the gallery opens and comes back on pricing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await header(page).getByRole('link', { name: 'Gallery' }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await header(page).getByRole('link', { name: 'Pricing' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('contentinfo')).toBeVisible();
});
