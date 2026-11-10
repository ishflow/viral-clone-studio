import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3111';
const out = 'e2e/__shots__/task11';
const RET = encodeURIComponent('/templates/tpl-layering/generate');
const b = await chromium.launch({ channel: 'chrome' });
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    await c.addCookies([{ name: 'vc_theme', value: theme, url: BASE }, { name: 'vc_session', value: 'usr-demo', url: BASE }]);
    const shot = async (p, name, full = true) => { await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${name}-${theme}-${w}.png`, fullPage: full }); };
    const p = await c.newPage();
    await p.goto(`${BASE}/videos`, { waitUntil: 'networkidle' }); await shot(p, 'videos');
    await p.goto(`${BASE}/account`, { waitUntil: 'networkidle' }); await shot(p, 'account');
    await p.getByRole('button', { name: 'Delete account' }).click(); await p.getByLabel('Type DELETE to confirm').fill('DELETE'); await shot(p, 'account-delete', false);
    // pay
    await p.goto(`${BASE}/checkout/start?pack=pack-standard&returnTo=${RET}`, { waitUntil: 'networkidle' }); await shot(p, 'mock');
    await p.getByRole('button', { name: 'Pay' }).click(); await p.waitForURL(/success/); await p.waitForLoadState('networkidle'); await shot(p, 'success');
    await p.getByRole('link', { name: /Download invoice/ }).click(); await p.waitForURL(/invoices/); await p.waitForLoadState('networkidle'); await shot(p, 'invoice');
    await p.goto(`${BASE}/checkout/start?pack=pack-standard&returnTo=${RET}`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Decline' }).click(); await p.waitForURL(/failed/); await p.waitForLoadState('networkidle'); await shot(p, 'failed');
    const q = await c.newPage();
    await c.addCookies([{ name: 'vc_session', value: 'usr-new', url: BASE }]);
    await q.goto(`${BASE}/videos`, { waitUntil: 'networkidle' }); await shot(q, 'videos-empty');
    await c.close();
  }
}
await b.close();
