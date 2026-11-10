import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3119';
const b = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' });
  await c.addCookies([{ name: 'vc_session', value: 'usr-demo', url: BASE }, { name: 'vc_cookies', value: 'necessary', url: BASE }, { name: 'vc_theme', value: 'dark', url: BASE }]);
  for (const [name, path] of [['detail', '/templates/tpl-layering'], ['detail-own', '/templates/tpl-own-ready']]) {
    const p = await c.newPage();
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); });
    await p.waitForTimeout(500);
    const cloneY = await p.getByRole('link', { name: 'Clone it' }).first().evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
    console.log(name, w, 'clone bottom', cloneY, 'overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    await p.screenshot({ path: `e2e/__shots__/task9/${name}-dark-${w}.png`, fullPage: true });
    await p.close();
  }
  await c.close();
}
await b.close();
