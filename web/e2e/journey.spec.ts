import { expect, test } from '@playwright/test';
import { IMAGE_1, creditActivity, fillProduct, header, resetStore } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

test('a new customer signs up, verifies the email and makes the free video', async ({ page }) => {
  // Visitor: answers the cookie notice, then "Get started".
  await page.goto('/');
  const notice = page.getByRole('region', { name: 'Cookie notice' });
  await notice.getByRole('button', { name: 'Only necessary' }).click();
  await expect(notice).toBeHidden();
  await header(page).getByRole('link', { name: 'Get started' }).click();

  // Sign up → "verify your email".
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByLabel('Email').fill('journey@example.com');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: 'Verify your email.' })).toBeVisible();
  await expect(page.getByText('journey@example.com')).toBeVisible();

  // Before the email is verified: the public pages are open, every signed-in page leads back to "verify your email".
  await page.goto('/gallery');
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.getByRole('link', { name: 'Eye close-up with a day counter' })).toBeVisible();
  await page.goto('/videos');
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto('/templates/tpl-eye/generate');
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: 'Verify your email.' })).toBeVisible();

  // The fake "I opened the link in the email" → welcome.
  await page.getByRole('button', { name: 'Demo: open the link from the email' }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your first video is free.');
  await expect(header(page)).toContainText('1 free video');

  // Gallery → a template → "Clone it".
  await page.getByRole('link', { name: 'Pick a template' }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await page.getByRole('link', { name: 'Eye close-up with a day counter' }).click();
  await expect(page).toHaveURL(/\/templates\/tpl-eye$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Eye close-up with a day counter' })).toBeVisible();
  await page.getByRole('link', { name: 'Clone it' }).click();
  await expect(page).toHaveURL(/\/templates\/tpl-eye\/generate$/);

  // The form: an empty form is refused, then a name and an image.
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Two things to fix before generating.' })).toBeVisible();
  await fillProduct(page, 1, 'Journey Serum', IMAGE_1);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // The estimate: the first video is free, nothing is spent before the confirmation.
  const dialog = page.getByRole('dialog', { name: 'Confirm generation' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('This uses your one free video.')).toBeVisible();
  await expect(dialog.getByText('Credits for this job').locator('..')).toContainText('Free video · 0 credits');
  await expect(dialog.getByText('Final video').locator('..')).toContainText('13 sec · 9:16 · 720p');
  await dialog.getByRole('button', { name: 'Confirm and generate' }).click();

  // Progress page → result.
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  const jobUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Eye close-up with a day counter' })).toBeVisible();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your video is ready.', { timeout: 20_000 });
  await expect(page.getByText('Journey Serum')).toBeVisible();
  // The free video is used: the header shows the balance instead.
  await expect(header(page)).toContainText('0 credits');

  // My videos lists it, and the row opens the same job.
  await header(page).getByRole('link', { name: 'My videos' }).click();
  await expect(page).toHaveURL(/\/videos$/);
  const row = page.getByRole('listitem').filter({ hasText: 'Journey Serum' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('heading', { name: 'Eye close-up with a day counter' })).toBeVisible();
  await expect(row.getByText('Done', { exact: true })).toBeVisible();
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(jobUrl);

  // Account: the ledger has one entry, the free video, for 0 credits.
  await page.goto('/account');
  await expect(creditActivity(page).getByRole('listitem')).toHaveCount(1);
  await expect(creditActivity(page).getByRole('listitem')).toContainText('Free video');
});

test('"Change it" (wrong address) on the verify page ends the session and opens the sign-up form again', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill('typo@exmaple.com');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);

  await page.getByRole('button', { name: 'Change it' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account.' })).toBeVisible();
  // Signed out: the header is the visitor's again, and a signed-in page asks to log in.
  await page.goto('/videos');
  await expect(page).toHaveURL(/\/login\?next=%2Fvideos$/);
});
