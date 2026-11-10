import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { resetStore, setCookies } from './helpers';
import { ROUTES, type Route, type Width } from './routes';

/**
 * The screenshot sweep: every route of `routes.ts` at 1440 and 390, dark and light, plus both widths once more in Turkish (dark).
 * Each page is checked for: sideways overflow, console errors and uncaught page errors, a raw message key on screen, a 5xx answer,
 * an image that did not load, and on the desktop a table that hides columns behind a sideways scroll.
 * Shots go to `e2e/__shots__/sweep/<name>-<width>-<theme>[-tr].png`; the last test puts them on the contact sheets in
 * `e2e/__shots__/sheets/` (python3 with Pillow; without them that one test is skipped). Both folders are git-ignored.
 */
const OUT = path.join(__dirname, '__shots__', 'sweep');
const SHEETS = path.join(__dirname, '__shots__', 'sheets');
const SHEET_SCRIPT = path.join(__dirname, '..', '..', 'docs', 'design', 'uretec', 'sheet.py');
const HEIGHT: Record<Width, number> = { 1440: 900, 390: 844 };
const NAMESPACES = [
  'common', 'marketing', 'auth', 'gallery', 'generate', 'jobs', 'videos', 'account', 'checkout', 'emails',
  'adminActions', 'adminOverview', 'adminUsers', 'adminRevenue', 'adminJobs', 'adminTemplates', 'adminSettings',
];
/** A message key that reached the screen untranslated: a namespace, a dot, a dotted key. */
const RAW_KEY = new RegExp(`(?<![\\w@./-])(?:${NAMESPACES.join('|')})\\.[a-z][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_#-]+)*`, 'g');

interface Variant { width: Width; theme: 'dark' | 'light'; locale: 'en' | 'tr' }
const VARIANTS: Variant[] = [
  { width: 1440, theme: 'dark', locale: 'en' },
  { width: 1440, theme: 'light', locale: 'en' },
  { width: 390, theme: 'dark', locale: 'en' },
  { width: 390, theme: 'light', locale: 'en' },
  { width: 390, theme: 'dark', locale: 'tr' },
  { width: 1440, theme: 'dark', locale: 'tr' },
];

/** Lazy images load when they scroll into view: walk down the page once, come back, and wait for every image and font. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await pause(40);
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
    const pending = Array.from(document.images).filter((image) => !image.complete);
    await Promise.race([
      Promise.all(pending.map((image) => new Promise((done) => {
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      }))),
      pause(5000),
    ]);
  });
}

/** What the visitor can read: the text on screen, plus the labels that only assistive technology and tooltips show. */
function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attributes = ['aria-label', 'placeholder', 'alt', 'title'];
    const hidden = Array.from(document.querySelectorAll('*')).flatMap((el) => attributes.map((name) => el.getAttribute(name) ?? ''));
    return [document.title, document.body.innerText, ...hidden].join('\n');
  });
}

/** Collects what goes wrong while the page loads and runs: console errors, missing messages, uncaught errors, 5xx answers. */
function watch(page: Page, label: string, expectedStatus = 200): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    // The 404 screen is a 404 answer on purpose; the browser reports that load as an error.
    if (message.type() === 'error' && expectedStatus === 404 && /status of 404/.test(text)) return;
    if (message.type() === 'error' || text.includes('[i18n] missing message')) problems.push(`${label}: console ${message.type()}: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`${label}: page error: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`${label}: HTTP ${response.status()} ${response.url()}`);
  });
  return problems;
}

/** What is wrong with the page as it stands: sideways overflow, a raw message key someone can read, an image that did not load. */
async function inspect(page: Page, label: string): Promise<string[]> {
  const problems: string[] = [];
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  if (scrollWidth > innerWidth) problems.push(`${label}: sideways overflow (${scrollWidth} > ${innerWidth})`);
  const keys = (await readableText(page)).match(RAW_KEY);
  if (keys) problems.push(`${label}: raw message key on screen: ${[...new Set(keys)].join(', ')}`);
  // An image that finished loading without a picture is broken. A lazy image that was never asked to load (it is not in the layout,
  // like the images of the header that is hidden at this width) is not finished, so it is not counted.
  const broken = await page.evaluate(() =>
    Array.from(document.images).filter((image) => image.getAttribute('src') && image.complete && image.naturalWidth === 0).map((image) => image.getAttribute('src')),
  );
  if (broken.length > 0) problems.push(`${label}: broken image: ${[...new Set(broken)].join(', ')}`);
  // On the desktop a table shows every column (the row actions are the last one). On the phone it may scroll inside its box (board behaviour).
  if (innerWidth >= 1440) {
    const tables = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table')).flatMap((table) => {
        const box = table.parentElement;
        return box && box.scrollWidth > box.clientWidth ? [`"${table.caption?.textContent ?? ''}" (${box.scrollWidth} > ${box.clientWidth})`] : [];
      }),
    );
    if (tables.length > 0) problems.push(`${label}: table wider than its box, columns are hidden: ${tables.join(', ')}`);
  }
  return problems;
}

