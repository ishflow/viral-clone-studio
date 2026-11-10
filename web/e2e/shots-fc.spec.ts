import path from 'node:path';
import { test } from '@playwright/test';
import { resetStore, setCookies } from './helpers';

// Screenshots of the admin screens of task FC: en + tr, light + dark, 1440 + 390 px. Not part of the normal run:
// `FC_SHOTS=1 VC_E2E_PORT=3198 NEXT_DIST_DIR=.next-fc pnpm exec playwright test e2e/shots-fc.spec.ts`.
const OUT = process.env.FC_SHOTS_DIR ?? 'e2e/__shots__/shots-FC';
test.skip(!process.env.FC_SHOTS, 'screenshots are taken on request');
test.setTimeout(240_000);

const COMBOS = [1440, 390].flatMap((width) => (['en', 'tr'] as const).flatMap((locale) => (['light', 'dark'] as const).map((theme) => ({ width, locale, theme }))));

for (const { width, locale, theme } of COMBOS) {
  test(`FC admin ${locale} ${theme} ${width}`, async ({ browser, request, baseURL }) => {
    await resetStore(request);
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } });
    const page = await context.newPage();
    await setCookies(context, baseURL, { session: 'usr-admin', consent: 'necessary', theme, locale });
    const tag = `${locale}-${theme}-${width}`;
    const shot = async (name: string, fullPage = true) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`), fullPage });
    };
    // Sideways scroll of the page (not of a table's own box) is a defect at every width.
    const overflow = async (name: string) => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      if (wide) console.log(`OVERFLOW ${name} ${tag}`);
    };
    for (const [name, url] of [['overview', '/admin'], ['revenue', '/admin/revenue'], ['credits', '/admin/revenue/credits'], ['jobs', '/admin/jobs'], ['settings', '/admin/settings'], ['templates', '/admin/templates']] as const) {
      await page.goto(url);
      await shot(name);
      await overflow(name);
    }
    // User page: the add-credits confirmation and the block confirmation.
    await page.goto('/admin/users/usr-paying');
    await shot('user');
    await page.locator('#h-add').locator('xpath=..').locator('input[name="credits"]').fill('25');
    await page.locator('#h-add').locator('xpath=..').locator('button[type="submit"]').click();
    await shot('dialog-add-credits', false);
    await page.keyboard.press('Escape');
    await page.locator('#h-access').locator('xpath=..').locator('button:not([type="submit"])').last().click();
    await page.getByRole('dialog').locator('textarea').fill('Chargeback');
    await shot('dialog-block', false);
    await page.getByRole('dialog').locator('button[type="submit"]').click();
    await page.getByRole('dialog').getByRole('button').last().waitFor();
    await shot('dialog-block-done', false);
    await page.getByRole('dialog').getByRole('button').last().click();
    await page.waitForTimeout(500);
    await shot('user-blocked');
    // A stopped job: the retry confirmation.
    await page.goto('/admin/jobs?status=stopped&period=all');
    await page.getByRole('button', { name: /Retry job|İşi tekrar dene/ }).first().click();
    await shot('dialog-retry', false);
  });
}
