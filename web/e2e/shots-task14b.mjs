import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3114';
const out = 'e2e/__shots__/task14b';
const b = await chromium.launch({ channel: 'chrome' });
const bad = [];
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' });
  await c.addCookies([{ name: 'vc_theme', value: 'dark', url: BASE }, { name: 'vc_session', value: 'usr-admin', url: BASE }]);
  const p = await c.newPage();
  if (w === 1440) {
    // seed: "Add to gallery" on three candidates below the threshold, so waiting cards exist
    await p.goto(BASE + '/admin/templates/inbox', { waitUntil: 'networkidle' });
    for (let i = 0; i < 3; i++) {
      const btn = p.getByRole('button', { name: 'Add to gallery' }).first();
      if (await btn.count()) { await btn.click(); await p.waitForTimeout(900); }
    }
  }
  for (const [name, path] of [['inbox', '/admin/templates/inbox'], ['jobs', '/admin/jobs?period=all'], ['edit', '/admin/templates/tpl-eye'], ['settings', '/admin/settings'], ['templates', '/admin/templates'], ['scans', '/admin/templates/scans?period=all']]) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (w === 390 && sw !== 390) bad.push(`${name} ${sw}`);
  }
  // dialogs
  const dlg = async (name, path, opener, nth = 0) => {
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: opener, exact: true }).nth(nth).click();
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/dialog-${name}-${w}.png` });
  };
  await dlg('refund', '/admin/jobs?period=all', 'Refund credits');
  await dlg('hide', '/admin/templates/tpl-eye', 'Hide template');
  await dlg('reject-template', '/admin/templates/inbox', 'Reject', 0);
  await p.goto(BASE + '/admin/templates/inbox', { waitUntil: 'networkidle' });
  const n = await p.getByRole('button', { name: 'Reject', exact: true }).count();
  await dlg('reject-candidate', '/admin/templates/inbox', 'Reject', Math.max(0, n - 1)).catch(() => {});
  await c.close();
}
console.log('scrollWidth problems:', bad);
await b.close();
