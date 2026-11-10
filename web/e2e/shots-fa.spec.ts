import path from 'node:path';
import { test, type Browser } from '@playwright/test';
import { resetStore, setCookies } from './helpers';
import { ROUTES } from './routes';

// Screenshots of task FA (purchase / account access / account / marketing): en + tr, light + dark, 1440 + 390 px. Not part of the normal run:
// `FA_SHOTS=1 VC_E2E_PORT=3195 NEXT_DIST_DIR=.next-fa pnpm exec playwright test e2e/shots-fa.spec.ts`.
// The routes are the ones of `routes.ts` (their `act` brings the page into its state); the delayed payment page needs a minute of the real clock.
const OUT = process.env.FA_SHOTS_DIR ?? 'e2e/__shots__/shots-FA';
test.skip(!process.env.FA_SHOTS, 'screenshots are taken on request');

const NAMES = [
  'pricing', 'pricing-customer', 'contact', 'contact-payment', 'contact-sent', 'contact-account',
  'login', 'login-wrong-password', 'signup-empty', 'login-session-ended', 'signup-email-taken', 'verify-email', 'verify-link-expired', 'verify-link-used',
  'forgot-password-sent', 'reset-password', 'reset-password-invalid', 'blocked',
  'checkout-return-pending', 'checkout-return-cancelled', 'checkout-return-expired', 'checkout-success', 'checkout-success-waiting', 'checkout-failed', 'invoice',
  'account', 'account-refund-dialog', 'account-refund-requested',
];
const COMBOS = [1440, 390].flatMap((width) => (['en', 'tr'] as const).flatMap((locale) => (['light', 'dark'] as const).map((theme) => ({ width, locale, theme }))));
const tag = (c: (typeof COMBOS)[number]) => `${c.locale}-${c.theme}-${c.width}`;

async function open(browser: Browser, baseURL: string | undefined, c: (typeof COMBOS)[number], session: 'usr-demo' | undefined) {
  const context = await browser.newContext({ baseURL, viewport: { width: c.width, height: c.width > 600 ? 900 : 844 }, colorScheme: c.theme, reducedMotion: 'reduce' });
  await setCookies(context, baseURL, { session, theme: c.theme, locale: c.locale, consent: 'necessary' });
  return { context, page: await context.newPage() };
}

async function finish(page: import('@playwright/test').Page, file: string, fullPage: boolean) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file), fullPage });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (wide) console.log(`OVERFLOW ${file}`);
}

test('FA delayed payment page', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000);
  await resetStore(request);
  const first = await open(browser, baseURL, COMBOS[0]!, 'usr-demo');
  await first.page.goto('/pricing');
  await first.page.locator('article form button[type="submit"]').nth(1).click();
  await first.page.waitForURL(/\/checkout\/mock\/[0-9a-f-]{36}/);
  await first.page.locator('button[name="outcome"][value="pending"]').click();
  await first.page.waitForURL(/\/checkout\/return\?checkout=/);
  const address = first.page.url();
  await first.context.close();
  // The server turns "confirming" into "delayed" after 60 seconds of the real clock.
  await new Promise((done) => setTimeout(done, 66_000));
  for (const c of COMBOS) {
    const { context, page } = await open(browser, baseURL, c, 'usr-demo');
    await page.goto(address);
    await page.getByRole('link', { name: /^(Check again|Tekrar kontrol et)/ }).waitFor();
    await finish(page, `checkout-return-delayed-${tag(c)}.png`, true);
    await context.close();
  }
});

for (const name of NAMES) {
  const route = ROUTES.find((r) => r.name === name);
  if (!route) throw new Error(`no route ${name} in routes.ts`);
  test(`FA ${name}`, async ({ browser, request, baseURL }) => {
    test.setTimeout(180_000);
    await resetStore(request);
    for (const c of COMBOS) {
      if (route.only && route.only !== c.width) continue;
      const { context, page } = await open(browser, baseURL, c, route.session === 'usr-demo' ? 'usr-demo' : undefined);
      // Other fixture sessions (the sweep's `session`) are signed the same way by `setCookies`; the FA routes use usr-demo or none.
      if (route.session && route.session !== 'usr-demo') await setCookies(context, baseURL, { session: route.session, theme: c.theme, locale: c.locale, consent: 'necessary' });
      await page.goto(route.path, { waitUntil: 'load' });
      if (route.act) await route.act(page);
      await finish(page, `${name}-${tag(c)}.png`, route.shot !== 'viewport');
      await context.close();
    }
  });
}
