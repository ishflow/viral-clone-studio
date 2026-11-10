// Flow 6 (priority 1): who is refused where, against the production build with the real engine. Customer A makes a free job so there is
// a job page and an uploaded image (a /media path) that customer B and a visitor must not reach.
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE, World, confirmJob, fillGenerateForm, logIn, newCustomer, noNotice, openConfirm } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

const ADMIN_PAGES = ['/admin', '/admin/users', '/admin/users/usr-nobody', '/admin/jobs', '/admin/revenue', '/admin/revenue/credits', '/admin/settings',
  '/admin/templates', '/admin/templates/inbox', '/admin/templates/scans', '/admin/templates/layering-01'];
const EXPORTS = ['/admin/users/export', '/admin/revenue/export'];

/** Refused = 404 / 403, or a redirect to the log-in page; never a 200 with content. */
async function expectRefused(request: APIRequestContext, path: string, who: string): Promise<void> {
  const response = await request.get(`${BASE}${path}`, { maxRedirects: 0 });
  const status = response.status();
  const location = response.headers().location ?? '';
  const ok = status === 404 || status === 403 || ([301, 302, 303, 307, 308].includes(status) && /\/login/.test(location));
  expect(ok, `${who}: GET ${path} -> ${status} ${location}`).toBe(true);
}

test('admin pages and CSV exports are refused to a visitor, a customer and forged cookies; the admin gets in', async ({ browser, page, context }) => {
  await noNotice(context);
  const visitor = await browser.newContext();
  await newCustomer(world, page, 'acc-a');

  for (const path of [...ADMIN_PAGES, ...EXPORTS]) {
    await expectRefused(visitor.request, path, 'visitor');
    await expectRefused(context.request, path, 'customer');
  }

  // forged cookie is refused (SEC1 closed C1): a bare user id, a made-up signature, an empty signature.
  const forged = ['usr-admin', 'usr-admin.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'usr-admin.9999999999.'];
  for (const value of forged) {
    const jar = await browser.newContext();
    await jar.addCookies([{ name: 'vc_session', value, url: BASE }]);
    for (const path of ['/admin', '/admin/users', ...EXPORTS]) await expectRefused(jar.request, path, `forged cookie ${value.slice(0, 22)}`);
    // and it does not make a customer page open either: the cookie counts as no cookie
    const videos = await jar.request.get(`${BASE}/videos`, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308], `forged cookie on /videos -> ${videos.status()}`).toContain(videos.status());
    await jar.close();
  }
  const own = (await context.cookies()).find((c) => c.name === 'vc_session')!;
  await context.addCookies([{ name: 'vc_session', value: 'usr-admin', url: BASE }]);
  for (const path of ['/admin', ...EXPORTS]) await expectRefused(context.request, path, 'customer with the bare usr-admin cookie');
  await context.addCookies([{ name: 'vc_session', value: own.value, url: BASE }]);

  // The admin (VC_ADMIN_PASSWORD, through the form) does get in: the refusals above are the guard, not broken routes.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await logIn(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(adminPage).not.toHaveURL(/\/login/);
  await adminPage.goto(`${BASE}/admin`);
  await expect(adminPage.getByText("This page doesn't exist.")).toHaveCount(0);
  await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible();
  const csv = await adminContext.request.get(`${BASE}/admin/users/export`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('csv');
  await adminContext.close();
  await visitor.close();
});

test("another customer's job page, uploaded image and invoice are refused; /dev/reset is 404", async ({ browser, page, context }) => {
  await noNotice(context);
  await newCustomer(world, page, 'acc-own');
  await page.goto(`${BASE}/templates/layering-01/generate`);
  await fillGenerateForm(page);
  await openConfirm(page);
  const jobPath = await confirmJob(page);
  const stored = world.uploadedPaths();
  expect(stored.length, 'the run holds the uploaded images').toBeGreaterThan(0);
  const mediaPath = `/media/${stored[stored.length - 1]!}`;

  // The owner reaches both.
  expect((await context.request.get(`${BASE}${mediaPath}`)).status()).toBe(200);
  expect((await context.request.get(`${BASE}${jobPath}`)).status()).toBe(200);

  const other = await browser.newContext();
  await noNotice(other);
  await newCustomer(world, await other.newPage(), 'acc-other');
  const visitor = await browser.newContext();
  for (const [who, request] of [['customer B', other.request], ['visitor', visitor.request]] as const) {
    await expectRefused(request, jobPath, `${who} job`);
    await expectRefused(request, `${jobPath}/compare`, `${who} compare`);
    await expectRefused(request, mediaPath, `${who} media`);
    await expectRefused(request, '/invoices/inv-0001', `${who} invoice`);
  }
  // /dev/reset: in production it answers 404.
  expect((await visitor.request.post(`${BASE}/dev/reset`)).status()).toBe(404);
  await visitor.close();
  await other.close();
});
