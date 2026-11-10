import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { IMAGE_1, IMAGE_2, fillProduct, resetStore, setCookies } from './helpers';

// Screenshots of the job and My videos states (task FB2): en + tr, light + dark, 1440 + 390 px. Not part of the normal run:
// `FB2_SHOTS=1 VC_E2E_PORT=3197 NEXT_DIST_DIR=.next-fb2 pnpm exec playwright test e2e/shots-fb2.spec.ts`.
const OUT = process.env.FB2_SHOTS_DIR ?? 'e2e/__shots__/shots-FB2';
test.skip(!process.env.FB2_SHOTS, 'screenshots are taken on request');
test.setTimeout(240_000);

// The form helpers of this suite read English labels: the form is filled in English, then the language of the combination comes back.
async function start(page: Page, templateId: string, name: string, opts: { products?: 1 | 2; long?: boolean } = {}): Promise<void> {
  const context = page.context();
  const lang = (await context.cookies()).find((c) => c.name === 'vc_locale')?.value as 'en' | 'tr' | undefined;
  if (lang && lang !== 'en') await setCookies(context, page.url().startsWith('http') ? new URL(page.url()).origin : undefined, { locale: 'en' });
  await page.goto(`/templates/${templateId}/generate`);
  await fillProduct(page, 1, name, IMAGE_1);
  if (opts.products === 2) await fillProduct(page, 2, `${name} Two`, IMAGE_2);
  if (opts.long) {
    await page.getByRole('group', { name: 'Quality' }).getByRole('button', { name: /Best/ }).click();
    await page.getByRole('group', { name: 'Number of variants' }).getByRole('button', { name: '3' }).click();
  }
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm and generate' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  if (lang && lang !== 'en') {
    await setCookies(context, new URL(page.url()).origin, { locale: lang });
    await page.reload();
  }
}

const COMBOS = [1440, 390].flatMap((width) => (['en', 'tr'] as const).flatMap((locale) => (['light', 'dark'] as const).map((theme) => ({ width, locale, theme }))));

for (const { width, locale, theme } of COMBOS) {
  test(`FB2 states ${locale} ${theme} ${width}`, async ({ browser, request, baseURL }) => {
    await resetStore(request);
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } });
    const page = await context.newPage();
    await setCookies(context, baseURL, { session: 'usr-demo', consent: 'necessary', theme, locale });
    const tag = `${locale}-${theme}-${width}`;
    const shot = async (name: string, fullPage = true) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`), fullPage });
    };
    const first = (re: RegExp) => page.getByRole('button', { name: re }).first();

    await page.goto('/jobs/job-demo-running');
    await shot('job-running');

    await page.goto('/videos');
    await shot('videos');
    const done = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^(Delete|Sil)$/ }) }).first();
    await done.getByRole('button', { name: /^(Delete|Sil)$/ }).click();
    await shot('video-delete-dialog', false);
    await page.getByRole('dialog').getByRole('button', { name: /Keep it|Kalsın/ }).click();

    await page.goto('/jobs/job-demo-stopped');
    await shot('job-stopped');
    await first(/Continue with the backup model|Yedek modelle devam et/).click();
    await shot('job-continue-dialog', false);
    await page.getByRole('dialog').getByRole('button', { name: /Cancel|Vazgeç/ }).click();
    await first(/^(Try again|Tekrar dene)/).click();
    await shot('job-retry-dialog', false);
    await page.getByRole('dialog').getByRole('button', { name: /Cancel|Vazgeç/ }).click();

    // two more jobs: the second one waits (the running fixture counts for one)
    await start(page, 'tpl-eye', 'Shot Serum One');
    await start(page, 'tpl-eye', 'Shot Serum Two');
    await shot('job-queued');
    await page.goto('/videos');
    await shot('videos-queued');

    await page.goto('/jobs/job-demo-stopped');
    await first(/Stop the job here|İşi burada durdur/).click();
    await shot('job-close-dialog', false);
    await page.getByRole('dialog').getByRole('button', { name: /Close the job|İşi kapat/ }).click();
    await page.getByRole('heading', { level: 2, name: /Job closed|İş kapatıldı/ }).waitFor();
    await shot('job-closed');
    await page.goto('/videos?status=stopped');
    await shot('videos-closed');

    await start(page, 'tpl-eye', 'content-rule-test');
    await page.getByRole('region', { name: /What happened|Ne oldu/ }).waitFor({ timeout: 30_000 });
    await shot('job-content-rule');

    await start(page, 'tpl-eye', 'Offline Serum', { long: true });
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.getByRole('status').waitFor({ timeout: 15_000 });
    await shot('job-reconnecting');
    await context.setOffline(false);

    // the free video of a new user: stopped, then the free confirmation
    await setCookies(context, baseURL, { session: 'usr-new' });
    await page.goto('/videos');
    await shot('videos-empty-free');
    await start(page, 'tpl-stop', 'Free Stop Perfume', { products: 2 });
    await page.getByRole('region', { name: /What happened|Ne oldu/ }).waitFor({ timeout: 30_000 });
    await shot('job-stopped-free');
    await first(/Continue with the backup model|Yedek modelle devam et/).click();
    await shot('job-continue-free-dialog', false);
    await context.close();
  });
}