async function shoot(browser: Browser, baseURL: string | undefined, route: Route, { width, theme, locale }: Variant): Promise<string[]> {
  const label = `${route.name} ${width} ${theme}${locale === 'tr' ? ' tr' : ''}`;
  const context = await browser.newContext({ baseURL, viewport: { width, height: HEIGHT[width] }, colorScheme: theme, reducedMotion: 'reduce' });
  await setCookies(context, baseURL, { session: route.session, theme, locale, consent: route.consent === false ? undefined : 'necessary' });
  const page = await context.newPage();
  const problems = watch(page, label, route.status);
  try {
    const response = await page.goto(route.path, { waitUntil: 'load' });
    const status = response?.status() ?? 0;
    if (status !== (route.status ?? 200)) problems.push(`${label}: HTTP ${status}, expected ${route.status ?? 200}`);
    await settle(page);
    if (route.act) await route.act(page);
    await settle(page);
    problems.push(...(await inspect(page, label)));

    // The badge of the dev server is not part of the site.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const file = `${route.name}-${width}-${theme}${locale === 'tr' ? '-tr' : ''}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: route.shot !== 'viewport' });
  } catch (error) {
    problems.push(`${label}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    await context.close();
  }
  return problems;
}

test.describe('sweep', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });
  test.beforeEach(async ({ request }) => {
    await resetStore(request);
  });

  // The checks themselves: a page with each of the faults must be reported, or a green sweep would mean nothing.
  test('the checks catch overflow, a raw message key, a console error, an uncaught error, a 5xx answer and a broken image', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/broken-on-purpose', (route) => route.fulfill({ status: 503, body: 'no' }));
    const live = watch(page, 'self-check');
    await page.goto('/pricing');
    expect(await inspect(page, 'self-check')).toEqual([]);
    await page.evaluate(async () => {
      const wide = document.createElement('div');
      wide.style.width = '3000px';
      wide.textContent = 'gallery.card.meta';
      document.body.append(wide);
      const labelled = document.createElement('button');
      labelled.setAttribute('aria-label', 'adminUsers.detail.add.submit');
      document.body.append(labelled);
      const box = document.createElement('div');
      box.style.cssText = 'width:300px;overflow-x:auto';
      box.innerHTML = '<table style="min-width:900px"><caption>Wide on purpose</caption><tbody><tr><td>x</td></tr></tbody></table>';
      document.body.append(box);
      const picture = document.createElement('img');
      const failed = new Promise((done) => picture.addEventListener('error', done, { once: true }));
      picture.src = 'data:image/png;base64,broken-on-purpose';
      document.body.append(picture);
      await failed;
      console.error('broken on purpose');
      console.warn('[i18n] missing message: common.nope');
      setTimeout(() => {
        throw new Error('thrown on purpose');
      }, 0);
      await fetch('/broken-on-purpose');
      await new Promise((done) => setTimeout(done, 50));
    });
    const found = [...live, ...(await inspect(page, 'self-check'))].join('\n');
    expect(found).toContain('sideways overflow');
    expect(found).toContain('raw message key on screen: gallery.card.meta, adminUsers.detail.add.submit');
    expect(found).toContain('console error: broken on purpose');
    expect(found).toContain('console warning: [i18n] missing message: common.nope');
    expect(found).toContain('page error: thrown on purpose');
    expect(found).toContain('HTTP 503');
    expect(found).toContain('table wider than its box, columns are hidden: "Wide on purpose" (900 > 300)');
    expect(found).toContain('broken image: data:image/png;base64,broken-on-purpose');
    // Ordinary copy is not mistaken for a key: sentences, addresses, placeholders.
    expect('See My videos. Then account.\nsupport@common.example · viralclone.app/account · [PRICE] · checkout. Next'.match(RAW_KEY)).toBeNull();
  });

  for (const route of ROUTES) {
    test(`${route.name}: ${route.path} (${route.board})`, async ({ browser, baseURL }) => {
      test.setTimeout(180_000);
      const problems: string[] = [];
      for (const variant of VARIANTS) {
        if (route.only && route.only !== variant.width) continue;
        problems.push(...(await shoot(browser, baseURL, route, variant)));
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }

  // For the owner: the shots of the sweep on eight contact sheets (customer + visitor pages, and the admin panel).
  // The sheets are drawn by python3 with Pillow. Without them the sweep itself is complete, so this test is skipped, not failed.
  test('contact sheets', () => {
    const probe = spawnSync('python3', ['-c', 'import PIL']);
    test.skip(probe.error !== undefined, 'contact sheets not built: python3 is not installed');
    test.skip(probe.status !== 0, 'contact sheets not built: python3 has no Pillow (pip install Pillow)');
    fs.mkdirSync(SHEETS, { recursive: true });
    const built: string[] = [];
    for (const group of ['site', 'admin'] as const) {
      for (const width of [1440, 390] as const) {
        for (const theme of ['dark', 'light'] as const) {
          const shots = ROUTES.filter((route) => route.group === group && (!route.only || route.only === width))
            .map((route) => path.join(OUT, `${route.name}-${width}-${theme}.png`))
            .filter((file) => fs.existsSync(file));
          if (shots.length === 0) continue;
          const sheet = path.join(SHEETS, `${group}-${width}-${theme}.png`);
          const [columns, cell] = width === 1440 ? ['5', '560'] : ['8', '390'];
          execFileSync('python3', [SHEET_SCRIPT, sheet, columns, cell, ...shots]);
          built.push(sheet);
        }
      }
    }
    expect(built.length).toBeGreaterThan(0);
  });
});
