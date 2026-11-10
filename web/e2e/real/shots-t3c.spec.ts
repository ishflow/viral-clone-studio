// Screenshots of the upload states of "Add your own video": idle, a refused file, the confirmation with the file, and (once) the added template.
// 390 / 1440 wide, light / dark, en / tr. Output: shots-T3C/ at the repository root. Not part of the gate: run it by name.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE, World, customerWithCredits } from './world';

const OUT = join(__dirname, '..', '..', '..', 'shots-T3C');
const VARIANTS = [
  { width: 390, height: 844 }, { width: 1440, height: 900 },
].flatMap((size) => (['light', 'dark'] as const).flatMap((theme) => (['en', 'tr'] as const).map((locale) => ({ ...size, theme, locale }))));

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

test('upload states, every viewport x theme x language', async ({ browser, page, context }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await context.addCookies([{ name: 'vc_cookies', value: 'necessary', url: BASE }]);
  await customerWithCredits(world, page, browser, 20, 'shots');
  const storageState = await context.storageState();
  const clip = join(world.dir, 'small-clip.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', clip]);

  let added = false;
  for (const v of VARIANTS) {
    const tag = `${v.width}-${v.theme}-${v.locale}`;
    const ctx = await browser.newContext({ storageState, viewport: { width: v.width, height: v.height }, colorScheme: v.theme, reducedMotion: 'reduce' });
    await ctx.addCookies([{ name: 'vc_theme', value: v.theme, url: BASE }, { name: 'vc_locale', value: v.locale, url: BASE }]);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/templates/new`);
    await expect(p.locator('input[type="file"]')).toBeAttached();
    await p.screenshot({ path: join(OUT, `1-idle-${tag}.png`), fullPage: true });

    await p.locator('input[type="file"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await expect(p.locator('[data-upload-card] [role="alert"]')).toBeVisible();
    await p.screenshot({ path: join(OUT, `2-refused-${tag}.png`), fullPage: true });

    await p.locator('input[type="file"]').setInputFiles(clip);
    const dialog = p.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await p.screenshot({ path: join(OUT, `3-confirm-${tag}.png`) });

    if (!added) {
      await dialog.locator('button[type="submit"]').click();
      await expect(p.getByRole('status').filter({ hasText: /./ }).first()).toBeVisible();
      await p.screenshot({ path: join(OUT, `4-added-${tag}.png`), fullPage: true });
      added = true;
    }
    await ctx.close();
  }
});
