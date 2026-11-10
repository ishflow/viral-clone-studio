import { expect, test } from '@playwright/test';
import { resetStore, setCookies } from './helpers';

test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { session: 'usr-paying', consent: 'necessary' });
});

const LINK = 'https://www.tiktok.com/@someone/video/7002';

test.describe('a part of the video (fake engine)', () => {
  test('a link with the part 0:30 to 1:20: the length is shown live, the window names the part, and the template is being prepared', async ({ page }) => {
    await page.goto('/templates/new');
    await expect(page.getByLabel('Start', { exact: true })).toHaveCount(0);
    await page.getByLabel('or paste a link').fill(LINK);
    await page.getByRole('checkbox', { name: 'Use only a part of the video' }).check();
    await page.getByLabel('Start', { exact: true }).fill('0:30');
    await page.getByLabel('End', { exact: true }).fill('1:20');
    await expect(page.getByText('Selected: 50 sec')).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Prepare this template' });
    await expect(dialog).toContainText('Part0:30 – 1:20 (50 sec)');
    await dialog.getByRole('button', { name: 'Prepare template' }).click();
    await expect(page.getByText(/Added\. It appears under/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your templates' })).toContainText(/Preparing|Ready/);
  });

  test('the same link with another part is not a duplicate; the same part is', async ({ page }) => {
    await page.goto('/templates/new');
    const addPart = async (from: string, to: string) => {
      await page.getByLabel('or paste a link').fill(LINK);
      const use = page.getByRole('checkbox', { name: 'Use only a part of the video' });
      if (!(await use.isChecked())) await use.check();
      await page.getByLabel('Start', { exact: true }).fill(from);
      await page.getByLabel('End', { exact: true }).fill(to);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    };
    await addPart('0:30', '1:20');
    await page.getByRole('dialog', { name: 'Prepare this template' }).getByRole('button', { name: 'Prepare template' }).click();
    await expect(page.getByText(/Added\. It appears under/)).toBeVisible();

    await addPart('2:00', '2:30');
    await expect(page.getByRole('dialog', { name: 'Prepare this template' })).toContainText('Part2:00 – 2:30 (30 sec)');
    await page.getByRole('dialog', { name: 'Prepare this template' }).getByRole('button', { name: 'Cancel' }).click();

    await addPart('0:30', '1:20');
    await expect(page.getByText('You already added this video.')).toBeVisible();
  });

  test('a part over a minute shows one red line and closes the Add button', async ({ page }) => {
    await page.goto('/templates/new');
    await page.getByRole('checkbox', { name: 'Use only a part of the video' }).check();
    const add = page.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeDisabled();
    await page.getByLabel('Start', { exact: true }).fill('0:00');
    await page.getByLabel('End', { exact: true }).fill('1:30');
    await expect(page.getByRole('alert').filter({ hasText: 'The part can be at most 1 min.' })).toBeVisible();
    await expect(add).toBeDisabled();
    await page.getByLabel('End', { exact: true }).fill('0:50');
    await expect(add).toBeEnabled();
  });
});

// Screenshots for the designer's eye: only when B4_SHOTS names a folder (and B4_LONG_VIDEO a video of about 2.5 minutes for the file card).
const SHOTS = process.env.B4_SHOTS;
const LONG_VIDEO = process.env.B4_LONG_VIDEO;
test.describe('screenshots', () => {
  test.skip(!SHOTS, 'B4_SHOTS is not set');
  for (const locale of ['en', 'tr'] as const) {
    for (const [name, size] of [['desktop', { width: 1280, height: 900 }], ['375', { width: 375, height: 812 }]] as const) {
      test(`${locale} ${name}`, async ({ page, context, baseURL }) => {
        await setCookies(context, baseURL, { session: 'usr-paying', consent: 'necessary', locale });
        await page.setViewportSize(size);
        await page.goto('/templates/new');
        const start = page.getByLabel(locale === 'en' ? 'Start' : 'Başlangıç', { exact: true });
        const end = page.getByLabel(locale === 'en' ? 'End' : 'Bitiş', { exact: true });
        await page.getByLabel(locale === 'en' ? 'or paste a link' : 'ya da bir bağlantı yapıştır').fill(LINK);
        await page.getByRole('checkbox').check();
        await page.screenshot({ path: `${SHOTS}/link-empty-${locale}-${name}.png`, fullPage: true });
        await start.fill('0:30');
        await end.fill('1:20');
        await page.screenshot({ path: `${SHOTS}/link-picked-${locale}-${name}.png`, fullPage: true });
        await start.fill('0:00');
        await end.fill('1:30');
        await page.screenshot({ path: `${SHOTS}/link-too-long-${locale}-${name}.png`, fullPage: true });
        if (LONG_VIDEO) {
          await page.reload();
          await page.locator('input[type="file"]').setInputFiles(LONG_VIDEO);
          await start.waitFor();
          await start.fill('0:30');
          await end.fill('2:55');
          await page.screenshot({ path: `${SHOTS}/file-outside-${locale}-${name}.png`, fullPage: true });
          await end.fill('1:20');
          await page.screenshot({ path: `${SHOTS}/file-picked-${locale}-${name}.png`, fullPage: true });
        }
      });
    }
  }
});
