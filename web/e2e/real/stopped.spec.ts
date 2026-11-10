// Flow 5: the fake provider fails the 3rd clip (VC_FAKE_FAIL_CLIP=3): the job stops with a translated reason (en, tr); "Try again" asks for
// the missing part only (less than the full price), the provider is asked for the missing clip(s) only, the job finishes.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE, World, customerWithCredits, expectReady, headerCredits, noNotice, startBestJob } from './world';

const SHOTS = join(__dirname, '..', '..', '..', 'shots-E2E');
const tr = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'messages', 'tr', 'jobs.json'), 'utf8')) as { reason: Record<string, { title: Record<string, string> }>; stopped: { retry: string } };

let world: World;
test.beforeAll(async () => { world = await World.start({ failClip: 3 }); mkdirSync(SHOTS, { recursive: true }); });
test.afterAll(async () => { await world?.stop(); });

test('a failed clip stops the job; the resume dialog asks back the returned credits; the job finishes with only that clip asked again', async ({ page, context, browser }) => {
  await noNotice(context);
  await customerWithCredits(world, page, browser, 100, 'stopped');
  await page.goto(`${BASE}/account`);
  const start = await headerCredits(page);
  const { cost } = await startBestJob(page);

  // Clip 3 fails, clips 3, 4 and 5 are missing (the engine stops at the first failure). Stopped, with the reason in plain words (en), and the credits back.
  const title = page.getByRole('heading', { name: /clips? (is|are) missing/ });
  await expect(title).toBeVisible({ timeout: 120_000 });
  await expect(title).toHaveText('Three clips are missing');
  const afterStop = await headerCredits(page);
  expect(afterStop, 'the credits are back when the job stops').toBe(start);
  const logAtStop = world.generated().length;

  // The same page in Turkish.
  await context.addCookies([{ name: 'vc_locale', value: 'tr', url: BASE }]);
  await page.reload();
  await expect(page.getByRole('heading', { name: tr.reason['clips-failed']!.title.n3! })).toBeVisible();
  await context.addCookies([{ name: 'vc_locale', value: 'en', url: BASE }]);
  await page.reload();
  await expect(title).toBeVisible();

  // Resume: the dialog states the price of the missing part, which is less than the full price.
  await page.getByRole('button', { name: /Try again/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const text = await dialog.innerText();
  const resume = Number(/Continuing costs\s*\n?\s*(\d+)/.exec(text)?.[1]);
  expect(resume, `resume dialog: ${text.replace(/\n/g, ' ')}`).toBeGreaterThan(0);
  // FINDING (E2E-2): the brief expected the price of the MISSING part (< full). The site charges back exactly what the stop returned
  // (the whole job price, flow contract section "Devam onayi": "Credits returned" = "Continuing costs"), while the provider is asked
  // for the missing clips only (asserted below). The customer pays the confirmed price once in total.
  expect(Number(/Credits returned when it stopped\s*\n?\s*(\d+)/.exec(text)?.[1])).toBe(resume);
  expect(resume).toBe(cost);
  await page.screenshot({ path: join(SHOTS, 'stopped-dialog.png') });
  await dialog.getByRole('button', { name: 'Confirm and continue' }).click();

  await expectReady(page);
  const again = world.generated().slice(logAtStop);
  expect(again.length, 'something was asked again').toBeGreaterThan(0);
  // The stop came during the clips: the 5 images and the first 2 clips are saved; clips 3-5 and the music were still missing.
  const kinds = again.map((l) => l.kind).sort().join(',');
  expect(kinds, 'only the missing clips and the music are asked again, no image').toBe('clip,clip,clip,music');
  expect(world.generated().filter((l) => l.kind === 'image'), 'every image was asked once').toHaveLength(5);
  await page.goto(`${BASE}/account`);
  expect(await headerCredits(page), 'balance = after the stop - the missing part').toBe(afterStop - resume);
});
