import { expect, test } from '@playwright/test';
import { IMAGE_1, fillProduct, resetStore, setCookies } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

test.describe('gallery and template (visitor, customer with the free video, customer without)', () => {
  test('a visitor sees Free on the cards without talking; a customer who used the free video sees it nowhere', async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { consent: 'necessary' });
    await page.goto('/gallery');
    const free = page.getByText('Free', { exact: true });
    await expect(free.first()).toBeVisible();
    // The card of a talking template (the presenter story) carries no Free label.
    await expect(page.getByRole('article').filter({ has: page.getByRole('link', { name: /presenter story/ }) }).getByText('Free', { exact: true })).toHaveCount(0);

    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
    await page.goto('/gallery');
    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(page.getByText('Free', { exact: true })).toHaveCount(0);
  });

  test('the template page says Free with your first video, the length and the promise; not for a customer who used it', async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-new', consent: 'necessary' });
    await page.goto('/templates/tpl-eye');
    await expect(page.getByText('Free with your first video')).toBeVisible();
    await expect(page.getByText(/final video$/)).toBeVisible();
    await expect(page.getByText(/^Made from \d+ clips$/)).toBeVisible();
    await expect(page.getByText(/The structure stays the same: shots, order, timing and on-screen text\./)).toBeVisible();
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
    await page.goto('/templates/tpl-eye');
    await expect(page.getByRole('link', { name: 'Clone it' })).toBeVisible();
    await expect(page.getByText('Free with your first video')).toHaveCount(0);
  });

  for (const width of [320, 390]) {
    test(`no horizontal scroll at ${width} px on the gallery, and the sort choice stays on screen`, async ({ page, context, baseURL }) => {
      await setCookies(context, baseURL, { consent: 'necessary' });
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/gallery');
      await expect(page.getByRole('combobox', { name: 'Sort' })).toBeVisible();
      const box = await page.getByRole('combobox', { name: 'Sort' }).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('the generate form and its confirmation', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  });

  test('the price line follows the choices; the window opens at once and lists the rows of the confirmation', async ({ page }) => {
    await page.goto('/templates/tpl-eye/generate');
    await expect(page.getByText('JPG, PNG or WebP · up to 10 MB each · 1 to 8 images per product')).toHaveCount(1);
    await expect(page.getByText('2 credits · 13 sec · 9:16 · 720p')).toBeVisible();
    await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
    await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3', exact: true }).click();
    await expect(page.getByText('15 credits · 13 sec · 9:16 · 1080p · 3 variants')).toBeVisible();
    await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '1', exact: true }).click();
    await fillProduct(page, 1, 'Dialog Serum', IMAGE_1);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm generation' });
    await expect(dialog.getByText('Final video').locator('..')).toContainText('13 sec · 9:16 · 1080p');
    await expect(dialog.getByText('Credits for this job').locator('..')).toContainText('5 credits');
    await expect(dialog.getByText('Balance now').locator('..')).toContainText('19 credits');
    await expect(dialog.getByText('After this job').locator('..')).toContainText('14 credits');
    await dialog.getByRole('button', { name: 'What we generate' }).click();
    await expect(dialog).toContainText('The clips are cut to the template');
    await expect(dialog).toContainText('A job cannot be cancelled once it starts.');
    // Cancel: nothing started, nothing charged.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/generate$/);
  });
});

test('not enough credits: the window says what is needed; Buy credits keeps the form on the server, and it is back when the customer returns', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  await page.goto('/templates/tpl-story/generate');
  await fillProduct(page, 1, 'Kept Serum', IMAGE_1);
  await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
  await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm generation' });
  await expect(dialog.getByRole('alert')).toContainText('You need 24 credits and have 19 credits. Nothing was charged. Your form is saved.');
  await dialog.getByRole('link', { name: 'Buy credits' }).click();
  await expect(page).toHaveURL(/\/pricing\?returnTo=%2Ftemplates%2Ftpl-story%2Fgenerate$/);
  await page.goto('/templates/tpl-story/generate');
  await expect(page.getByRole('status').filter({ hasText: 'We kept your entries from your last visit.' })).toBeVisible();
  await expect(page.getByLabel('Product name')).toHaveValue('Kept Serum');
  await expect(page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test.describe('the result page', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  });

  test('Kept note; Report a problem sends once and thanks; Delete video asks, then the video is gone from My videos', async ({ page }) => {
    await page.goto('/jobs/job-demo-story');
    await expect(page.getByText('Kept in My videos for 12 months. You can use this video in your ads.')).toBeVisible();

    await page.getByRole('button', { name: 'Report a problem' }).click();
    const report = page.getByRole('dialog', { name: 'Report a problem' });
    await report.getByRole('button', { name: 'Send report' }).click();
    await expect(report.getByRole('alert')).toContainText('Choose what is wrong.');
    await report.getByRole('radio', { name: 'The product looks different' }).check();
    await report.getByLabel('Add a note (optional)').fill('The label is blurred.');
    await report.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Thanks. We look at it within 2 business days.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Delete video' }).click();
    const ask = page.getByRole('dialog', { name: 'Delete this video?' });
    await ask.getByRole('button', { name: 'Keep it' }).click();
    await expect(page).toHaveURL(/\/jobs\/job-demo-story$/);
    await page.getByRole('button', { name: 'Delete video' }).click();
    await page.getByRole('dialog', { name: 'Delete this video?' }).getByRole('button', { name: 'Delete video' }).click();
    await expect(page).toHaveURL(/\/videos$/);
    await page.goto('/jobs/job-demo-story');
    await expect(page.getByRole('heading', { name: "This page doesn't exist." })).toBeVisible();
  });
});

test.describe('add your own video', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-paying', consent: 'necessary' });
  });

  test('the check is free; the window shows the price; Prepare template charges one credit and lists the template; the same link is refused afterwards', async ({ page }) => {
    await page.goto('/templates/new');
    await expect(page.getByText('mp4 or mov · up to 60 sec · up to 100 MB · vertical (9:16)')).toBeVisible();
    await expect(page.getByText('Preparing a template costs 1 credit. You confirm before anything is charged.')).toBeVisible();
    const link = 'https://www.tiktok.com/@someone/video/7001';
    await page.getByLabel('or paste a link').fill(link);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Prepare this template' });
    await expect(dialog).toContainText('Preparing this template costs 1 credit.');
    await expect(dialog).toContainText('Balance now');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('region', { name: 'Your templates' })).not.toContainText('Preparing');

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('dialog', { name: 'Prepare this template' }).getByRole('button', { name: 'Prepare template' }).click();
    await expect(page.getByText(/Added\. It appears under/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your templates' })).toContainText(/Preparing|Ready/);

    await page.getByLabel('or paste a link').fill(link);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('You already added this video.')).toBeVisible();
  });
});
