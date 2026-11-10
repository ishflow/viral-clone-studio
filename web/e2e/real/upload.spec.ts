// "Add your own video" with a real file: the browser uploads an mp4 larger than 10 MB (past the proxy's body buffer) to the upload route,
// the free check shows the real length and charges nothing, and the confirmation starts the preparation, charged once.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE, World, customerWithCredits, headerCredits, newCustomer, noNotice } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

/** 12 s, 720x1280, noise at 8 Mb/s: about 12 MB, over the 10 MB a proxy would buffer. */
function bigClip(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'big-clip.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=12', '-vf', 'noise=alls=60:allf=t', '-c:v', 'libx264', '-b:v', '8M', '-maxrate', '8M', '-bufsize', '8M', '-pix_fmt', 'yuv420p', '-an', file]);
  return file;
}

test('a file over 10 MB goes through the upload route, is checked for free, and is prepared once on confirm', async ({ page, context, browser }) => {
  await noNotice(context);
  await customerWithCredits(world, page, browser, 10, 'upload');
  const file = bigClip(join(world.dir, 'clips'));
  expect(statSync(file).size, 'the clip must be over the 10 MB proxy buffer').toBeGreaterThan(10 * 1024 * 1024);

  await page.goto(`${BASE}/templates/new`);
  const before = await headerCredits(page).catch(() => 0);
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/uploads/video') && r.request().method() === 'POST', { timeout: 60_000 });
  await page.locator('input[type="file"]').setInputFiles(file);
  const upload = await answered;
  expect(upload.status()).toBe(200);
  expect(Object.keys(await upload.json()).sort()).toEqual(['bytes', 'name', 'type', 'uploadId']);

  const dialog = page.getByRole('dialog', { name: 'Prepare this template' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('big-clip.mp4')).toBeVisible();
  await expect(dialog.getByText('12 sec')).toBeVisible();   // the store's own probe, not the browser's word
  expect(await headerCredits(page).catch(() => 0), 'nothing is charged by the free check').toBe(before);

  await dialog.getByRole('button', { name: 'Prepare template' }).click();
  await expect(page.getByText(/Added\. It appears under/)).toBeVisible();
  await expect.poll(() => headerCredits(page).catch(() => 0), { timeout: 20_000 }).toBe(before - 1);
});

test('a file that is not a video is refused by the server, not kept, and nothing is charged', async ({ page, context, request }) => {
  await noNotice(context);
  await newCustomer(world, page, 'upload-bad');
  await page.goto(`${BASE}/templates/new`);
  const before = await headerCredits(page).catch(() => 0);
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/uploads/video'));
  await page.locator('input[type="file"]').setInputFiles({ name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('#EXTM3U\nhttp://127.0.0.1:1/x\n') });
  expect((await answered).status()).toBe(415);
  await expect(page.getByText(/This file type is not supported/)).toBeVisible();
  expect(await headerCredits(page).catch(() => 0)).toBe(before);
  // Without a session the route is closed.
  expect((await request.post(`${BASE}/api/uploads/video`, { multipart: { file: { name: 'a.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') } } })).status()).toBe(401);
});
