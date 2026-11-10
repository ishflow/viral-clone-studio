// Flow 1 (core): sign up -> the verification link from the engine's outbox (never from the page: a production build has no demo links)
// -> log out -> log in -> wrong password -> reset link, which works once.
import { expect, test } from '@playwright/test';
import { BASE, World, logIn, noNotice, signUp, unique } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

const WRONG = 'Email or password is not correct.';

test('sign up, verify from the outbox, log out, log in, wrong password, reset link once', async ({ page, context, browser }) => {
  await noNotice(context);
  const email = unique('auth');
  const first = 'first-password-1';
  const second = 'second-password-2';

  // Sign up -> "Verify your email." with the address; the production build has no "Demo: open the link" aid.
  await signUp(page, email, first);
  await expect(page.getByRole('heading', { name: 'Verify your email.' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: /Demo:/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Demo:/ })).toHaveCount(0);

  // An address that already has an account is told so (documented error).
  const fresh = await browser.newContext();
  await noNotice(fresh);
  const again = await fresh.newPage();
  await again.goto(`${BASE}/signup`);
  await again.getByLabel('Email').fill(email);
  await again.getByLabel('Password').fill('another-password-9');
  await again.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(again.getByText('This email already has an account.')).toBeVisible();
  await fresh.close();

  // The link in the outbox verifies the address and shows the free video; the link works once.
  const verifyLink = await world.link(email, 'verify');
  await page.goto(verifyLink);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your first video is free.');
  await expect(page.locator('header:visible').first()).toContainText('1 free video');
  await page.goto(verifyLink);
  await expect(page.getByRole('heading', { name: 'Your email is already verified.' })).toBeVisible();

  // Log out (Account page), then the gate is closed and the right password opens it again.
  await page.goto(`${BASE}/account`);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  expect((await context.cookies()).some((c) => c.name === 'vc_session' && c.value !== '')).toBe(false);
  await page.goto(`${BASE}/videos`);
  await expect(page).toHaveURL(/\/login/);
  await logIn(page, email, first);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`${BASE}/videos`);
  await expect(page).toHaveURL(/\/videos$/);
  await context.clearCookies({ name: 'vc_session' });

  // A wrong password and an unknown email get the same message.
  await logIn(page, email, 'not-the-password-1');
  await expect(page.getByRole('alert').filter({ hasText: WRONG })).toBeVisible();
  await logIn(page, unique('nobody'), 'not-the-password-1');
  await expect(page.getByRole('alert').filter({ hasText: WRONG })).toBeVisible();

  // Forgot password -> "Check your inbox." (no demo link) -> the link from the outbox -> a new password.
  await page.goto(`${BASE}/forgot-password`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Demo:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Demo:/ })).toHaveCount(0);
  const resetLink = await world.link(email, 'reset');
  await page.goto(resetLink);
  await expect(page.getByRole('heading', { name: 'Set a new password.' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(second);
  await page.getByLabel('Repeat new password').fill(second);
  await page.getByRole('button', { name: 'Save new password' }).click();
  // RULING (E2E-1): save the password, keep the browser signed out, then show the login success message.
  await expect(page).toHaveURL(/\/login\?reason=password-reset$/);
  await expect(page.getByRole('status')).toContainText('Your password changed. Log in with your new password.');

  // The same link a second time is refused.
  await context.clearCookies({ name: 'vc_session' });
  await page.goto(resetLink);
  await expect(page.getByRole('heading', { name: 'This reset link no longer works.' })).toBeVisible();

  // The old password is refused, the new one works.
  await logIn(page, email, first);
  await expect(page.getByRole('alert').filter({ hasText: WRONG })).toBeVisible();
  await logIn(page, email, second);
  await expect(page).not.toHaveURL(/\/login/);
});
