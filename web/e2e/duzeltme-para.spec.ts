import { expect, test, type Page } from '@playwright/test';
import { resetStore, setCookies } from './helpers';

// Task DF2: the money screens show the right numbers, and an account that is not verified is sent to verify its email.
test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { consent: 'necessary' });
});

const sideways = (page: Page) => page.evaluate(() => {
  const scroll = document.querySelector('.invoice-scroll') as HTMLElement;
  return {
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sheet: scroll.scrollWidth - scroll.clientWidth,
  };
});

test.describe('the invoice on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fits the screen without sideways scrolling, and the total is in view', async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
    await page.goto('/invoices/inv-demo-standard');
    const total = page.getByLabel('Totals').getByText('Total', { exact: true }).locator('xpath=following-sibling::dd');
    await expect(total).toBeVisible();
    await expect(total).not.toContainText('[');
    expect(await sideways(page)).toEqual({ page: 0, sheet: 0 });
    const box = (await total.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });

  test('on paper the sheet keeps its A4 padding and the two parties stay side by side', async ({ page, context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
    await page.goto('/invoices/inv-demo-standard');
    await page.emulateMedia({ media: 'print' });
    const sheet = page.locator('.invoice-sheet');
    await expect(sheet).toHaveCSS('padding-left', '72px');
    await expect(page.getByLabel('Seller and customer')).toHaveCSS('flex-direction', 'row');
  });
});

test('logging in with an email that is not verified opens the verify-email page, not the page asked for', async ({ page, context, baseURL }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill('notyet@example.com');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);

  await context.clearCookies();
  await setCookies(context, baseURL, { consent: 'necessary' });
  await page.goto('/login?next=%2Fpricing');
  await page.getByLabel('Email').fill('notyet@example.com');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
});
