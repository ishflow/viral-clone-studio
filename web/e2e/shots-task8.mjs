import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const OUT = 'e2e/__shots__/task8';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3108';
const E = 'name%40example.com';
const pages = [
  ['login', '/login', null], ['signup', '/signup', null],
  ['verify', '/verify-email', 'usr-unverified'], ['welcome', '/welcome', 'usr-new'],
  ['forgot', '/forgot-password', null], ['sent', `/forgot-password/sent?email=${E}`, null], ['reset', `/reset-password?email=${E}`, null],
];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
  for (const scheme of ['dark', 'light']) {
    for (const [name, path, user] of pages) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      const cookies = [{ name: 'vc_theme', value: scheme, url: BASE }];
      if (user) cookies.push({ name: 'vc_session', value: user, url: BASE });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      if (name === 'welcome') { await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } scrollTo(0, 0); }); await page.waitForTimeout(500); }
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-${tag}.png`, fullPage: true });
      await ctx.close();
    }
  }
}
await browser.close();
