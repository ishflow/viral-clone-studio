import { expect, test, type Page } from '@playwright/test';
import { header, photo, resetStore, setCookies } from './helpers';

// The switch of person swap, from the admin's Settings screen to the customer's site, on one server (VC_FAKE_SWAP=1 starts with it on):
// off, nothing of person swap shows to a customer; on, it shows; off again, it is gone again.

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

const swapLinks = (page: Page) => page.locator('a[href^="/swap"]');

/** The admin's Settings screen: person swap for customers set to `on`, saved. */
async function setSwitch(admin: Page, on: boolean) {
  await admin.goto('/admin/settings');
  const toggle = admin.getByRole('button', { name: 'Person swap for customers', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(on));
  await admin.getByLabel('Shorts hashtags').fill('skincare');   // the fixtures scan Shorts with no hashtag, and the form refuses that
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
}

/** A customer who can see person swap starts one video and waits for it: the job page and My videos then hold a person-swap video. */
async function startedJob(customer: Page): Promise<string> {
  await customer.goto('/swap/tpl-swap');
  await customer.getByLabel('Add full-body photo').setInputFiles(await photo(customer, 'me.png', 500, 800));
  await expect(customer.getByAltText('Your full-body photo')).toBeVisible();
  for (const box of await customer.getByRole('group', { name: 'Before you start' }).getByRole('checkbox').all()) await box.check();
  await customer.getByRole('button', { name: 'Start', exact: true }).click();
  await customer.getByRole('dialog', { name: 'Confirm and start' }).getByRole('button', { name: 'Confirm and start' }).click();
  await customer.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(customer.getByRole('heading', { level: 1, name: 'Your video is ready.' })).toBeVisible({ timeout: 30_000 });
  return new URL(customer.url()).pathname;
}

async function expectClosed(customer: Page, job: string) {
  for (const path of ['/swap', '/swap/tpl-swap']) expect((await customer.goto(path))?.status(), path).toBe(404);
  for (const path of ['/gallery', '/videos', job]) {
    await customer.goto(path);
    await expect(header(customer)).toBeVisible();
    await expect(swapLinks(customer), `a link to person swap on ${path}`).toHaveCount(0);
  }
  await customer.setViewportSize({ width: 390, height: 844 });
  await customer.goto('/videos');
  await header(customer).getByRole('button', { name: 'Open menu' }).click();
  await expect(customer.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Gallery' })).toBeVisible();
  await expect(swapLinks(customer), 'a link to person swap in the phone menu').toHaveCount(0);
  await customer.setViewportSize({ width: 1280, height: 720 });
}

async function expectOpen(customer: Page) {
  expect((await customer.goto('/swap'))?.status()).toBe(200);
  expect((await customer.goto('/swap/tpl-swap'))?.status()).toBe(200);
  await customer.goto('/gallery');
  await expect(header(customer).getByRole('link', { name: 'Person swap' })).toHaveAttribute('href', '/swap');
  await customer.goto('/videos');
  await expect(header(customer).getByRole('link', { name: 'Person swap' })).toBeVisible();
}

test('the admin closes and opens person swap in Settings, and the customer site follows each time', async ({ browser, baseURL }) => {
  const windowFor = async (session: string) => {
    const context = await browser.newContext({ baseURL });
    await setCookies(context, baseURL, { session, consent: 'necessary' });
    return context.newPage();
  };
  const customer = await windowFor('usr-demo');
  const admin = await windowFor('usr-admin');

  await expectOpen(customer);
  const job = await startedJob(customer);

  await setSwitch(admin, false);
  await expectClosed(customer, job);

  await setSwitch(admin, true);
  await expectOpen(customer);

  await setSwitch(admin, false);
  await expectClosed(customer, job);

  await customer.context().close();
  await admin.context().close();
});
