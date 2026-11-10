import { expect, test, type Page } from '@playwright/test';
import { IMAGE_1, IMAGE_2, creditActivity, fillProduct, header, resetStore, setCookies } from './helpers';

// B2: the states of a job page and of My videos that the stopped-job spec does not walk: closing a stopped job, the queue, the content
// rules, a stopped free video, deleting a finished video, and the page that keeps the job going while the connection is lost.
// Port 3197 for this agent: `VC_E2E_PORT=3197 NEXT_DIST_DIR=.next-fb2 pnpm e2e e2e/jobs-states.spec.ts`.

test.beforeEach(async ({ request, context, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary' });
});

type StartOptions = { free?: boolean; products?: 1 | 2; long?: boolean };

/** Fills the form of a Fast, one-variant job on a template and opens its confirm dialog: one click is left. */
async function prepare(page: Page, templateId: string, productName: string, opts: StartOptions = {}): Promise<void> {
  await page.goto(`/templates/${templateId}/generate`);
  await fillProduct(page, 1, productName, IMAGE_1);
  if (opts.products === 2) await fillProduct(page, 2, `${productName} Two`, IMAGE_2);
  // Best × 3 variants: a job that takes a minute and a half of fake time, long enough to look at.
  if (opts.long) {
    await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
    await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3' }).click();
  }
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  if (opts.free) await expect(page.getByRole('dialog', { name: 'Confirm generation' })).toContainText('Free video · 0 credits');
}

/** Confirms the dialog `prepare` left open and waits for the job page. */
async function confirm(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Confirm generation' }).getByRole('button', { name: 'Confirm and generate' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
}

/** Starts a Fast, one-variant job on a template from its form and waits for the job page. */
async function start(page: Page, templateId: string, productName: string, opts: StartOptions = {}): Promise<void> {
  await prepare(page, templateId, productName, opts);
  await confirm(page);
}

test('Stop the job here: asks first, "Keep it" changes nothing, "Close the job" closes it; the credits stay, the page and My videos say so', async ({ page }) => {
  await page.goto('/jobs/job-demo-stopped');
  const options = page.getByRole('region', { name: 'What happened and your options' });
  await options.getByRole('button', { name: /Stop the job here/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Close this job?' });
  await expect(dialog).toContainText('The parts already made for this job are deleted and cannot be brought back');
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(options).toBeVisible(); // still stopped

  await options.getByRole('button', { name: /Stop the job here/ }).click();
  await dialog.getByRole('button', { name: 'Close the job' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Job closed' })).toBeVisible();
  await expect(page.getByText('5 credits were returned. Nothing else was charged.')).toBeVisible();
  const row = (label: string) => page.getByText(label, { exact: true }).locator('..');
  await expect(row('Balance now')).toContainText('19 credits');
  await expect(page.getByText('The saved parts of this video were deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pick another template' })).toHaveAttribute('href', '/gallery');
  await expect(header(page)).toContainText('19 credits');

  // My videos: the closed job is listed under Stopped, with the credits that came back and no Delete.
  await page.goto('/videos?status=stopped');
  const listed = page.getByRole('listitem').filter({ hasText: 'Dupe comparison' });
  await expect(listed.getByText('Closed', { exact: true })).toBeVisible();
  await expect(listed).toContainText('5 credits were returned. Nothing else was charged.');
  await expect(listed.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  // Nothing changed in the ledger: the charge and the return of the fixtures, no new row.
  await page.goto('/account');
  await expect(creditActivity(page)).not.toContainText('Closed');
});

test('a third job at once is charged and queued: "In queue" with its position, and My videos lists it under Running', async ({ page: first, context }) => {
  // usr-demo has the running fixture job; the limit is two at once.
  // The first job is a long one, and still it lasts four and a half seconds here (90 of fake time at 20×): a second form filled after
  // it was sent can take longer than that on a busy machine, and would find its place free. So both forms are filled, each in its own
  // tab, before either is sent; then only the two confirm clicks are apart.
  const page = await context.newPage();
  await prepare(first, 'tpl-eye', 'Queue Serum One', { long: true });
  await prepare(page, 'tpl-eye', 'Queue Serum Two');
  await confirm(first);
  await confirm(page);
  await expect(page.getByText('In queue', { exact: true }).first()).toBeVisible();
  const card = page.getByRole('region', { name: 'Place in the queue' });
  await expect(card).toContainText('Your job starts when the one before it is done.');
  await expect(card).toContainText('Position 1');
  await expect(card).toContainText('Nothing more to do; you can leave this page.');

  await page.goto('/videos?status=running');
  const queued = page.getByRole('listitem').filter({ hasText: 'Queue Serum Two' });
  await expect(queued.getByText('In queue', { exact: true })).toBeVisible();
  await expect(queued).toContainText('Position 1');
});

test('a job the content rules stopped: its credits are back, no way to continue, only Contact support', async ({ page }) => {
  await start(page, 'tpl-eye', 'content-rule-test');
  const card = page.getByRole('region', { name: 'What happened and your options' });
  await expect(card.getByRole('heading', { level: 2, name: 'This job was stopped because the images or text break our content rules' })).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('Your 2 credits are back in your balance. This job cannot be continued.');
  await expect(card.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', new RegExp(`^/contact\\?topic=video&job=${page.url().match(/[0-9a-f-]{36}/)![0]}$`));
  await expect(page.getByRole('button', { name: /Continue with the backup model|Try again|Stop the job here/ })).toHaveCount(0);
  await expect(page.getByText(/You can continue until/)).toHaveCount(0);
  await expect(header(page)).toContainText('19 credits');
});

test('a job that had stopped before its page first opened: the header has the credits back too', async ({ page }) => {
  // The fake job stops 2 seconds of fake time in: a tenth of a second here. The job page is held longer than that on its way, so its first
  // read is the one that finds the job stopped and returns the credits; the header was rendered before that, with the balance from before.
  await page.route(/\/jobs\/[0-9a-f-]{36}/, async (route) => {
    if (route.request().method() === 'GET') await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });
  await start(page, 'tpl-eye', 'content-rule-test');
  const card = page.getByRole('region', { name: 'What happened and your options' });
  await expect(card).toContainText('Your 2 credits are back in your balance. This job cannot be continued.');
  await expect(header(page)).toContainText('19 credits');
});

test('a stopped free video comes back and continuing uses it again: 0 credits, no balance row', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { session: 'usr-new' });
  await start(page, 'tpl-stop', 'Free Stop Perfume', { free: true, products: 2 });
  const options = page.getByRole('region', { name: 'What happened and your options' });
  await expect(options.getByRole('heading', { name: 'Two clips are missing' })).toBeVisible({ timeout: 30_000 });
  await expect(options).toContainText('Your free video is back. The finished parts are saved.');
  await expect(options).toContainText('You can continue until');
  await expect(options.getByText('Charged when you confirmed')).toHaveCount(0);

  await options.getByRole('button', { name: /Continue with the backup model/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Continue with the backup model' });
  await expect(dialog.getByText('Returned when it stopped', { exact: true }).locator('..')).toContainText('Your free video');
  await expect(dialog.getByText('Continuing costs', { exact: true }).locator('..')).toContainText('Free video · 0 credits');
  await expect(dialog.getByText('Balance after')).toHaveCount(0);
  await expect(dialog).toContainText('This uses your one free video.');
  await dialog.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(dialog).toBeHidden(); // the dialog has a level-1 heading of its own while it is open
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your video is ready.', { timeout: 30_000 });
});

test('Delete on a Done row: asks first, "Keep it" keeps it, "Delete video" removes it from the list, says so, returns no credits', async ({ page }) => {
  await page.goto('/videos');
  const story = page.getByRole('listitem').filter({ has: page.getByText('Done', { exact: true }) }).first();
  await story.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this video?' });
  await expect(dialog).toContainText('It is removed from My videos and cannot be brought back. Credits are not returned.');
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toBeHidden();
  const count = await page.getByRole('listitem').count();

  await story.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete video' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Video deleted.' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(count - 1);
  await expect(header(page)).toContainText('19 credits');
});

test('the progress page keeps the job going while the connection is lost: "Reconnecting…" shows, and goes when it is back', async ({ page, context }) => {
  await start(page, 'tpl-eye', 'Offline Serum', { long: true });
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(page.getByText('You can leave this page. We email you when it is ready.')).toBeVisible();
  await expect(page.getByText('Estimated time')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole('status')).toContainText('Reconnecting… Your job keeps running while this page reconnects.', { timeout: 15_000 });
  await context.setOffline(false);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 15_000 });
});

test('the states in Turkish: stopping a job, the window, the closed job, My videos', async ({ page, context, baseURL }) => {
  await setCookies(context, baseURL, { locale: 'tr' });
  await page.goto('/jobs/job-demo-stopped');
  await page.getByRole('button', { name: /İşi burada durdur/ }).click();
  await expect(page.getByRole('dialog', { name: 'Bu iş kapatılsın mı?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'İşi kapat' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'İş kapatıldı' })).toBeVisible();
  await page.goto('/videos');
  await expect(page.getByRole('listitem').filter({ hasText: 'Dupe comparison' })).toContainText('Başka ücret alınmadı.');
});
