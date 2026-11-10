import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
for (const scheme of ['dark','light']) for (const [w,h] of [[1440,900],[390,844]]) {
  const c = await b.newContext({ viewport:{width:w,height:h}, colorScheme:scheme });
  const p = await c.newPage();
  await p.goto('http://localhost:3101/');
  await p.waitForTimeout(800);
  const info = await p.evaluate(() => ({bg:getComputedStyle(document.body).backgroundColor, h1:getComputedStyle(document.querySelector('h1')).fontFamily, body:getComputedStyle(document.body).fontFamily, ts:getComputedStyle(document.querySelector('p')).fontSize}));
  console.log(scheme,w,JSON.stringify(info));
  await p.screenshot({ path:`e2e/__shots__/t1-${scheme}-${w}.png` });
  await c.close();
}
await b.close();
