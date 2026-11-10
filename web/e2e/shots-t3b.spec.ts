import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resetStore, setCookies } from './helpers';

// Screenshots of the scan table ("Sent to scoring") and the candidate rows ("Why this score"): en + tr, 1440 + 390 px. Not part of the normal run:
// `T3B_SHOTS=1 VC_E2E_PORT=3430 NEXT_DIST_DIR=.next-t3b pnpm exec playwright test e2e/shots-t3b.spec.ts`.
const OUT = process.env.T3B_SHOTS_DIR ?? path.join(__dirname, '__shots__');
test.skip(!process.env.T3B_SHOTS, 'screenshots are taken on request');
test.setTimeout(120_000);

for (const width of [1440, 390]) {
  for (const locale of ['en', 'tr'] as const) {
    test(`scan table and candidate notes ${locale} ${width}`, async ({ browser, request, baseURL }) => {
      await resetStore(request);
      const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } });
      await setCookies(context, baseURL, { session: 'usr-admin', consent: 'necessary', locale });
      const page = await context.newPage();
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => undefined);
      const shot = async (name: string) => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, `${name}-${locale}-${width}.png`), fullPage: true });
      };

      await page.goto('/admin/templates/scans');
      const table = page.getByRole('table');
      await expect(table).toBeVisible();
      await shot('t3b-scans');

      await page.goto('/admin/templates/inbox');
      const summaries = page.locator('summary');
      await expect(summaries.first()).toBeVisible();
      for (const summary of await summaries.all()) await summary.click();
      // A note with no break in it (a 300-character token) must not push the row wider than the screen.
      await page.locator('details p').first().evaluate((el) => { el.textContent = `Unbroken note ${'x'.repeat(300)}`; });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
      await shot('t3b-inbox');
    });
  }
}
