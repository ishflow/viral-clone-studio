import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3114';
const out = 'e2e/__shots__/task14';
const b = await chromium.launch({ channel: 'chrome' });
const pages = [
  ['jobs', '/admin/jobs?period=all'], ['templates', '/admin/templates'], ['inbox', '/admin/templates/inbox'],
  ['edit', '/admin/templates/tpl-eye'], ['scans', '/admin/templates/scans?period=all'], ['settings', '/admin/settings'],
];
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    await c.addCookies([{ name: 'vc_theme', value: theme, url: BASE }, { name: 'vc_session', value: 'usr-admin', url: BASE }]);
    for (const [name, path] of pages) {
      const p = await c.newPage();
      await p.goto(BASE + path, { waitUntil: 'networkidle' });
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${out}/${name}-${theme}-${w}.png`, fullPage: true });
      await p.close();
    }
    await c.close();
  }
}
await b.close();
