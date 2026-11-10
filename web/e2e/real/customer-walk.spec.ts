// The E2E walk of the owner's trial, kept as one spec (production site + real worker + fake provider, nothing paid):
//  1. admin: "Generate sample" with the template's product photos -> the sample appears with a picture that LOADS (the image
//     optimizer used to answer 400 for a file that needs the session) -> publish -> the visitor sees it;
//  2. customer: buys a pack (fake checkout) -> balance -> the admin overview/revenue show the money (no "[AMOUNT]" / "[PERCENT]" literals)
//     -> a job from the template finishes; the result says whole seconds (not 20.433333 sec).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, World, fillGenerateForm, confirmJob, expectReady, headerCredits, logIn, newCustomer, noNotice, openConfirm, PRODUCT_1 } from './world';

let world: World;
test.beforeAll(async () => {
  world = await World.start();
  // one seeded template waits for the admin, as a scanned one does
  const db = new DatabaseSync(join(world.dir, 'db.sqlite'));
  db.prepare("UPDATE templates SET state = 'ready' WHERE id = 'layering-01'").run();
  db.close();
});
test.afterAll(async () => { await world?.stop(); });

test('admin: sample with photos, the picture loads, publish; customer: buy, money in the admin, job result in whole seconds', async ({ page, context, browser }) => {
  await noNotice(context);
  const bad: string[] = [];
  const adminContext = await browser.newContext();
  await noNotice(adminContext);
  const admin = await adminContext.newPage();
  admin.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/_next/image')) bad.push(`${r.status()} ${r.url()}`); });
  await logIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(admin).not.toHaveURL(/\/login/);

  // 1. the sample
  await admin.goto(`${world.base}/admin/templates/inbox`);
  await admin.getByRole('button', { name: 'Generate sample' }).first().click();
  const dialog = admin.getByRole('dialog');
  const blocks = dialog.getByRole('group', { name: /^Product \d+$/ });
  await expect(blocks.first()).toBeVisible();
  for (let n = 0; n < await blocks.count(); n += 1) {
    await blocks.nth(n).locator('input[type=file]').setInputFiles(PRODUCT_1);
    await blocks.nth(n).getByLabel('Product name').fill(`Sample Serum ${n + 1}`);
  }
  await dialog.getByRole('button', { name: 'Generate sample' }).click();
  await expect.poll(async () => { await admin.reload(); return admin.getByRole('button', { name: 'Publish', exact: true }).count(); }, { timeout: 180_000, intervals: [4_000] }).toBeGreaterThan(0);
  const pictures = admin.locator('main img');
  await expect(pictures.first()).toBeVisible();
  await expect.poll(() => pictures.evaluateAll((all) => all.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 0).length), { message: 'no broken picture in the inbox' }).toBe(0);
  expect(bad, 'no failed image optimizer request').toEqual([]);
  await admin.getByRole('button', { name: 'Publish', exact: true }).first().click();
  await expect.poll(async () => (await (await fetch(`${world.base}/gallery`)).text()).includes('Scent layering')).toBe(true);

  // 2. the customer buys a pack and makes a video
  await newCustomer(world, page, 'walk');
  await page.goto(`${world.base}/pricing`);
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: /10 credits added/ })).toBeVisible();
  await page.goto(`${world.base}/account`);
  expect(await headerCredits(page)).toBe(10);

  await admin.goto(`${world.base}/admin`);
  await expect(admin.getByText('Paying users')).toBeVisible();
  const overview = await admin.locator('main').last().innerText();
  expect(overview).toContain('$19.00');
  await admin.goto(`${world.base}/admin/revenue`);
  const revenue = await admin.locator('main').last().innerText();
  expect(revenue).not.toMatch(/\[(AMOUNT|PERCENT)\]/);
  expect(revenue).toContain('$19.00');
  expect(revenue).toContain('100%');

  await page.goto(`${world.base}/templates/layering-01/generate`);
  await fillGenerateForm(page, 'Fast');
  await openConfirm(page);
  await confirmJob(page);
  await expectReady(page);
  await expect(page.getByText(/ · \d+ sec · 720p · mp4$/)).toBeVisible();
  await adminContext.close();
});
