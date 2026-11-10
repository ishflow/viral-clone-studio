import { expect, test } from '@playwright/test';
import { resetStore } from './helpers';
import { sessionCookie } from './session';

test.beforeEach(async ({ request }) => {
  await resetStore(request);
});

/** The fixture accounts of the fake store log in with the documented dev password (VC_DEV_PASSWORD, default "demo-password"). */
const DEMO_PASSWORD = 'demo-password';

async function logIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

test('the demo account logs in with the documented password, and the cookie is signed and HttpOnly', async ({ page, context }) => {
  await logIn(page, 'demo@viralclone.app', DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/gallery/);
  const cookie = (await context.cookies()).find((item) => item.name === 'vc_session');
  expect(cookie?.value).toMatch(/^usr-demo\.\d{10}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(29 * 86_400);
});

test('a wrong password is refused with the same message as an unknown email', async ({ page }) => {
  await logIn(page, 'demo@viralclone.app', 'not-the-password');
  await expect(page.getByRole('alert').filter({ hasText: /Email or password is not (right|correct)/ })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await logIn(page, 'nobody@example.com', 'not-the-password');
  await expect(page.getByRole('alert').filter({ hasText: /Email or password is not (right|correct)/ })).toBeVisible();
});

test('the admin of the fixtures cannot be signed in as: no password, no forged cookie', async ({ page, request }) => {
  await logIn(page, 'admin@viralclone.app', 'admin');
  await expect(page.getByRole('alert').filter({ hasText: /Email or password is not (right|correct)/ })).toBeVisible();
  // A cookie the site did not sign is a session that ended: back to the log-in (not followed here), and the answer carries nothing of the panel.
  const panel = 'aria-label="Admin menu"';
  for (const forged of ['usr-admin', 'usr-admin.9999999999.AAAA']) {
    const response = await request.get('/admin', { headers: { cookie: `vc_session=${forged}` }, maxRedirects: 0 });
    expect(response.status(), forged).toBe(307);
    expect(response.headers()['location'], forged).toBe('/login?reason=expired');
    expect(await response.text(), forged).not.toContain(panel);
  }
  // The mark is in the page the admin gets: the check above is not empty.
  expect(await (await request.get('/admin', { headers: { cookie: `vc_session=${sessionCookie('usr-admin')}` } })).text()).toContain(panel);
});

test('the admin logs in with the password and reaches the admin area', async ({ page }) => {
  await logIn(page, 'admin@viralclone.app', DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/gallery/);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText("This page doesn't exist.");
});

test('every page carries the security headers', async ({ request }) => {
  const headers = (await request.get('/login')).headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('same-origin');
});
