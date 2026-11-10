import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3119';
const out = 'e2e/__shots__/task9';
const b = await chromium.launch({ channel: 'chrome' });
const long = 'x'.repeat(80);
const jobs = [
  ['gallery', '/gallery'],
  ['gallery-long-q', `/gallery?q=${long}`],
  ['detail', '/templates/tpl-layering'],
  ['long-title', '/dev/gallery-check/long-title'],
  ['loading', '/dev/gallery-check/loading'],
  ['player', '/templates/tpl-layering', async (p) => { await p.getByRole('button', { name: 'Play the sample' }).click(); await p.waitForTimeout(1800); }],
];
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    await c.addCookies([{ name: 'vc_theme', value: theme, url: BASE }, { name: 'vc_session', value: 'usr-demo', url: BASE }, { name: 'vc_cookies', value: 'necessary', url: BASE }]);
    for (const [name, path, act] of jobs) {
      const p = await c.newPage();
      await p.goto(BASE + path, { waitUntil: 'networkidle' });
      await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); });
      await p.waitForTimeout(500);
      if (act) await act(p);
      const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw[0] !== sw[1]) console.log('OVERFLOW', name, theme, w, sw);
      await p.screenshot({ path: `${out}/${name}-${theme}-${w}.png`, fullPage: !act });
      await p.close();
    }
    await c.close();
  }
}
// touch emulation: overlay must not intercept taps
const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await c.addCookies([{ name: 'vc_cookies', value: 'necessary', url: BASE }]);
const p = await c.newPage();
await p.goto(BASE + '/gallery', { waitUntil: 'networkidle' });
const card = p.getByRole('link', { name: 'Dupe comparison' });
await card.scrollIntoViewIfNeeded();
const box = await card.boundingBox();
const display = await p.evaluate(() => getComputedStyle(document.querySelector('a[href$="/generate"]').parentElement).display);
await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 20);
await p.waitForURL('**/templates/tpl-stop', { timeout: 8000 }).then(() => console.log('TOUCH tap bottom of card opened template; overlay display =', display)).catch(() => console.log('TOUCH FAILED', p.url(), display));
await b.close();
