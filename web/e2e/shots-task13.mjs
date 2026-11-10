import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const out = 'e2e/__shots__/task13';
mkdirSync(out, { recursive: true });
const routes = { genel: '/admin', users: '/admin/users', detay: '/admin/users/usr-demo', gelir: '/admin/revenue', krediler: '/admin/revenue/credits' };
const browser = await chromium.launch({ channel: 'chrome' });
for (const scheme of ['dark', 'light']) {
  for (const [w, h, tag] of [[1440, 900, ''], [390, 844, 'M']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    await ctx.addCookies([
      { name: 'vc_session', value: 'usr-admin', url: 'http://localhost:3113' },
      { name: 'vc_theme', value: scheme, url: 'http://localhost:3113' },
    ]);
    const page = await ctx.newPage();
    for (const [name, path] of Object.entries(routes)) {
      await page.goto(`http://localhost:3113${path}`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: `${out}/${name}-${scheme}-${w}.png`, fullPage: true });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (w === 390 && sw !== 390) console.log('SCROLLWIDTH', name, scheme, sw);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) console.log('OVERFLOW', name, scheme, w, overflow);
    }
    await ctx.close();
  }
}
await browser.close();
