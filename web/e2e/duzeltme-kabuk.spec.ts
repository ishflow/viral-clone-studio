import { expect, test, type Page } from '@playwright/test';
import { IMAGE_1, fillProduct, resetStore, setCookies } from './helpers';

// Task DF5: the page shell. A missing page inside the app has one header, the admin 404 speaks about the admin panel, and a running job's page
// does not ask for the other pages of the site every 2 seconds.
// Port 3235 for this agent: `VC_E2E_PORT=3235 NEXT_DIST_DIR=.next-f5 pnpm exec playwright test e2e/duzeltme-kabuk.spec.ts`.

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

test.describe('a page that is not there, signed in', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  });

  for (const path of ['/jobs/nope', '/jobs/nope/compare', '/templates/nope/generate', '/invoices/nope', '/zzz']) {
    test(`${path} has one header`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: "This page doesn't exist." })).toBeVisible();
      await expect(page.locator('header:visible')).toHaveCount(1); // a header drawn inside <main> is not a "banner" for the browser, so count the elements
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Back to the gallery' })).toBeVisible();
    });
  }
});

test('the admin 404 does not say that every template is in the gallery, and leads back to the admin panel', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-admin', consent: 'necessary' });
  await page.goto('/admin/users/nope');
  await expect(page.getByRole('heading', { level: 1, name: "This page doesn't exist." })).toBeVisible();
  await expect(page.getByText('The link may be old or mistyped.', { exact: true })).toBeVisible();
  await expect(page.getByText('Every template is in the gallery')).toHaveCount(0);
  await expect(page.locator('header:visible')).toHaveCount(1); // a header drawn inside <main> is not a "banner" for the browser, so count the elements
  await page.getByRole('link', { name: 'Back to the admin panel' }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

/** Starts a Best, three-variant job (a minute and a half of fake time) and waits for its page. */
async function startLongJob(page: Page): Promise<void> {
  await page.goto('/templates/tpl-eye/generate');
  await fillProduct(page, 1, 'Quiet Serum', IMAGE_1);
  await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
  await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm generation' }).getByRole('button', { name: 'Confirm and generate' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
}

test('a running job page does not ask for the gallery, My videos, pricing or account while it refreshes itself', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  await startLongJob(page);
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  const asked: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (['/gallery', '/videos', '/pricing', '/account'].includes(pathname)) asked.push(`${request.method()} ${request.url()}`);
  });
  await page.waitForTimeout(10_000);
  expect(asked).toEqual([]);
});
