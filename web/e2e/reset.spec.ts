import { test, expect } from '@playwright/test';
import { resetStore, setCookies } from './helpers';

test('reset from the outbox: new password works, old credentials and previous sessions fail', async ({ page, context, request, browser, baseURL }) => {
  await resetStore(request);
  await setCookies(context, baseURL, { locale: 'en', consent: 'necessary' });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@viralclone.app');
  await page.getByLabel('Password', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/gallery/);
  const previous = await context.cookies();
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill('demo@viralclone.app');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page).toHaveURL(/\/forgot-password\/sent/);
  await page.goto('/dev/emails');
  const row = page.getByRole('listitem').filter({ hasText: 'reset' }).filter({ hasText: 'demo@viralclone.app' }).first();
  await row.getByRole('link', { name: 'Preview' }).click();
  const link = page.getByRole('link', { name: 'Set new password' });
  const href = await link.getAttribute('href');
  expect(href).toContain('token=');
  await link.click();
  await page.getByLabel('New password', { exact: true }).fill('fresh-reset-password');
  await page.getByLabel('Repeat new password', { exact: true }).fill('fresh-reset-password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/login\?reason=password-reset$/);
  await expect(page.getByRole('status')).toContainText('Your password changed.');
  const other = await browser.newContext();
  try {
    await other.addCookies(previous);
    const oldPage = await other.newPage();
    await oldPage.goto(`${baseURL}/account`);
    await expect(oldPage).toHaveURL(/\/login/);
  } finally { await other.close(); }
  await page.getByLabel('Email', { exact: true }).fill('demo@viralclone.app');
  await page.getByLabel('Password', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password' })).toContainText('not correct');
  await page.getByLabel('Password', { exact: true }).fill('fresh-reset-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/gallery/);
  await page.goto(href!);
  await expect(page).toHaveURL(/\/reset-password\/invalid/);
  await page.goto('/reset-password?token=unknown');
  await expect(page).toHaveURL(/\/reset-password\/invalid/);
});
