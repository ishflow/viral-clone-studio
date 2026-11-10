import { expect, test, type Page } from '@playwright/test';
import { header, resetStore, setCookies } from './helpers';

// Task FA, round 2: one flow per new user path of the purchase / account access / account area (fake mode).
// The fake clock runs at 20× (VC_FAKE_SPEED=20): the 60 seconds of "confirming" are about 3 real seconds.

test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { consent: 'necessary' });
});

const pack = (page: Page, name: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Pricing → Buy → the fake provider page. */
async function openProvider(page: Page, packName: string): Promise<string> {
  await page.goto('/pricing');
  await pack(page, packName).getByRole('button', { name: 'Buy' }).click();
  await expect(page).toHaveURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
  return page.url();
}

test.describe('payment return', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  });

  test('pending → "Confirming" → "Still confirming" (delayed) → the late answer adds the credits once', async ({ page }) => {
    test.setTimeout(150_000);
    const provider = await openProvider(page, 'Standard');
    await page.getByRole('button', { name: 'Pending', exact: true }).click();

    // Confirming: no payment button, the reference, nothing added yet.
    await expect(page).toHaveURL(/\/checkout\/return\?checkout=[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirming your payment…');
    await expect(page.getByText('Do not pay again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0);
    await expect(header(page)).toContainText('19 credits');

    // The page asks again on its own; the server turns "confirming" into "delayed" after 60 seconds of the real clock (the fake clock's
    // speed-up does not apply to the checkout wait), so this test is the one slow flow of the file.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('We are still waiting for the payment provider.', { timeout: 90_000 });
    await expect(page.getByText(/Reference PAY-/)).toBeVisible();
    await expect(page.getByText('You do not need to pay again.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check again' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', /\/contact\?topic=payment/);
    await expect(header(page)).toContainText('19 credits');
    // "Check again" opens the return page again; it still follows the stored checkout.
    await page.getByRole('link', { name: 'Check again' }).click();
    await expect(page).toHaveURL(/\/checkout\/return\?checkout=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('We are still waiting for the payment provider.');

    // The provider answers late: Pay on the provider page → the success page, the credits are there once.
    await page.goto(provider);
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/success\?purchase=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('30 credits added.');
    await expect(header(page)).toContainText('49 credits');
    await page.reload();
    await expect(header(page)).toContainText('49 credits');
  });

  test('cancel and expire are drawn on the return page; nothing is charged and no payment button is offered', async ({ page }) => {
    await openProvider(page, 'Starter');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('You left the checkout.');
    await expect(page.getByText('Nothing was charged.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to pricing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0);

    await openProvider(page, 'Starter');
    await page.getByRole('button', { name: 'Expire', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This checkout expired.');
    await expect(header(page)).toContainText('19 credits');
  });

  test('the return page follows the stored checkout, not the address: someone else\'s or an unknown checkout is a 404', async ({ page }) => {
    const res = await page.goto('/checkout/return?checkout=00000000-0000-4000-8000-000000000000');
    expect(res?.status()).toBe(404);
  });
});

test.describe('refund request', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  });

  test('buy a pack → Request a refund (nothing is sent before the confirmation) → requested → Cancel request', async ({ page }) => {
    await openProvider(page, 'Starter');
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/success\?purchase=/);

    await page.goto('/account');
    const purchases = page.getByRole('region', { name: 'Purchases' });
    const bought = purchases.getByRole('listitem').filter({ hasText: 'Starter pack' }).first();
    await expect(bought).toContainText('Paid');
    await expect(bought).toContainText('$19.00');

    // The dialog: the safe button is "Keep the credits"; closing it sends nothing.
    await bought.getByRole('button', { name: 'Request a refund' }).click();
    const dialog = page.getByRole('dialog', { name: /Request a refund for/ });
    await expect(dialog).toContainText('The 10 credits are held until we answer.');
    await dialog.getByRole('button', { name: 'Keep the credits' }).click();
    await expect(dialog).toBeHidden();
    await expect(bought).toContainText('Paid');
    await expect(bought.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);

    // Confirm: the state becomes "Refund requested", the credits are held, the way back is offered.
    await bought.getByRole('button', { name: 'Request a refund' }).click();
    await page.getByRole('dialog', { name: /Request a refund for/ }).getByRole('button', { name: 'Request refund' }).click();
    await expect(bought).toContainText('Refund requested');
    await expect(bought).toContainText('The 10 credits are held until then.');
    await expect(page.getByText('10 more credits are held for a refund request.')).toBeVisible();
    await expect(bought.getByRole('button', { name: 'Request a refund' })).toHaveCount(0);

    // Cancel the request: the credits are available again and the refund can be asked for again.
    await bought.getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.getByText('Request cancelled. Your 10 credits are available again.')).toBeVisible();
    await expect(bought).toContainText('Paid');
    await expect(page.getByText('10 more credits are held for a refund request.')).toHaveCount(0);
    await expect(bought.getByRole('button', { name: 'Request a refund' })).toBeVisible();
  });
});

test('the invoice of a purchase prints the real line, subtotal and support placeholder', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
  await openProvider(page, 'Starter');
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await page.goto('/account');
  await page.getByRole('region', { name: 'Purchases' }).getByRole('link', { name: 'Download invoice' }).first().click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
  const sheet = page.locator('.invoice-sheet');
  await expect(sheet.getByText('Starter pack')).toBeVisible();
  await expect(sheet.getByText('10 credits for Viral Clone')).toBeVisible();
  await expect(sheet.getByText('$19.00')).toHaveCount(3); // unit price, line amount, subtotal
  await expect(sheet).not.toContainText('[PRICE]');
  await expect(sheet).toContainText('Support: [SUPPORT EMAIL]');
});

test('contact: a second message of the same sender, from a new page load, is sent (not "already sent")', async ({ page }) => {
  for (const [n, message] of [[1, 'The first question about my order.'], [2, 'A second, different question later.']] as const) {
    await page.goto('/contact');
    await page.getByLabel('Your email').fill('asker@example.com');
    await page.getByLabel('Message').fill(message);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(new RegExp(`Reference S-00000${n}`))).toBeVisible();
    await expect(page.getByText('You already sent this message.')).toHaveCount(0);
  }
});

test.describe('sign-up → verification link', () => {
  test('the link of the verification email verifies once; the same link again says it is already verified', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill('linkflow@example.com');
    await page.getByLabel('Password').fill('a-long-password');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.getByText('linkflow@example.com')).toBeVisible();
    // Right after signing up the next link is a minute away: the button says so and does not send.
    await expect(page.getByRole('button', { name: /Send again/ })).toBeVisible();

    // The email in the (fake) outbox carries the single-use link.
    await page.goto('/dev/emails');
    await page.getByRole('listitem').filter({ hasText: 'linkflow@example.com' }).getByRole('link', { name: 'Preview' }).click();
    const link = page.getByRole('link', { name: 'Verify email' });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/verify-email\/confirm\?token=.+/);

    await page.goto(href!);
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your first video is free.');
    await expect(header(page)).toContainText('1 free video');

    // Single use.
    await page.goto(href!);
    await expect(page).toHaveURL(/\/verify-email\/expired\?state=used$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your email is already verified.');
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
  });

  test('a link nobody issued is the "expired" page', async ({ page }) => {
    await page.goto('/verify-email/confirm?token=nope');
    await expect(page).toHaveURL(/\/verify-email\/expired$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link has expired.');
    await expect(page.getByRole('link', { name: 'Send a new link' })).toBeVisible();
  });
});

test.describe('reset link', () => {
  test('forgot → sent → the link in the email → a new password → log in with it; the link works once', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('demo@viralclone.app');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page).toHaveURL(/\/forgot-password\/sent\?email=demo%40viralclone\.app$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check your inbox.');
    await expect(page.getByText('It works for 1 hour.')).toBeVisible();

    const demoLink = page.getByRole('link', { name: 'Demo: open the reset link' });
    const href = await demoLink.getAttribute('href');
    expect(href).toMatch(/^\/reset-password\?token=.+/);
    await demoLink.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set a new password.');
    await expect(page.getByText('For demo@viralclone.app.')).toBeVisible();

    // Two different passwords are refused; then the new one is saved and the person logs in with it.
    await page.getByLabel('New password', { exact: true }).fill('another-long-password');
    await page.getByLabel('Repeat new password').fill('something-else-entirely');
    await page.getByRole('button', { name: 'Save and log in' }).click();
    await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
    // A refused form is emptied by the browser: both fields are filled again.
    await page.getByLabel('New password', { exact: true }).fill('another-long-password');
    await page.getByLabel('Repeat new password').fill('another-long-password');
    await page.getByRole('button', { name: 'Save and log in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill('demo@viralclone.app');
    await page.getByLabel('Password').fill('another-long-password');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(header(page)).toContainText('credits');

    // Single use: the same link is a dead end with a way to ask for a new one.
    await page.goto(href!);
    await expect(page).toHaveURL(/\/reset-password\/invalid$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This reset link no longer works.');
    await expect(page.getByRole('link', { name: 'Send a new link' })).toBeVisible();
  });

  test('a reset page without a link goes to the forgot form', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});
