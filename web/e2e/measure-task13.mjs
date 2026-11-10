import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'vc_session', value: 'usr-admin', url: 'http://localhost:3113' }]);
const p = await ctx.newPage();
for (const path of ['/admin/revenue', '/admin/users']) {
  await p.goto(`http://localhost:3113${path}`, { waitUntil: 'networkidle' });
  console.log(path, await p.evaluate(() => ['[role=group]', 'a[download]', 'section', 'table', 'main'].map((s) => { const e = document.querySelector(s); if (!e) return [s]; const r = e.getBoundingClientRect(); return [s, Math.round(r.left), Math.round(r.right)]; })));
}
await b.close();
