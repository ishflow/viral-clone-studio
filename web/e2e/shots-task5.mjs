import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
for (const scheme of ['dark', 'light']) {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const p = await c.newPage();
  await p.goto('http://localhost:3105/dev/ui', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `e2e/__shots__/task5/ui-${scheme}-1440.png`, fullPage: true });
  await p.getByText('Open dialog').click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `e2e/__shots__/task5/dialog-${scheme}-1440.png` });
  await c.close();
}
const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const p = await c.newPage();
await p.goto('http://localhost:3105/dev/ui', { waitUntil: 'networkidle' });
await p.getByText('Open dialog').click();
await p.waitForTimeout(300);
await p.screenshot({ path: 'e2e/__shots__/task5/dialog-dark-390.png' });
await b.close();
