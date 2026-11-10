import { expect, test } from '@playwright/test';
import { resetStore } from './helpers';

// Task E6: the cookie answer can be changed later, and "How it works" in the top menu leads to its section.
// Port 3256 for this agent: `VC_E2E_PORT=3256 NEXT_DIST_DIR=.next-e6 pnpm exec playwright test e2e/duzeltme-cerez.spec.ts`.

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

const answer = async (context: import('@playwright/test').BrowserContext) => (await context.cookies()).find((c) => c.name === 'vc_cookies')?.value;

test('Only necessary → the notice is gone → Cookie settings in the footer → the notice is back, also after a reload → Accept all stores all', async ({ page, context }) => {
  const notice = page.getByRole('region', { name: 'Cookie notice' });
  await page.goto('/pricing');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Only necessary' }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => answer(context)).toBe('necessary');

  await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click();
  await expect(notice).toBeVisible();
  expect(await answer(context)).toBeUndefined();
  await page.reload();
  await expect(notice).toBeVisible();

  await notice.getByRole('button', { name: 'Accept all' }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => answer(context)).toBe('all');
});

test('the footer links to the cookie and content policies', async ({ page }) => {
  await page.goto('/contact');
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'Cookies' }).click();
  await expect(page).toHaveURL(/\/legal\/cookies$/);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Content policy' }).click();
  await expect(page).toHaveURL(/\/legal\/content$/);
});

test('How it works in the top menu takes the visitor to the section on the home page', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'vc_cookies', value: 'necessary', url: baseURL ?? 'http://localhost:3256' }]);
  await page.goto('/pricing');
  await page.locator('header:visible').first().getByRole('link', { name: 'How it works' }).click();
  await expect(page).toHaveURL(/\/#how$/);
  await expect(page.locator('#how')).toBeInViewport();
});
