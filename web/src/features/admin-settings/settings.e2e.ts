import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { World, ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../e2e/real/world';

let world: World;
test.beforeAll(async () => { world = await World.start({ port: 3217, distDir: '.next-codext' }); });
test.afterAll(async () => { await world?.stop(); });

test('admin saves Top Ads filters to isolated SQLite and reloads them in English and Turkish', async ({ page }) => {
  await page.goto(`${world.base}/login`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`${world.base}/admin/settings`);
  await expect(page.getByLabel('Top Ads industry')).toHaveValue('beauty-personal-care');
  await expect(page.getByLabel('Top Ads country code (e.g. US)')).toHaveValue('US');
  await expect(page.getByLabel('Top Ads period')).toHaveValue('7');
  await page.getByLabel('Top Ads industry').selectOption('skincare');
  await page.getByLabel('Top Ads country code (e.g. US)').fill('GB');
  await page.getByLabel('Top Ads period').selectOption('30');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Top Ads industry')).toHaveValue('skincare');
  await expect(page.getByLabel('Top Ads country code (e.g. US)')).toHaveValue('GB');
  await expect(page.getByLabel('Top Ads period')).toHaveValue('30');
  const db = new DatabaseSync(join(world.dir, 'db.sqlite'), { readOnly: true });
  try {
    const stored = JSON.parse((db.prepare('SELECT value FROM settings WHERE id = 1').get() as { value: string }).value);
    expect(stored).toMatchObject({ topAdsIndustry: 'skincare', topAdsCountry: 'GB', topAdsPeriod: 30, threshold: 70, dailyCandidates: 45, dailyTemplates: 10, searches: [], sources: { topads: false, shorts: false } });
  } finally { db.close(); }
  await page.context().addCookies([{ name: 'vc_locale', value: 'tr', url: world.base }]);
  await page.reload();
  await expect(page.getByLabel('Top Ads sektörü')).toHaveValue('skincare');
  await expect(page.getByLabel('Top Ads ülke kodu (ör. US)')).toHaveValue('GB');
  await expect(page.getByLabel('Top Ads dönemi')).toHaveValue('30');
});
