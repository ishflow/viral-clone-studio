import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
for (const loc of ['en', 'tr']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'vc_locale', value: loc, url: 'http://localhost:3115' }, { name: 'vc_session', value: 'usr-demo', url: 'http://localhost:3115' }]);
  const p = await ctx.newPage();
  await p.goto('http://localhost:3115/gallery', { waitUntil: 'networkidle' });
  console.log(loc, JSON.stringify(await p.evaluate(() => {
    const o = [];
    document.querySelectorAll('body *').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.right > 391 && r.width > 0) o.push(e.tagName + '.' + String(e.className).slice(0, 60) + ' ' + Math.round(r.right) + ' ' + (e.textContent || '').slice(0, 40));
    });
    return [document.documentElement.scrollWidth, o.slice(0, 6)];
  })));
}
await b.close();
