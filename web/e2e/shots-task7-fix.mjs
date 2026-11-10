import { chromium } from '@playwright/test';
const out = new URL('./__shots__/task7/', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome' });
const jobs = [];
for (const [n, p] of [['legal-terms', '/legal/terms'], ['contact', '/contact']]) for (const w of [1440, 390]) jobs.push([`${n}-light-${w}`, p, w, 'light', 'en']);
jobs.push(['home-tr-dark-390', '/', 390, 'dark', 'tr'], ['pricing-tr-dark-390', '/pricing', 390, 'dark', 'tr'], ['contact-tr-dark-390', '/contact', 390, 'dark', 'tr']);
for (const [name, path, w, theme, loc] of jobs) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, colorScheme: theme });
  const u = 'http://localhost:3107';
  await ctx.addCookies([{ name: 'vc_theme', value: theme, url: u }, { name: 'vc_locale', value: loc, url: u }, { name: 'vc_cookies', value: 'necessary', url: u }]);
  const page = await ctx.newPage();
  await page.goto(u + path, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'overflow', over);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
