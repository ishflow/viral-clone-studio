import { expect, test, type Page } from '@playwright/test';
import { header, photo, resetStore, setCookies } from './helpers';

// Person swap, on the fake engine. The server playwright.config.ts starts has `VC_FAKE_SWAP=1`: the fixtures hold one person-swap
// video ("Walk to the camera", 12 seconds, 3 credits) and the switch is on, without the admin's look. The switch itself, closed and
// opened from the admin's Settings screen, is e2e/swap-flag.spec.ts.

test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
});

const start = (page: Page) => page.getByRole('button', { name: 'Start', exact: true });
const boxes = (page: Page) => page.getByRole('group', { name: 'Before you start' }).getByRole('checkbox');

test.describe('person swap switched on', () => {
  test('a customer picks a video, uploads a photo, consents, confirms the credits and gets the video', async ({ page }) => {
    await page.goto('/gallery');
    await header(page).getByRole('link', { name: 'Person swap' }).click();
    await expect(page).toHaveURL(/\/swap$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Person swap' })).toBeVisible();
    const card = page.getByRole('article').filter({ hasText: 'Walk to the camera' });
    await expect(card).toContainText('3 credits');
    await expect(card).toContainText('1 person');
    await card.getByRole('link', { name: 'Walk to the camera' }).click();

    await expect(page).toHaveURL(/\/swap\/tpl-swap$/);
    await expect(page.getByText('3 credits · 12 sec · 9:16')).toBeVisible();
    await expect(page.getByText(/deleted when the job is finished, at the latest 24 hours later/)).toBeVisible();
    await expect(page.getByText(/kept for 30 days/)).toBeVisible();
    await expect(start(page)).toBeDisabled();

    // A photograph that lies on its side is refused under its box; nothing is stored.
    await page.getByLabel('Add full-body photo').setInputFiles(await photo(page, 'wide.png', 800, 500));
    await expect(page.getByText('wide.png was not added: a full-body photo must be upright (taller than wide).')).toBeVisible();
    await page.getByLabel('Add full-body photo').setInputFiles(await photo(page, 'me.png', 500, 800));
    await expect(page.getByAltText('Your full-body photo')).toBeVisible();
    // The third photograph, from the side, may be left out; given, it may lie on its side, and the price below stays the same.
    await page.getByLabel('Add side photo').setInputFiles(await photo(page, 'side.png', 800, 500));
    await expect(page.getByAltText('Your side photo')).toBeVisible();
    await expect(page.getByText('Tick all three boxes to start.')).toBeVisible();
    await expect(start(page)).toBeDisabled();

    for (const box of await boxes(page).all()) await box.check();
    await expect(start(page)).toBeEnabled();
    await start(page).click();

    const dialog = page.getByRole('dialog', { name: 'Confirm and start' });
    await expect(dialog.getByText('Credits for this video')).toBeVisible();
    await expect(dialog).toContainText('3 credits');
    await expect(dialog).toContainText('19 credits');
    await expect(dialog).toContainText('16 credits');
    await expect(header(page)).toContainText('19 credits');          // nothing is charged before the confirmation
    await dialog.getByRole('button', { name: 'Confirm and start' }).click();

    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    await expect(header(page)).toContainText('16 credits');
    // The job page turns into the result by itself (the fake keeps no video file: the page says so).
    await expect(page.getByRole('heading', { level: 1, name: 'Your video is ready.' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Walk to the camera · 720p · mp4')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Report a problem' })).toBeVisible();
    await expect(page.getByText('Kept in My videos for 30 days, then deleted.')).toBeVisible();   // not the 12 months of a product video
    await expect(header(page)).toContainText('16 credits');
  });

  test('Start stays off while any of the three consent boxes is open', async ({ page }) => {
    await page.goto('/swap/tpl-swap');
    await page.getByLabel('Add full-body photo').setInputFiles(await photo(page, 'me.png', 500, 800));
    await expect(page.getByAltText('Your full-body photo')).toBeVisible();
    await expect(boxes(page)).toHaveCount(3);
    for (const box of await boxes(page).all()) await box.check();
    await expect(start(page)).toBeEnabled();
    for (const box of await boxes(page).all()) {
      await box.uncheck();
      await expect(start(page)).toBeDisabled();
      await box.check();
      await expect(start(page)).toBeEnabled();
    }
  });

  test('on a phone (390 px) the form fits the screen and the menu links to person swap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/swap/tpl-swap');
    await expect(page.getByRole('heading', { level: 1, name: 'Put yourself in this video' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByLabel('Add full-body photo').setInputFiles(await photo(page, 'me.png', 500, 800));
    await expect(page.getByAltText('Your full-body photo')).toBeVisible();
    for (const box of await boxes(page).all()) await box.check();
    await start(page).click();
    await expect(page.getByRole('dialog', { name: 'Confirm and start' })).toContainText('3 credits');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('dialog', { name: 'Confirm and start' }).getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/swap');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await header(page).getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Person swap' })).toHaveAttribute('href', '/swap');
  });
});
