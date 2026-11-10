import { expect, test } from '@playwright/test';

test('signed-out /account redirects to login with the return path', async ({ page }) => {
  await page.goto('/account');
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/login?next=%2Faccount');
});

test('signed-out /admin is a 403, without the panel', async ({ page }) => {
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(403);
  await expect(page.getByRole('navigation', { name: 'Admin menu' })).toHaveCount(0);
});
