import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
// The e2e session secret (e2e/session.ts) and the cookie format of src/core/session/token.ts.
const SECRET = Buffer.from('e2e-session-secret-not-a-real-secret-0123456789');
const sign = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; return `${id}.${exp}.${createHmac('sha256', SECRET).update(`${id}.${exp}`).digest().toString('base64url')}`; };
const BASE = 'http://localhost:3196';
const OUT = new URL('../../shots-FB1/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const IMG = new URL('./fixtures/product-1.png', import.meta.url).pathname;
const b = await chromium.launch({ channel: 'chrome' });
const bad = [];
for (const locale of ['en', 'tr']) for (const theme of ['light', 'dark']) for (const [w, h] of [[1440, 900], [390, 844], [320, 700]]) {
  if (w === 320 && !(locale === 'en' && theme === 'dark')) continue;
  const tag = `${locale}-${theme}-${w}`;
  const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  const cookies = (user) => [
    { name: 'vc_theme', value: theme, url: BASE }, { name: 'vc_locale', value: locale, url: BASE }, { name: 'vc_cookies', value: 'necessary', url: BASE },
    ...(user ? [{ name: 'vc_session', value: sign(user), url: BASE }] : []),
  ];
  await c.addCookies(cookies(null));
  const p = await c.newPage();
  const shot = async (name, full = true) => {
    await p.waitForTimeout(350);
    await p.screenshot({ path: `${OUT}${name}-${tag}.png`, fullPage: full });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) bad.push(`${name}-${tag} scrollWidth ${sw}`);
  };
  await p.request.post(`${BASE}/dev/reset`);
  await p.goto(`${BASE}/gallery`, { waitUntil: 'networkidle' }); await shot('gallery-visitor');
  await p.goto(`${BASE}/gallery?q=zzzz`, { waitUntil: 'networkidle' }); await shot('gallery-empty');
  await p.goto(`${BASE}/templates/tpl-eye`, { waitUntil: 'networkidle' }); await shot('detail-visitor');
  await c.clearCookies(); await c.addCookies(cookies('usr-new'));
  await p.goto(`${BASE}/templates/tpl-eye`, { waitUntil: 'networkidle' }); await shot('detail-free');
  await p.goto(`${BASE}/templates/tpl-eye/generate`, { waitUntil: 'networkidle' }); await shot('form-free');
  const block = (n) => p.getByRole('group', { name: new RegExp(`^(Product|Ürün) ${n}$`) });
  await block(1).locator('input[type=text]').first().fill('Shot Serum');
  await block(1).locator('input[type=file]').first().setInputFiles(IMG);
  await p.waitForTimeout(600);
  await shot('form-filled');
  await p.getByRole('button', { name: /^(Generate|Üret)$/ }).click();
  await p.waitForTimeout(900); await shot('confirm-free', false);
  await c.clearCookies(); await c.addCookies(cookies('usr-demo'));
  await p.goto(`${BASE}/templates/tpl-story/generate`, { waitUntil: 'networkidle' });
  await block(1).locator('input[type=text]').first().fill('Shot Serum');
  await block(1).locator('input[type=file]').first().setInputFiles(IMG);
  await p.waitForTimeout(600);
  await p.getByRole('group', { name: /Quality|Kalite/ }).getByRole('button').nth(1).click();
  await p.getByRole('group', { name: /Number of variants|Varyant sayısı/ }).getByRole('button', { name: '3', exact: true }).click();
  await p.getByRole('button', { name: /^(Generate|Üret)$/ }).click();
  await p.waitForTimeout(900); await shot('confirm-notenough', false);
  await p.goto(`${BASE}/jobs/job-demo-story`, { waitUntil: 'networkidle' }); await shot('result');
  await p.getByRole('button', { name: /Report a problem|Sorun bildir/ }).click(); await shot('result-report', false);
  await p.keyboard.press('Escape');
  await p.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle' }); await shot('add-video');
  await p.getByLabel(/paste a link|bağlantı yapıştır/i).fill('https://www.tiktok.com/@someone/video/7001');
  await p.getByRole('button', { name: /^(Add|Ekle)$/ }).click(); await p.waitForTimeout(700); await shot('add-video-confirm', false);
  await c.close();
}
await b.close();
console.log('scrollWidth problems:', bad);
