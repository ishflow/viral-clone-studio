import { expect, test } from '@playwright/test';
import { IMAGE_1, IMAGE_2, creditActivity, fillProduct, header, resetStore, setCookies } from './helpers';

test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
});

// "Dupe comparison" (tpl-stop) always stops at the clips step with 3 of 5 clips ready. Fast × 1 variant costs 2 credits; the stop gives
// them back at once (B1) and the resume charges what came back, 2 (K6). usr-demo starts with 19 (D0 Ruling 1).
test('a job that stops shows why and what to do; nothing is charged before the confirmation; confirming resumes it and the ledger shows the charge', async ({ page }) => {
  await page.goto('/templates/tpl-stop/generate');
  await fillProduct(page, 1, 'Stop Perfume', IMAGE_1);
  await fillProduct(page, 2, 'Stop Mist', IMAGE_2);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm generation' }).getByRole('button', { name: 'Confirm and generate' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);

  // The stopped view: the reason in words (never the code) and both ways to go on.
  const options = page.getByRole('region', { name: 'What happened and your options' });
  await expect(options).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await expect(options.getByRole('heading', { name: 'Two clips are missing' })).toBeVisible();
  await expect(options).toContainText('The 2 credits for this video are back in your balance. The 5 finished images, 3 clips and the music are saved.');
  await expect(options).toContainText('You can continue until');
  const summary = (label: string) => options.getByText(label, { exact: true }).locator('..');
  await expect(summary('Charged when you confirmed')).toContainText('2 credits');
  await expect(summary('Returned when it stopped')).toContainText('2 credits');
  await expect(summary('To continue')).toContainText('2 credits');
  await expect(page.locator('main')).not.toContainText('clips-failed');
  const continueButton = options.getByRole('button', { name: /Continue with the backup model/ });
  const retryButton = options.getByRole('button', { name: /Try again/ });
  await expect(continueButton).toContainText('Same price. The look may differ slightly.');
  await expect(retryButton).toContainText('Same price. The same model generates the 2 missing clips again.');
  // Stopping gave the 2 credits back.
  await expect(header(page)).toContainText('19 credits');

  // Neither option charges on the click. "Continue with the backup model" opens the confirmation: what, the cost, the balance.
  const confirm = page.getByRole('dialog', { name: /^(Continue with the backup model|Try again)$/ });
  const row = (label: string) => confirm.getByText(label, { exact: true }).locator('..');
  await continueButton.click();
  await expect(page.getByRole('dialog', { name: 'Continue with the backup model' })).toContainText('Same price. The look may differ slightly.');
  await expect(row('Missing')).toContainText('2 clips');
  await expect(row('Credits returned when it stopped')).toContainText('2 credits');
  await expect(row('Continuing costs')).toContainText('2 credits');
  await expect(row('Balance after')).toContainText('17 credits');
  // Cancel: the job is still stopped and nothing was spent, also after a reload.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await page.reload();
  await expect(options).toBeVisible();
  await expect(header(page)).toContainText('19 credits');

  // "Try again" asks too; "Confirm and continue" is what charges. The job goes on from the clips and finishes.
  await retryButton.click();
  await expect(page.getByRole('dialog', { name: 'Try again' })).toContainText('The same model generates the 2 missing clips again.');
  await expect(row('Continuing costs')).toContainText('2 credits');
  await expect(header(page)).toContainText('19 credits');
  await confirm.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(confirm).toBeHidden(); // the dialog has a level-1 heading of its own while it is open
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your video is ready.', { timeout: 20_000 });
  await expect(header(page)).toContainText('17 credits');

  // The ledger: the first charge, the credits that came back with the stop, the resume charge.
  await page.goto('/account');
  const entries = creditActivity(page).getByRole('listitem');
  await expect(entries).toHaveCount(10);
  await expect(entries.nth(0)).toContainText('Dupe comparison');
  await expect(entries.nth(0)).toContainText('−2');
  await expect(entries.nth(1)).toContainText('Dupe comparison');
  await expect(entries.nth(1)).toContainText('+2');
  await expect(entries.nth(2)).toContainText('Dupe comparison');
  await expect(entries.nth(2)).toContainText('−2');
  await expect(page.getByLabel('17 credits')).toHaveText('17');
});

test('the stop reason is translated: the stopped job of the fixtures in Turkish', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { locale: 'tr' });
  await page.goto('/jobs/job-demo-stopped');
  const options = page.getByRole('region', { name: 'Ne oldu ve seçeneklerin' });
  await expect(options.getByRole('heading', { name: 'İki klip eksik' })).toBeVisible();
  await expect(options).toContainText('Bu videonun 5 kredisi bakiyene geri döndü.');
  await expect(options.getByRole('button', { name: /Yedek modelle devam et/ })).toBeVisible();
  await expect(options.getByRole('button', { name: /Tekrar dene/ })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('clips-failed');
  // The confirmation is translated too, and it has the balance of the fixtures (19).
  await options.getByRole('button', { name: /Tekrar dene/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Tekrar dene' });
  await expect(confirm).toContainText('Aynı modelle yeniden üretilecek: 2 eksik klip.');
  await expect(confirm.getByText('Sonraki bakiye', { exact: true }).locator('..')).toContainText('14 kredi');
  await expect(confirm.getByRole('button', { name: 'Onayla ve devam et' })).toBeVisible();
});

test('not enough credits for the missing part: no way to confirm; buying comes back to the stopped job', async ({ page }) => {
  // Spend the balance of 19 down to 0: Best × 1 variant on a no-talking template costs 5, Fast costs 2 (a third job at once is
  // charged and queued, B3). The stopped fixture (Best) gave its 5 credits back: continuing it costs 5 (K6).
  for (const quality of ['Best', 'Best', 'Best', 'Fast', 'Fast']) {
    await page.goto('/templates/tpl-eye/generate');
    await fillProduct(page, 1, 'Spend Serum', IMAGE_1);
    await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: new RegExp(quality) }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirm generation' }).getByRole('button', { name: 'Confirm and generate' }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  }
  await expect(header(page)).toContainText('0 credits');

  await page.goto('/jobs/job-demo-stopped');
  await page.getByRole('button', { name: /Continue with the backup model/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Continue with the backup model' });
  await expect(confirm.getByRole('alert')).toContainText('You need 5 credits to continue and have 0 credits.');
  await expect(confirm).toContainText('The saved parts wait for you until');
  await expect(confirm.getByRole('button', { name: 'Confirm and continue' })).toHaveCount(0);
  await confirm.getByRole('link', { name: 'Buy credits' }).click();
  await expect(page).toHaveURL(/\/pricing\?returnTo=%2Fjobs%2Fjob-demo-stopped$/);

  // Buy → pay → the success page offers the way back to the job first.
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Starter', exact: true }) }).getByRole('button', { name: 'Buy' }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/success\?purchase=/);
  await page.getByRole('link', { name: 'Back to where you were' }).click();
  await expect(page).toHaveURL(/\/jobs\/job-demo-stopped$/);
  await expect(header(page)).toContainText('10 credits');
  await expect(page.getByRole('region', { name: 'What happened and your options' })).toBeVisible();
});
