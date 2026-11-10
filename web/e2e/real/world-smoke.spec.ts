// The world itself: worker and site are up on the temp dir, and the only seeded login is the admin with VC_ADMIN_PASSWORD
// (no default password in sqlite mode, and no demo customer at all: the admin list and its CSV hold the administrator only).
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE, World, logIn } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

test('the admin logs in with the configured password; a wrong password and a fixture customer are refused', async ({ page }) => {
  expect(world.worker?.child.exitCode, 'the worker is running').toBeNull();
  await logIn(page, ADMIN_EMAIL, 'not-the-admin-password');
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password is not correct.' })).toBeVisible();
  await logIn(page, 'demo@example.com', 'demo-password');
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password is not correct.' })).toBeVisible();
  await logIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).not.toHaveURL(/\/login/);
});

test('a fresh world has the administrator only: not in the users list, not in the CSV', async ({ page }) => {
  await logIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).not.toHaveURL(/\/login/);   // the session cookie is set once the form has answered
  const csv = await page.request.get(`${BASE}/admin/users/export`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain(ADMIN_EMAIL);
  expect(text.match(/@/g) ?? [], 'one account (one address) in the CSV').toHaveLength(1);
  await page.goto(`${BASE}/admin/users`);
  await expect(page.getByText('demo@viralclone.app')).toHaveCount(0);
  await expect(page.getByText('paying@example.com')).toHaveCount(0);
  // a customer who paid nothing shows $0.00, never the [AMOUNT] placeholder
  await expect(page.getByText('[AMOUNT]')).toHaveCount(0);
});
