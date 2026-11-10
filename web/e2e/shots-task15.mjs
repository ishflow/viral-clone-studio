import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const out = 'e2e/__shots__/task15';
mkdirSync(out, { recursive: true });
const base = 'http://localhost:3115';
const routes = {
  home: ['/', null], pricing: ['/pricing', null], gallery: ['/gallery', 'usr-demo'],
  detail: ['/templates/tpl-layering', 'usr-demo'], generate: ['/templates/tpl-layering/generate', 'usr-demo'],
  videos: ['/videos', 'usr-demo'], account: ['/account', 'usr-demo'],
  admin: ['/admin', 'usr-admin'], adminUsers: ['/admin/users', 'usr-admin'],
  adminInbox: ['/admin/templates/inbox', 'usr-admin'], adminSettings: ['/admin/settings', 'usr-admin'],
};
const RAW = /\b(common|gallery|generate|jobs|videos|account|auth|checkout|marketing|emails|admin[A-Z][a-zA-Z]*)\.[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+\b/;
const browser = await chromium.launch({ channel: 'chrome' });
let bad = 0;
for (const [name, [path, sess]] of Object.entries(routes)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const ck = [{ name: 'vc_locale', value: 'tr', url: base }, { name: 'vc_theme', value: 'dark', url: base }];
  if (sess) ck.push({ name: 'vc_session', value: sess, url: base });
  await ctx.addCookies(ck);
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(RAW);
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (sw !== 390) {
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > 391 && e.getBoundingClientRect().width > 0)
        .slice(0, 5)
        .map((e) => `${e.tagName}.${String(e.className).slice(0, 70)} right=${Math.round(e.getBoundingClientRect().right)}`),
    );
    console.log('WIDE', name, wide);
  }
  if (sw !== 390 || m || lang !== 'tr') { bad++; console.log('FAIL', name, { sw, raw: m && m[0], lang }); }
  else console.log('ok', name);
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
