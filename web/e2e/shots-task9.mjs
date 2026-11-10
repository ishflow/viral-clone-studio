import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3109';
const out = 'e2e/__shots__/task9';
const b = await chromium.launch({ channel: 'chrome' });
const jobs = [
  ['gallery', '/gallery'],
  ['gallery-empty', '/gallery?q=pet+food'],
  ['detail', '/templates/tpl-layering'],
  ['detail-own', '/templates/tpl-own-ready'],
  ['add', '/templates/new'],
  ['player', '/templates/tpl-layering', async (p) => { await p.getByRole('button', { name: 'Play the sample' }).click(); await p.waitForTimeout(1800); }],
];
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    await c.addCookies([{ name: 'vc_theme', value: theme, url: BASE }, { name: 'vc_session', value: 'usr-demo', url: BASE }]);
    for (const [name, path, act] of jobs) {
      const p = await c.newPage();
      await p.goto(BASE + path, { waitUntil: 'networkidle' });
      await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); });
      await p.waitForTimeout(600);
      if (act) await act(p);
      await p.screenshot({ path: `${out}/${name}-${theme}-${w}.png`, fullPage: !act });
      await p.close();
    }
    await c.close();
  }
}
await b.close();
