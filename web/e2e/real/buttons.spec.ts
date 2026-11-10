// Flow 2 (lowest priority, small): every internal link reachable from the public pages (two levels) answers 2xx with a heading and is not
// the 404 page; the cookie notice, the language switch and the 390 px menu work. Destructive / paid buttons are not clicked.
import { expect, test } from '@playwright/test';
import { BASE, World } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

const START = ['/', '/gallery', '/pricing', '/login', '/signup', '/forgot-password'];
const SKIP = /^\/(admin|media|dev|checkout|invoices|jobs|videos|account|welcome|verify-email|logout)(\/|$)/;

test('every link on the public pages lands on a real page; cookie notice, language switch and phone menu work', async ({ page, context }) => {
  // Cookie notice: shown to a new visitor, "Only necessary" closes it and it stays closed.
  await page.goto(`${BASE}/`);
  const notice = page.getByRole('region', { name: 'Cookie notice' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Only necessary' }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(notice).toBeHidden();
  expect((await context.cookies()).find((c) => c.name === 'vc_cookies')?.value).toBe('necessary');

  // Crawl: two levels from the public start pages; every internal link must answer 2xx and show a heading that is not the 404.
  const seen = new Map<string, number>();
  let frontier = START;
  for (let depth = 0; depth < 2; depth += 1) {
    const next = new Set<string>();
    for (const path of frontier) {
      if (seen.has(path)) continue;
      const response = await page.goto(`${BASE}${path}`);
      seen.set(path, response?.status() ?? 0);
      expect(response?.status(), `GET ${path}`).toBeLessThan(300);
      await expect(page.getByRole('heading').first(), `${path} shows a heading`).toBeVisible();
      await expect(page.getByText("This page doesn't exist."), `${path} is not the 404`).toHaveCount(0);
      for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
        if (!href.startsWith('/') || href.startsWith('//')) continue;
        const clean = href.split('#')[0]!.split('?')[0]!;
        if (clean && !SKIP.test(clean) && !seen.has(clean)) next.add(clean);
      }
    }
    frontier = [...next];
  }
  for (const path of frontier) {   // the third level is only requested, not rendered
    if (seen.has(path)) continue;
    const response = await context.request.get(`${BASE}${path}`);
    seen.set(path, response.status());
    expect(response.status(), `GET ${path}`).toBeLessThan(300);
  }
  expect(seen.size, `pages visited: ${[...seen.keys()].join(' ')}`).toBeGreaterThanOrEqual(8);

  // Language switch: Turkish changes the pricing heading, English brings it back.
  await page.goto(`${BASE}/pricing`);
  const english = await page.getByRole('heading', { level: 1 }).first().innerText();
  await context.addCookies([{ name: 'vc_locale', value: 'tr', url: BASE }]);
  await page.reload();
  const turkish = await page.getByRole('heading', { level: 1 }).first().innerText();
  expect(turkish).not.toBe(english);
  await context.addCookies([{ name: 'vc_locale', value: 'en', url: BASE }]);

  // Phone width: the menu opens and its links lead to real pages.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: /menu/i }).first().click();
  const gallery = page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Gallery' });
  await expect(gallery).toBeVisible();
  await gallery.click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
