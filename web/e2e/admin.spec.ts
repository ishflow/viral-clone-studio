import { expect, test, type Browser, type Page } from '@playwright/test';
import { creditActivity, header, resetStore, setCookies } from './helpers';
import { sessionCookie } from './session';

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

const ADMIN_PAGES = ['/admin', '/admin/users', '/admin/jobs', '/admin/templates/inbox', '/admin/settings'];

/** A second browser window with its own cookies: another person looking at the site at the same time. */
async function windowFor(browser: Browser, baseURL: string | undefined, session?: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  await setCookies(context, baseURL, { session, consent: 'necessary' });
  return context.newPage();
}

const tile = (page: Page, label: string) => page.locator('[data-tile-value]').locator('xpath=..').filter({ hasText: label }).locator('[data-tile-value]');

for (const path of ADMIN_PAGES) {
  test(`${path}: 403 for a signed-out visitor and a customer, the page for the admin`, async ({ request }) => {
    expect((await request.get(path)).status()).toBe(403);
    expect((await request.get(path, { headers: { cookie: `vc_session=${sessionCookie('usr-demo')}` } })).status()).toBe(403);
    expect((await request.get(path, { headers: { cookie: `vc_session=${sessionCookie('usr-admin')}` } })).status()).toBe(200);
  });
}

test('a customer who opens /admin sees the no-access page, not the panel', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-demo' });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page.');
  await expect(page.getByRole('navigation', { name: 'Admin menu' })).toHaveCount(0);
});

