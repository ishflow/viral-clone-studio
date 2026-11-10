import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3106';
const out = 'e2e/__shots__/task6';
const b = await chromium.launch({ channel: 'chrome' });
const jobs = [
  ['ui', '/dev/ui', null],
  ['visitor', '/dev/shells/visitor', null],
  ['customer', '/dev/shells/customer', null],
  ['admin', '/dev/shells/admin', null],
  ['auth', '/dev/shells/auth', null],
  ['404-visitor', '/nope', null],
  ['404-customer', '/nope', 'usr-demo'],
];
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    await c.addCookies([{ name: 'vc_theme', value: theme, url: BASE }]);
    for (const [name, path, session] of jobs) {
      const p = await c.newPage();
      if (session) await c.addCookies([{ name: 'vc_session', value: session, url: BASE }]);
      else await c.clearCookies({ name: 'vc_session' });
      await p.goto(BASE + path, { waitUntil: 'networkidle' });
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${out}/${name}-${theme}-${w}.png`, fullPage: name === 'ui' });
      await p.close();
    }
    // open phone menus
    if (w === 390) {
      for (const [name, path] of [['menu-visitor', '/dev/shells/visitor'], ['menu-customer', '/dev/shells/customer'], ['menu-admin', '/dev/shells/admin']]) {
        const p = await c.newPage();
        await p.goto(BASE + path, { waitUntil: 'networkidle' });
        await p.getByRole('button', { name: 'Open menu' }).click();
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${out}/${name}-${theme}-${w}.png` });
        if (name !== 'menu-admin') {
          await p.getByRole('button', { name: /Language/ }).click();
          await p.waitForTimeout(200);
          await p.screenshot({ path: `${out}/${name}-lang-${theme}-${w}.png` });
        }
        await p.close();
      }
    } else {
      const p = await c.newPage();
      await p.goto(BASE + '/dev/shells/visitor', { waitUntil: 'networkidle' });
      await p.getByRole('button', { name: /Language/ }).first().click();
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${out}/lang-${theme}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 400 } });
      await p.close();
    }
    await c.close();
  }
}
await b.close();
