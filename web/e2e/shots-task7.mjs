import { chromium } from '@playwright/test';
import fs from 'node:fs';
const out = new URL('./__shots__/task7/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const routes = { home: '/', pricing: '/pricing', 'legal-terms': '/legal/terms', contact: '/contact' };
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, path] of Object.entries(routes))
  for (const theme of ['dark', 'light'])
    for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: 'vc_theme', value: theme, url: 'http://localhost:3107' }, { name: 'vc_cookies', value: 'necessary', url: 'http://localhost:3107' }]);
      const page = await ctx.newPage();
      await page.goto('http://localhost:3107' + path, { waitUntil: 'networkidle', timeout: 90000 });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}${name}-${theme}-${tag}.png`, fullPage: true });
      await ctx.close();
    }
await browser.close();
