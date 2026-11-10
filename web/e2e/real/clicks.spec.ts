// Flow 6: every link and button, really clicked (not just requested): public pages signed out, then the customer's pages signed in. After
// each click: no console error, no page error, no 4xx / 5xx answer of the site, and a link lands on a page that answers 2xx. Skipped on
// purpose: what ends the session or deletes / pays / sends (log out, delete, pay, confirm, submit of a filled form).
import { expect, test, type Page } from '@playwright/test';
import { BASE, World, newCustomer, noNotice } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

const SKIP = /log ?out|sign ?out|delete|remove|pay\b|buy|purchase|confirm|refund|send|close the job|report|download|cancel request/i;
const PUBLIC = ['/', '/pricing', '/contact', '/legal/terms', '/legal/privacy', '/legal/refund-policy', '/gallery', '/templates/layering-01', '/login', '/signup', '/forgot-password'];
const SIGNED_IN = ['/gallery', '/videos', '/account', '/templates/layering-01/generate', '/templates/new', '/welcome'];

interface Watch { problems: string[] }
function watch(page: Page): Watch {
  const seen: Watch = { problems: [] };
  page.on('console', (m) => { if (m.type() === 'error') seen.problems.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => seen.problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.origin === BASE && r.status() >= 400 && !url.pathname.endsWith('/favicon.ico')) seen.problems.push(`${r.status()} ${url.pathname}`);
  });
  return seen;
}

async function sweep(page: Page, seen: Watch, path: string, done: Set<string>): Promise<{ links: number; buttons: number }> {
  await page.goto(`${BASE}${path}`);
  const hrefs = await page.locator('a[href]:visible').evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''));
  const names = await page.locator('button:visible').evaluateAll((els) =>
    els.map((el) => ((el as HTMLButtonElement).getAttribute('aria-label') ?? (el as HTMLButtonElement).innerText).trim().split('\n')[0] ?? ''));
  let links = 0;
  let buttons = 0;
  for (const href of new Set(hrefs)) {
    if (!href.startsWith('/') || href.startsWith('//') || SKIP.test(href) || done.has(`a:${href}`)) continue;
    done.add(`a:${href}`);
    await page.goto(`${BASE}${path}`);
    seen.problems.length = 0;
    const target = page.locator(`a[href="${href}"]:visible`).first();
    const card = page.locator('.group').filter({ has: target }).first();   // a hover-only affordance (the gallery card's "Clone it") needs the pointer on the card
    if (await card.count()) await card.hover();
    const [response] = await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30_000 }).catch(() => null), target.click({ timeout: 8_000 }).catch((e: Error) => { throw new Error(`click ${path} -> a[href="${href}"]: ${e.message.split('\n')[0]}`); })]);
    if (response) expect(response.status(), `${path} -> ${href}`).toBeLessThan(400);
    await page.waitForTimeout(150);
    expect(seen.problems, `${path} -> link ${href}`).toEqual([]);
    links += 1;
  }
  for (const name of new Set(names)) {
    if (!name || SKIP.test(name) || done.has(`b:${path}:${name}`)) continue;
    done.add(`b:${path}:${name}`);
    await page.goto(`${BASE}${path}`);
    seen.problems.length = 0;
    const button = page.getByRole('button', { name, exact: true }).first();
    if (!(await button.isVisible())) continue;
    await button.click({ timeout: 10_000 });
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    expect(seen.problems, `${path} -> button "${name}"`).toEqual([]);
    buttons += 1;
  }
  return { links, buttons };
}

test('public pages: every link and button works when clicked', async ({ page, context }) => {
  test.setTimeout(480_000);
  await noNotice(context);
  const seen = watch(page);
  const done = new Set<string>();
  let total = 0;
  for (const path of PUBLIC) {
    const r = await sweep(page, seen, path, done);
    total += r.links + r.buttons;
  }
  expect(total, 'clicked something').toBeGreaterThan(30);
});

test('signed in: every link and button of the customer pages works when clicked', async ({ page, context }) => {
  test.setTimeout(480_000);
  await noNotice(context);
  await newCustomer(world, page, 'clicks');
  const seen = watch(page);
  const done = new Set<string>();
  let total = 0;
  for (const path of SIGNED_IN) {
    const r = await sweep(page, seen, path, done);
    total += r.links + r.buttons;
  }
  expect(total, 'clicked something').toBeGreaterThan(15);
});

test('keyboard: Tab onto the gallery card shows its Clone it', async ({ page, context }) => {
  await noNotice(context);
  await page.goto(`${BASE}/gallery`);
  const clone = page.getByRole('link', { name: 'Clone it' }).first();
  await clone.focus();
  const overlay = clone.locator('xpath=..');
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(clone).toBeVisible();
  await page.keyboard.press('Enter');
  // signed out, the form asks to log in first and comes back to it
  await expect(page).toHaveURL(/\/login\?next=%2Ftemplates%2F[a-z0-9-]+%2Fgenerate/);
});
