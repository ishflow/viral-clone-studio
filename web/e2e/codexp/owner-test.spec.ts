import { expect, test } from '@playwright/test';
import { World, ADMIN_EMAIL, ADMIN_PASSWORD } from '../real/world';
let world: World;
test.beforeAll(async () => {
  // Offline substitute worker: site exercises real SQLite/payment paths, while the provider stays fake.
  world = await World.start({ port: 3203, distDir: '.next-codexp', siteEnv: {
    VC_PROVIDER:'magnific', VC_OWNER_TEST:'1', VC_BIND_HOST:'127.0.0.1', VC_PROVIDER_DAILY_CAP:'30', VC_PROVIDER_JOB_CAP:'26',
  } });
});
test.afterAll(async () => { await world?.stop(); });
test('owner warning, visible limits and no-payments fake checkout work on the production site', async ({ page }) => {
 await page.goto(`${world.base}/login`);
 await expect(page.getByLabel('Email')).toBeVisible();
 await expect(page.getByText('OWNER TEST')).toHaveCount(0); // the warning is the admin's: a visitor is not told how the site is run
 await page.getByLabel('Email').fill(ADMIN_EMAIL); await page.getByLabel('Password').fill(ADMIN_PASSWORD);
 await page.getByRole('button',{name:'Log in',exact:true}).click(); await expect(page).not.toHaveURL(/\/login/);
 await page.goto(`${world.base}/admin/settings`);
 await expect(page.locator('aside[role=alert]')).toContainText('OWNER TEST');
 await expect(page.getByText(/Provider cap \/ Sağlayıcı sınırı/)).toContainText('30');
 await page.goto(`${world.base}/pricing`);
 await page.getByRole('button',{name:'Buy',exact:true}).first().click();
 await expect(page).toHaveURL(/checkout\/mock\//);
 await page.getByRole('button',{name:'Pay',exact:true}).click();
 await expect(page).toHaveURL(/checkout\/return|checkout\/success/);
});
