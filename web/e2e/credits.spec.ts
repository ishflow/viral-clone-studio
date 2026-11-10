import { expect, test, type Page } from '@playwright/test';
import { IMAGE_1, creditActivity, fillProduct, header, resetStore, setCookies } from './helpers';

// usr-demo starts with 19 credits (D0 Ruling 1). The presenter story is a talking template with one product: Best × 3 variants costs 24.
test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
});

const pack = (page: Page, name: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
const row = (page: Page, label: string) => page.getByRole('dialog').getByText(label, { exact: true }).locator('..');

test('not enough credits → buy a pack → pay → back to the form → the job starts', async ({ page }) => {
  await page.goto('/templates/tpl-story/generate');
  await expect(header(page)).toContainText('19 credits');
  await fillProduct(page, 1, 'Credits Serum', IMAGE_1);
  await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
  await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // The not-enough dialog: what it costs, what is there, what is missing; no way to confirm.
  const dialog = page.getByRole('dialog', { name: 'Confirm generation' });
  await expect(dialog.getByRole('alert')).toContainText('You need 24 credits and have 19 credits. Nothing was charged. Your form is saved.');
  await expect(row(page, 'Credits for this job')).toContainText('24 credits');
  await expect(row(page, 'Balance now')).toContainText('19 credits');
  await expect(dialog).not.toContainText('After this job');
  await expect(dialog.getByRole('button', { name: 'Confirm and generate' })).toHaveCount(0);
  await dialog.getByRole('link', { name: 'Buy credits' }).click();

  // Pricing remembers where the buyer came from → the fake provider → Pay.
  await expect(page).toHaveURL(/\/pricing\?returnTo=%2Ftemplates%2Ftpl-story%2Fgenerate$/);
  // Buy is a form (a POST): no address on the page opens a checkout.
  await expect(page.locator('a[href*="/checkout"]')).toHaveCount(0);
  await pack(page, 'Starter').getByRole('button', { name: 'Buy' }).click();
  await expect(page).toHaveURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Payment provider (demo)' })).toBeVisible();
  await expect(header(page)).toContainText('19 credits');
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  // Success: the credits, the new balance, the waiting video.
  await expect(page).toHaveURL(/\/checkout\/success\?purchase=/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('10 credits added.');
  await expect(page.getByText('Your balance is now 29 credits.')).toBeVisible();
  // The receipt: pack, credits, what was paid (the real amount) and the date; the new balance is in the sentence above and in the header.
  const receipt = page.getByRole('region', { name: 'Receipt' });
  await expect(receipt).toContainText('Starter pack');
  await expect(receipt).toContainText('$19.00');
  await expect(page.getByText('Your form is saved.')).toBeVisible();
  await expect(header(page)).toContainText('29 credits');
  await expect(page.getByRole('region', { name: 'Your video is waiting' })).toContainText('"I tried it for 4 weeks" presenter story');
  await page.getByRole('link', { name: 'Back to your video' }).click();

  // Back on the form: the entries are kept, the image is added again, and now the estimate can be confirmed.
  await expect(page).toHaveURL(/\/templates\/tpl-story\/generate$/);
  await expect(page.getByRole('status').filter({ hasText: 'We kept your entries from your last visit.' })).toBeVisible();
  await expect(page.getByLabel('Product name')).toHaveValue('Credits Serum');
  await expect(page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Add image').setInputFiles(IMAGE_1);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(row(page, 'Credits for this job')).toContainText('24 credits');
  await expect(row(page, 'After this job')).toContainText('5 credits');
  await dialog.getByRole('button', { name: 'Confirm and generate' }).click();

  // The job starts and the header shows what is left: 19 + 10 − 24.
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('3 variants are ready.', { timeout: 20_000 });
  await expect(header(page)).toContainText('5 credits');

  // Account → Credit activity: the generation and the purchase are the two newest entries.
  await page.goto('/account');
  await expect(page.getByLabel('5 credits')).toHaveText('5');
  const entries = creditActivity(page).getByRole('listitem');
  await expect(entries).toHaveCount(9);
  await expect(entries.nth(0)).toContainText('"I tried it for 4 weeks" presenter story');
  await expect(entries.nth(0)).toContainText('Generation');
  await expect(entries.nth(0)).toContainText('−24');
  await expect(entries.nth(1)).toContainText('Starter pack');
  await expect(entries.nth(1)).toContainText('Purchase');
  await expect(entries.nth(1)).toContainText('+10');
  // The purchase is on the Account page (Purchases) with its paid state, its amount and its invoice.
  const bought = page.getByRole('region', { name: 'Purchases' }).getByRole('listitem').filter({ hasText: 'Starter pack' }).first();
  await expect(bought).toContainText('$19.00');
  await expect(bought.getByRole('link', { name: 'Download invoice' })).toBeVisible();
});

test('a declined payment shows the failed page and leaves the balance; "Try another payment method" opens the payment page again', async ({ page }) => {
  await page.goto('/pricing');
  await pack(page, 'Standard').getByRole('button', { name: 'Buy' }).click();
  await expect(page).toHaveURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
  const declined = page.url();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();

  await expect(page).toHaveURL(/\/checkout\/failed\?purchase=/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The payment was declined.');
  await expect(page.getByText('Nothing was charged. Your balance is still 19 credits.')).toBeVisible();
  await expect(header(page)).toContainText('19 credits');

  // Nothing was written to the ledger.
  const failedUrl = page.url();
  await page.goto('/account');
  await expect(creditActivity(page).getByRole('listitem')).toHaveCount(7);
  await expect(page.getByLabel('19 credits')).toHaveText('19');

  // "Try another payment method": a new checkout for the same pack, and this time it is paid.
  await page.goto(failedUrl);
  await page.getByRole('button', { name: /Try another payment method/ }).click();
  await expect(page).toHaveURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
  expect(page.url()).not.toBe(declined);
  await expect(page.getByText('Standard pack')).toBeVisible();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/success\?purchase=/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('30 credits added.');
  await expect(header(page)).toContainText('49 credits');

  // The declined checkout stays declined: its page offers the result, not another payment.
  await page.goto(declined);
  await expect(page.getByRole('status')).toHaveText('This payment is already settled.');
  await expect(page.getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0);
});

test('the old checkout address opens nothing: a GET only lands on the pricing page', async ({ page }) => {
  await page.goto('/checkout/start?pack=pack-standard&returnTo=%2Fgallery');
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'Payment provider (demo)' })).toHaveCount(0);
  // Nothing was bought and nothing is pending: the balance and the ledger are as before.
  await page.goto('/account');
  await expect(page.getByLabel('19 credits')).toHaveText('19');
  await expect(creditActivity(page).getByRole('listitem')).toHaveCount(7);
});

test('a visitor who presses Buy is sent to sign up, and comes back to pricing', async ({ page, context }) => {
  await context.clearCookies({ name: 'vc_session' });
  await page.goto('/pricing');
  await pack(page, 'Standard').getByRole('link', { name: 'Buy' }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fpricing$/);
});
