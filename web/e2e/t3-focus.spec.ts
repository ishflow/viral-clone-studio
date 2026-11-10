import { test, expect } from '@playwright/test';
import { setCookies } from './helpers';
test('gallery search shows a ring when focused', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await setCookies(context, baseURL, { consent: 'necessary' });
  const page = await context.newPage();
  await page.goto('/gallery');
  await page.getByRole('searchbox').focus();
  const ring = await page.getByRole('search').locator('label').evaluate((el) => { const s = getComputedStyle(el); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; });
  console.log('RING', ring);
  expect(ring).toMatch(/^solid 2px/);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.screenshot({ path: 'e2e/__shots__/t3-focus.png', clip: { x: 700, y: 100, width: 740, height: 400 } });
});
