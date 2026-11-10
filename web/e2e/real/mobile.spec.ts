// Flow 7: the main flow at 390 px, the width of a phone: sign up, verify, gallery -> template -> form -> the free video -> result -> My videos.
// Every screen: no sideways scroll, the main buttons are at least 44 px high, the menu opens and leads somewhere.
import { expect, test, type Page } from '@playwright/test';
import { BASE, World, confirmJob, expectReady, fillGenerateForm, newCustomer, noNotice, openConfirm } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function fits(page: Page, what: string): Promise<void> {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${what}: the page is wider than the phone (${scroll} > ${inner})`).toBeLessThanOrEqual(inner);
}

test('the main flow works at 390 px without sideways scroll', async ({ page, context }) => {
  await noNotice(context);
  await newCustomer(world, page, 'phone');
  await fits(page, '/welcome');

  await page.goto(`${BASE}/gallery`);
  await fits(page, '/gallery');
  // The phone header: the menu opens and leads to My videos.
  await page.getByRole('button', { name: /menu/i }).first().click();
  await expect(page.getByRole('link', { name: 'My videos' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Touch has no hover: the card's "Clone it" is on screen and tappable (44 px) without any hover.
  const cardClone = page.getByRole('link', { name: 'Clone it' }).first();
  await expect(cardClone).toBeVisible();
  expect((await cardClone.boundingBox())!.height, 'the card Clone it is a 44 px target').toBeGreaterThanOrEqual(44);
  await cardClone.click();
  await expect(page).toHaveURL(/\/templates\/[a-z0-9-]+\/generate$/);
  await page.goto(`${BASE}/gallery`);
  await page.getByRole('link', { name: /Scent layering line-up/ }).first().click();
  await expect(page).toHaveURL(/\/templates\/layering-01$/);
  await fits(page, 'template');
  const clone = page.getByRole('link', { name: 'Clone it' }).first();
  expect((await clone.boundingBox())!.height, 'Clone it is a 44 px target').toBeGreaterThanOrEqual(44);
  await clone.click();
  await expect(page).toHaveURL(/\/templates\/layering-01\/generate$/);
  await fits(page, 'form');

  await fillGenerateForm(page, 'Fast');
  await fits(page, 'filled form');
  const dialog = await openConfirm(page);
  await fits(page, 'confirmation');
  await expect(dialog.getByText('Free video · 0 credits')).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Confirm and generate' });
  expect((await confirm.boundingBox())!.height, 'Confirm is a 44 px target').toBeGreaterThanOrEqual(44);
  await confirmJob(page);
  await fits(page, 'job page');
  await expectReady(page);
  await fits(page, 'result');
  await expect(page.locator('video').first()).toBeVisible();

  await page.goto(`${BASE}/videos`);
  await fits(page, 'My videos');
  await expect(page.getByText('Scent layering line-up').first()).toBeVisible();
  await page.goto(`${BASE}/account`);
  await fits(page, 'account');
});
