import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, tag] of [[640, ''], [390, '-ML']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  for (const n of ['verify', 'reset', 'ready', 'stopped', 'payment']) {
    await page.goto(`http://localhost:3112/dev/emails/${n}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `e2e/__shots__/task12/${n}${tag}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
