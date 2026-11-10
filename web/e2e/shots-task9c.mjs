import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:3119/templates/tpl-layering', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Play the sample' }).click();
await p.waitForTimeout(800);
console.log(await p.evaluate(() => { const d = document.querySelector('dialog'); const cs = getComputedStyle(d); return [cs.height, cs.maxHeight, d.firstElementChild.getBoundingClientRect().height, d.scrollHeight]; }));
await b.close();
