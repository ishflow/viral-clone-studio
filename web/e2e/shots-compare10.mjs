import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3110';
const out = 'e2e/__shots__/task10';
const SAMPLE = 'public/samples/619ee0e5a13e318118b291c1451be9b8.jpg';
const b = await chromium.launch({ channel: 'chrome' });

async function fill(p, which) {
  const blocks = p.getByRole('group', { name: /^Product \d$/ });
  for (const i of which.images) await blocks.nth(i).getByLabel('Add image').setInputFiles(SAMPLE);
  for (const i of which.names) await blocks.nth(i).getByLabel('Product name').fill(`Product name ${i + 1}`);
}

for (const theme of ['dark', 'light']) {
  for (const [w, h, sfx] of [[1440, 900, ''], [390, 844, '-M']]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    const tag = `${theme}${sfx}`;
    await c.addCookies([{ name: 'vc_theme', value: theme, url: BASE }, { name: 'vc_session', value: 'usr-demo', url: BASE }]);
    const shot = async (p, name, full = true) => p.screenshot({ path: `${out}/${name}-${tag}.png`, fullPage: full });
    const open = async (path) => { const p = await c.newPage(); await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(300); return p; };

    let p;
    if (false) {
      p = await open('/templates/tpl-layering/generate');
    await shot(p, 'form');
    await fill(p, { images: [0, 2, 3], names: [0, 1, 3] });
    await p.getByRole('button', { name: 'Generate' }).click();
    await p.waitForTimeout(600);
    await shot(p, 'form-error');
    await fill(p, { images: [1], names: [2] });
    await p.getByRole('button', { name: 'Generate' }).click();
    await p.getByRole('dialog').waitFor();
    await p.waitForTimeout(300);
    await shot(p, 'confirm', false);
    await p.getByRole('button', { name: 'Cancel' }).click();
    await p.getByRole('button', { name: '3', exact: true }).click();
    await p.getByRole('button', { name: /Best/ }).click();
    await p.getByRole('button', { name: 'Generate' }).click();
    await p.getByRole('dialog').waitFor();
    await p.waitForTimeout(300);
    await shot(p, 'confirm-low', false);
    await p.close(); }

    for (const [name, id] of [['compare', 'job-demo-story/compare']]) {
      p = await open(`/jobs/${id}`);
      await shot(p, name);
      await p.close();
    }
    await c.close();
  }
}
await b.close();
