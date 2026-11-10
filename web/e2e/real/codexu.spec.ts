import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, World } from './world';

let world: World;
test.beforeAll(async () => {
  world = await World.start({ port: 3202, distDir: '.next-codexu' });
  const db = new DatabaseSync(join(world.dir, 'db.sqlite'));
  const row = db.prepare("SELECT * FROM templates WHERE id = 'layering-01'").get() as Record<string, string>;
  const card = JSON.parse(row.card!);
  const ref = join(world.dir, 'templates/layering-01/reference.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=360x640:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ref]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', ref, '-frames:v', '1', join(world.dir, 'templates/layering-01/reference.jpg')]);
  Object.assign(card, { seconds: 20.433333333333334, referenceMetric: { kind: 'likes', count: 155300 }, referenceImage: 'templates/layering-01/reference.jpg', referenceVideo: 'templates/layering-01/reference.mp4' });
  db.prepare("UPDATE templates SET card = ?, source_kind = 'topads', state = 'ready' WHERE id = 'layering-01'").run(JSON.stringify(card));
  const jsonPath = join(world.dir, 'templates/layering-01/template.json');
  const template = JSON.parse(readFileSync(jsonPath, 'utf8'));
  template.source.metrics = { views: 0, likes: 155300 };
  writeFileSync(jsonPath, JSON.stringify(template));
  db.close();
});
test.afterAll(async () => { await world?.stop(); });

test('admin reference media, compact metrics and entry links across languages/themes/widths; customer boundaries', async ({ page, context, browser }) => {
  await context.addCookies([{ name: 'vc_cookies', value: 'necessary', url: world.base }]);
  await page.goto(`${world.base}/login`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  for (const locale of ['en', 'tr']) for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    await context.addCookies([{ name: 'vc_locale', value: locale, url: world.base }, { name: 'vc_theme', value: theme, url: world.base }]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${world.base}/admin/templates/inbox`);
    await expect(page.getByText(locale === 'en' ? /155.3K likes/ : /155.3K beğeni/)).toBeVisible();
    await expect(page.getByText(/20\.433333/)).toHaveCount(0);
    const video = page.locator('video[src="/media/templates/layering-01/reference.mp4"]');
    await expect(video).toBeVisible();
    expect(await video.getAttribute('poster')).toBe('/media/templates/layering-01/reference.jpg');
    expect((await context.request.get(`${world.base}/media/templates/layering-01/reference.jpg`)).status()).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto(`${world.base}/account`);
    await expect(page.getByRole('link', { name: locale === 'en' ? 'Admin panel' : 'Yönetici paneli', exact: true }).last()).toBeVisible();
    if (width === 390) {
      await page.getByRole('button', { name: locale === 'en' ? 'Open menu' : 'Menüyü aç' }).click();
      await expect(page.getByRole('dialog').getByRole('link', { name: locale === 'en' ? 'Admin panel' : 'Yönetici paneli', exact: true })).toBeVisible();
      await page.getByRole('button', { name: locale === 'en' ? 'Close menu' : 'Menüyü kapat' }).click();
    } else {
      await expect(page.locator('header').getByRole('link', { name: locale === 'en' ? 'Admin panel' : 'Yönetici paneli', exact: true }).first()).toBeVisible();
    }
    await page.screenshot({ path: `/tmp/codexu-${locale}-${theme}-${width}.png`, fullPage: true });
  }
  const customer = await browser.newContext();
  const customerPage = await customer.newPage();
  await customer.addCookies([{ name: 'vc_cookies', value: 'necessary', url: world.base }]);
  await customerPage.goto(`${world.base}/signup`);
  const email = `codexu-${Date.now()}@example.com`;
  await customerPage.getByLabel('Email').fill(email);
  await customerPage.getByLabel('Password', { exact: true }).fill('codexu-local-test-password');
  await customerPage.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(customerPage).toHaveURL(/\/verify-email$/);
  await customerPage.goto(await world.link(email, 'verify'));
  await customerPage.goto(`${world.base}/account`);
  expect(await customerPage.locator('a[href="/admin"]').count()).toBe(0);
  expect((await customer.request.get(`${world.base}/media/templates/layering-01/reference.mp4`)).status()).toBe(404);
  const db = new DatabaseSync(join(world.dir, 'db.sqlite'));
  db.prepare("UPDATE templates SET state = 'published' WHERE id = 'layering-01'").run();
  db.close();
  expect((await customer.request.get(`${world.base}/media/templates/layering-01/reference.mp4`, { headers: { Range: 'bytes=0-31' } })).status()).toBe(206);
  await customerPage.goto(`${world.base}/gallery`);
  await expect(customerPage.getByText(/155.3K likes/)).toBeVisible();
  await customer.close();
});
