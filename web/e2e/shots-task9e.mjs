import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3119';
const b = await chromium.launch({ channel: 'chrome' });
const long = 'x'.repeat(80);
const pages = [
  ['gallery', '/gallery'], ['gallery-long-q', `/gallery?q=${long}`], ['detail', '/templates/tpl-layering'], ['detail-own', '/templates/tpl-own-ready'], ['add', '/templates/new'],
  ['player', '/templates/tpl-layering', async (p) => { await p.getByRole('button', { name: /Play the sample|Örneği oynat/ }).click(); await p.waitForTimeout(1500); }],
];
let bad = 0;
for (const locale of ['en', 'tr']) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await c.addCookies([{ name: 'vc_session', value: 'usr-demo', url: BASE }, { name: 'vc_cookies', value: 'necessary', url: BASE }, { name: 'vc_theme', value: 'dark', url: BASE }, { name: 'vc_locale', value: locale, url: BASE }]);
  for (const [name, path, act] of pages) {
    const p = await c.newPage();
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    if (act) await act(p);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw !== 390) { bad++; console.log('OVERFLOW', locale, name, sw); }
    await p.screenshot({ path: `e2e/__shots__/task9/e-${name}-${locale}-390.png`, fullPage: !act });
    await p.close();
  }
  await c.close();
}
console.log('done, overflowing pages:', bad);
await b.close();
