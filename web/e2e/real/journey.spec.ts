// Flow 3: the customer's way through the real engine (fake provider): gallery -> template -> form with images -> confirmation with the cost
// -> job page (steps move) -> result plays and downloads -> My videos -> balance down by the confirmed cost; the provider log has exactly
// the approved lines, none before the confirm click.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE, World, addCredits, confirmJob, fillGenerateForm, headerCredits, newCustomer, noNotice, openConfirm } from './world';

const SHOTS = join(__dirname, '..', '..', '..', 'shots-E2E');

let world: World;
test.beforeAll(async () => { world = await World.start(); mkdirSync(SHOTS, { recursive: true }); });
test.afterAll(async () => { await world?.stop(); });

test('gallery to result: steps move, the video plays, the balance goes down once by the confirmed cost', async ({ page, context, browser }) => {
  await noNotice(context);
  const { email } = await newCustomer(world, page, 'journey');
  const adminContext = await browser.newContext();
  await addCredits(await adminContext.newPage(), email, 200, 'real e2e journey');
  await adminContext.close();

  // Gallery -> the seeded template -> "Clone it" -> the form.
  await page.goto(`${BASE}/gallery`);
  await page.getByRole('link', { name: /Scent layering line-up/ }).first().click();
  await expect(page).toHaveURL(/\/templates\/layering-01$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Scent layering line-up' })).toBeVisible();
  await page.getByRole('link', { name: 'Clone it' }).first().click();
  await expect(page).toHaveURL(/\/templates\/layering-01\/generate$/);
  const before = await headerCredits(page);
  expect(before).toBe(200);

  // Fill: an empty form is refused, then four products with the two fixture images; Best quality costs credits (the free video is Fast only).
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /things to fix before generating/ })).toBeVisible();
  await fillGenerateForm(page, 'Best');
  const dialog = await openConfirm(page);
  const cost = Number(/(\d+)/.exec(await dialog.getByText('Credits for this job').locator('..').innerText().then((t) => t.replace('Credits for this job', '')))![1]);
  expect(cost, 'the confirmation shows a cost').toBeGreaterThan(0);
  await expect(dialog.getByText('Balance now').locator('..')).toContainText('200');
  await dialog.getByRole('button', { name: 'What we generate' }).click();
  const generate = await dialog.innerText();
  const count = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(generate)?.[1] ?? 0);
  const expected = count('images?') + count('clips?') + count('music track');
  expect(expected, `parsed "${generate.replace(/\n/g, ' ')}"`).toBeGreaterThan(0);

  // Nothing was asked of the provider before the click.
  expect(world.generated(), 'provider log before the confirm click').toHaveLength(0);
  expect(await headerCredits(page)).toBe(before);
  const jobPath = await confirmJob(page);

  // The steps move: at least two distinct states are seen before the result.
  const seen = new Set<string>();
  const stop = Date.now() + 120_000;
  for (;;) {
    const text = await page.locator('main').first().innerText();
    if (/Your video is\s*ready/i.test(text)) break;
    const signature = (text.match(/\b(waiting|running|done|stopped)\b/g) ?? []).join(',');
    if (signature) seen.add(signature);
    if (Date.now() > stop) throw new Error(`the job did not finish: ${[...seen].slice(-3).join(' | ')}`);
    await page.waitForTimeout(250);
  }
  expect(seen.size, `distinct step states seen: ${[...seen].join(' | ')}`).toBeGreaterThanOrEqual(2);
  expect([...seen].some((s) => s.includes('running'))).toBe(true);

  // The result: heading, a video that plays, a download that serves a file.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ready');
  const playButton = page.getByRole('button', { name: 'Play the video' });
  if (await playButton.isVisible().catch(() => false)) await playButton.click();
  const video = page.locator('video').first();
  await expect(video).toBeVisible();
  await video.evaluate(async (v: HTMLVideoElement) => { v.muted = true; await v.play(); });
  const t0 = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(1500);
  const t1 = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(t1, `currentTime ${t0} -> ${t1}`).toBeGreaterThan(t0);
  await page.screenshot({ path: join(SHOTS, 'journey-result.png') });
  const download = page.getByRole('link', { name: /^Download/ }).first();
  const href = await download.getAttribute('href');
  expect(href, 'the download link').toBeTruthy();
  const file = await context.request.get(new URL(href!, BASE).toString());
  expect(file.status()).toBe(200);
  expect((await file.body()).length).toBeGreaterThan(1000);
  // A click checks the file first, then the browser saves it; no "did not start" notice.
  const [saved] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(saved.suggestedFilename()).toMatch(/\.mp4$/);
  await expect(page.getByText('The download did not start. Try again.')).toHaveCount(0);

  // The log: exactly the approved requests.
  const lines = world.generated();
  expect(lines, `approved ${expected}`).toHaveLength(expected);

  // My videos lists it and opens the same job; the balance is down by the confirmed cost, once.
  await page.goto(`${BASE}/videos`);
  const row = page.getByRole('listitem').filter({ hasText: 'Real E2E Serum 1' });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Done', { exact: true })).toBeVisible();
  await row.getByRole('link', { name: /Open|Watch/ }).first().click();
  await expect(page).toHaveURL(`${BASE}${jobPath}`);
  await page.goto(`${BASE}/account`);
  expect(await headerCredits(page)).toBe(before - cost);
  await page.screenshot({ path: join(SHOTS, 'journey-account.png') });
});
