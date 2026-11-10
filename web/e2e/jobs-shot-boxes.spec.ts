import { expect, test } from '@playwright/test';
import { IMAGE_1, IMAGE_2, fillProduct, resetStore, setCookies } from './helpers';

// The shot boxes of a running job: numbered, they say their stage, and the product photo is never one of them; and what pressing a stage on
// the left shows on the right: the pictures large, the clips played, the music heard, and nothing to press on Adaptation, Edit and Render.
// `VC_E2E_PORT=3263 NEXT_DIST_DIR=.next-jv4 pnpm e2e e2e/jobs-shot-boxes.spec.ts`; `JV1_SHOTS` is a folder for screenshots (none taken without it).

const SHOTS = process.env.JV1_SHOTS;

test('a running job shows numbered shot boxes that say their stage, and a ready one is not the product photo', async ({ page, request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  await page.goto('/templates/tpl-stop/generate');
  await fillProduct(page, 1, 'Box Serum', IMAGE_1);
  await fillProduct(page, 2, 'Box Serum Two', IMAGE_2);
  await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
  await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm generation' }).getByRole('button', { name: 'Confirm and generate' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);

  // the panel is the tab panel of the stage it shows, or the plain "Shots" region while that stage has nothing to press yet
  const shots = page.getByRole('tabpanel').or(page.getByRole('region', { name: 'Shots' }));
  await expect(shots.getByText('Shot 1', { exact: true })).toBeVisible();
  await expect(shots.locator('img[src*="uploads/"]')).toHaveCount(0);
  if (SHOTS) await shots.screenshot({ path: `${SHOTS}/pending.png` });

  // The fake job is quick: look again at once and often until a clip is ready (the page refreshes itself more slowly).
  await expect(async () => {
    await page.reload();
    await expect(shots.getByText('clip ready').first()).toBeVisible({ timeout: 500 });
  }).toPass({ intervals: [100], timeout: 50_000 });
  await expect(shots.locator('img[src*="uploads/"]')).toHaveCount(0);
  // The first frame made for a shot is in its box, sharp (the template's own frames are faded).
  const made = shots.locator('figure img:not(.opacity-60)');
  await expect(made.first()).toBeVisible();
  await expect(shots.getByText('Shot 1', { exact: true })).toBeVisible();
  if (SHOTS) await shots.screenshot({ path: `${SHOTS}/ready.png` });
});

test.describe('what pressing a stage shows', () => {
  test.beforeEach(async ({ page, request, context, baseURL }) => {
    await resetStore(request);
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
    await page.goto('/jobs/job-demo-running');
    await expect(page.getByRole('tablist')).toBeVisible();
  });

  test('Images: a picture opens large, the arrow keys go on, Escape closes and the focus returns', async ({ page }) => {
    await page.getByRole('tab', { name: 'Images' }).click();
    await expect(page.getByRole('tab', { name: 'Images' })).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    const box = panel.getByRole('button', { name: 'Open the picture of shot 2' });
    await box.focus();
    await box.press('Enter');
    const large = page.getByRole('dialog', { name: /Shot 2/ });
    await expect(large.getByRole('img')).toBeVisible();
    expect((await large.getByRole('img').boundingBox())!.height).toBeGreaterThan(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/large.png` });
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: /Shot 3/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(box).toBeFocused();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/images.png` });
  });

  test('Clips: nothing plays on hover; pressing a ready clip plays it with sound and controls, and only one plays', async ({ page }) => {
    await page.getByRole('tab', { name: 'Clips' }).click();
    const panel = page.getByRole('tabpanel');
    const first = panel.getByRole('button', { name: 'Play the clip of shot 1' });
    await first.hover();
    await page.waitForTimeout(400);
    await expect(panel.locator('video')).toHaveCount(0);
    await first.click();
    const video = panel.locator('video');
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
    expect(await video.evaluate((el: HTMLVideoElement) => [el.controls, el.muted])).toEqual([true, false]);
    await panel.getByRole('button', { name: 'Play the clip of shot 2' }).click();
    await expect(panel.locator('video')).toHaveCount(1);
    await expect(panel.locator('video')).toHaveAttribute('src', /.+/);
    await expect.poll(() => panel.locator('video').evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
    await expect.poll(() => panel.locator('video').evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.2);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/clips.png` });
  });

  test('Music: the browser\'s own audio player', async ({ page }) => {
    await page.getByRole('tab', { name: 'Music' }).click();
    const audio = page.getByRole('tabpanel').locator('audio');
    await expect(audio).toHaveCount(1);
    expect(await audio.evaluate((el: HTMLAudioElement) => [el.controls, el.getAttribute('src')?.startsWith('data:audio/') || el.getAttribute('src')?.startsWith('/media/')])).toEqual([true, true]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/music.png` });
  });

  test('Adaptation, Edit and Render cannot be pressed: no tab, no button, no tab stop, no pointer', async ({ page }) => {
    const list = page.getByRole('tablist');
    for (const name of ['Adaptation', 'Edit', 'Render']) {
      const row = list.locator('li', { hasText: name }).first();
      await expect(row.locator('button, [role="tab"], a, [tabindex]')).toHaveCount(0);
      expect(await row.locator('div').first().evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
      await expect(list.getByRole('tab', { name })).toHaveCount(0);
    }
    for (const name of ['Images', 'Clips', 'Music']) expect(await list.getByRole('tab', { name }).evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
  });

  test('on a phone the stages are above and the panel below, and the boxes fit', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Clips' }).click();
    const [list, panel] = await Promise.all([page.getByRole('tablist').boundingBox(), page.getByRole('tabpanel').boundingBox()]);
    expect(panel!.y).toBeGreaterThan(list!.y + list!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone.png`, fullPage: true });
  });
});