test.describe('as the admin', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setCookies(context, baseURL, { session: 'usr-admin', consent: 'necessary' });
  });

  test('adding credits needs a reason, and shows in the balance and the credit history of that user', async ({ page, browser, baseURL }) => {
    await page.goto('/admin/users/usr-free');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('free-only@example.com');
    await expect(tile(page, 'Balance')).toHaveText('0');
    const form = page.getByRole('group', { name: 'Add credits' });

    // A bad number: refused in the field, nothing opens.
    await form.getByRole('button', { name: 'Add credits' }).click();
    await expect(form.getByText('Enter a whole number from 1 to 10,000.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The confirmation shows the balances; no reason: refused, nothing changes.
    await form.getByLabel('Credits to add').fill('25');
    await form.getByRole('button', { name: 'Add credits' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add credits' });
    await expect(dialog.getByText('Balance after')).toBeVisible();
    await expect(dialog.getByText('This action is recorded with your name and the reason.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add credits' }).click();
    await expect(dialog.getByText('A reason is required. It is shown in the credit history.').first()).toBeVisible();
    await expect(tile(page, 'Balance')).toHaveText('0');

    await dialog.getByLabel('Reason').fill('Goodwill for a delayed video');
    await dialog.getByRole('button', { name: 'Add credits' }).click();
    const done = page.getByRole('dialog', { name: 'Done' });
    await expect(done.getByText('Balance after')).toBeVisible();
    await done.getByRole('button', { name: 'Close' }).click();
    await expect(tile(page, 'Balance')).toHaveText('25');
    const newest = page.getByRole('table', { name: 'Credit history' }).getByRole('row').nth(1);
    await expect(newest).toContainText('Admin');
    await expect(newest).toContainText('+25');
    await expect(newest).toContainText('Goodwill for a delayed video');
    await expect(newest.getByRole('cell').last()).toHaveText('25');

    // The user sees it too: balance, header, and the entry with the reason.
    const theirs = await windowFor(browser, baseURL, 'usr-free');
    await theirs.goto('/account');
    await expect(header(theirs)).toContainText('25 credits');
    await expect(theirs.getByLabel('25 credits')).toHaveText('25');
    await expect(creditActivity(theirs).getByRole('listitem').first()).toContainText('Goodwill for a delayed video');
    await expect(creditActivity(theirs).getByRole('listitem').first()).toContainText('+25');
    await theirs.context().close();
  });

  test('blocking a user asks first; a blocked user cannot log in and loses the session', async ({ page, browser, baseURL }) => {
    // The user is signed in before the block.
    const theirs = await windowFor(browser, baseURL, 'usr-paying');
    await theirs.goto('/account');
    await expect(theirs.getByRole('heading', { level: 1 })).toHaveText('Account');

    await page.goto('/admin/users/usr-paying');
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Block user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Block this user?' });
    await expect(dialog).toBeVisible();

    // Cancel changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // No reason: refused. With one: blocked, and the dialog says so before it closes.
    await page.getByRole('button', { name: 'Block user' }).click();
    await dialog.getByRole('button', { name: 'Block user' }).click();
    await expect(dialog.getByText('A reason is required.').first()).toBeVisible();
    await dialog.getByLabel('Reason').fill('Chargeback');
    await dialog.getByRole('button', { name: 'Block user' }).click();
    await page.getByRole('dialog', { name: 'Done' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Reason: Chargeback')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unblock user' })).toBeVisible();

    // Their open session ends: the next page they open says the account is blocked, not the account.
    await theirs.goto('/account');
    await expect(theirs).toHaveURL(/\/blocked$/);
    await expect(theirs.getByRole('heading', { level: 1 })).toHaveText('This account is blocked.');
    // And logging in again leads to the same page.
    await theirs.goto('/login');
    await theirs.getByLabel('Email').fill('paying@example.com');
    await theirs.getByLabel('Password').fill('demo-password');
    await theirs.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(theirs).toHaveURL(/\/blocked$/);

    // Unblock: the same log in works again, and the credits are still there.
    await page.getByRole('button', { name: 'Unblock user' }).click();
    const unblock = page.getByRole('dialog', { name: 'Unblock this user?' });
    await expect(unblock.getByText('Chargeback')).toBeVisible();
    await unblock.getByLabel('Reason').fill('Resolved');
    await unblock.getByRole('button', { name: 'Unblock user' }).click();
    await page.getByRole('dialog', { name: 'Done' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await theirs.goto('/account');
    await expect(theirs).toHaveURL(/\/login\?reason=expired&next=%2Faccount$/);
    await theirs.getByLabel('Email').fill('paying@example.com');
    await theirs.getByLabel('Password').fill('demo-password');
    await theirs.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(theirs).toHaveURL(/\/account$/);
    await expect(header(theirs)).toContainText('credits');
    await theirs.context().close();
  });

  test('the jobs table fits a 1440 px screen: no sideways scrolling, and Open and Retry job are whole', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/jobs?period=all');
    const scroller = page.getByRole('table', { name: 'Jobs' }).locator('xpath=..');
    expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.goto('/admin/jobs?status=stopped&period=all');
    const retry = page.getByRole('button', { name: 'Retry job' }).first();
    await expect(retry).toBeVisible();
    expect((await retry.boundingBox())!.x + (await retry.boundingBox())!.width).toBeLessThanOrEqual(1440);
  });

  test('the admin cannot block their own account', async ({ page }) => {
    await page.goto('/admin/users/usr-admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('admin@viralclone.app');
    await expect(page.getByRole('button', { name: 'Send password reset email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Block user' })).toHaveCount(0);
  });

  test('"Add to gallery" on a candidate waits for a category: Publish is not offered until one is chosen on the edit page, then the template appears in the public gallery', async ({ page, browser, baseURL }) => {
    const title = 'Mascara routine and fast photo montage';
    const visitor = await windowFor(browser, baseURL);
    await visitor.goto('/gallery');
    await expect(visitor.getByRole('link', { name: title })).toHaveCount(0);

    await page.goto('/admin/templates/inbox');
    // As on the board: the link field is wide enough for its placeholder and "Add candidate" stays on one line.
    const linkField = (await page.getByLabel('Video link').boundingBox())!;
    const addButton = (await page.getByRole('button', { name: 'Add candidate' }).boundingBox())!;
    expect(linkField.width).toBeGreaterThan(320);
    expect(linkField.width + 12 + addButton.width).toBeCloseTo(520, 0);
    const waiting = page.getByRole('region', { name: 'Templates waiting to publish' });
    const candidates = page.getByRole('region', { name: 'Candidates' });
    await expect(waiting).toContainText('Nothing is waiting.');
    await candidates.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Add to gallery' }).click();

    // The candidate leaves the list and waits as a template; it is not public yet.
    await expect(waiting.getByRole('heading', { name: title })).toBeVisible();
    await expect(candidates.getByRole('listitem').filter({ hasText: title })).toHaveCount(0);
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: title })).toHaveCount(0);

    // A candidate has no category: the card asks for one instead of offering Publish.
    await expect(waiting).toContainText('Choose a category before publishing.');
    await expect(waiting.getByRole('button', { name: 'Publish' })).toHaveCount(0);

    // The admin chooses one on the template's edit page and saves; the template still waits, and is not public.
    await page.goto('/admin/templates?status=waiting');
    await page.getByRole('row').filter({ hasText: title }).getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByLabel('Category').selectOption('Lashes');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved.')).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: title })).toHaveCount(0);

    // Back on the inbox the card now offers Publish.
    await page.goto('/admin/templates/inbox');
    await expect(waiting).not.toContainText('Choose a category before publishing.');
    await waiting.getByRole('button', { name: 'Publish' }).click();
    await expect(waiting).toContainText('Nothing is waiting.');

    const errors: string[] = [];
    visitor.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: title })).toBeVisible();
    // The chosen category shows on the card; the gallery gets no extra filter pill.
    await expect(visitor.getByRole('group', { name: 'Category' }).getByRole('link')).toHaveText(['All', 'Fragrance', 'Lashes', 'Hair']);
    const card = visitor.getByRole('article').filter({ hasText: title });
    await expect(card).toContainText('Lashes');
    expect(errors).toEqual([]);
    await visitor.getByRole('link', { name: title }).click();
    await expect(visitor.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await visitor.context().close();
  });

  test('hiding a template asks first; then it is gone from the gallery', async ({ page, browser, baseURL }) => {
    const title = 'Shower routine: problem, result, how to use';
    const visitor = await windowFor(browser, baseURL);
    await visitor.goto('/gallery');
    await expect(visitor.getByRole('link', { name: title })).toBeVisible();

    await page.goto('/admin/templates/tpl-shower');
    await page.getByRole('button', { name: 'Hide template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Hide this template?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: title })).toBeVisible();

    await page.getByRole('button', { name: 'Hide template' }).click();
    await dialog.getByRole('button', { name: 'Hide template' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The template is hidden.' })).toBeVisible();

    await visitor.reload();
    await expect(visitor.getByRole('link', { name: title })).toHaveCount(0);
    const direct = await visitor.goto('/templates/tpl-shower');
    expect(direct?.status()).toBe(404);
    await visitor.context().close();
  });
});
