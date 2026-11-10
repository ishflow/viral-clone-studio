// Flow 3a: the free video, to the end: a new verified customer (0 credits, "1 free video") makes a Fast video; the confirmation says
// "Free video · 0 credits", the job finishes, nothing is charged, the free video is used up (the next confirmation is a priced one that
// the empty balance cannot pay), and the provider log holds exactly the approved lines, none before the click.
import { expect, test } from '@playwright/test';
import { BASE, World, confirmJob, expectReady, fillGenerateForm, headerCredits, newCustomer, noNotice, openConfirm } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

test('the free video: Fast, 0 credits, to the finished video; the second one is not free', async ({ page, context }) => {
  await noNotice(context);
  await newCustomer(world, page, 'free');
  await page.goto(`${BASE}/templates/layering-01/generate`);
  await expect(page.locator('header:visible').first()).toContainText('1 free video');
  expect(await headerCredits(page).catch(() => 0)).toBe(0);

  await fillGenerateForm(page, 'Fast');
  const dialog = await openConfirm(page);
  await expect(dialog.getByText('Free video · 0 credits')).toBeVisible();
  await expect(dialog.getByText('This uses your one free video.')).toBeVisible();
  await dialog.getByRole('button', { name: 'What we generate' }).click();
  const generate = await dialog.innerText();
  const count = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(generate)?.[1] ?? 0);
  const expected = count('images?') + count('clips?') + count('music track');
  expect(expected, `parsed "${generate.replace(/\n/g, ' ')}"`).toBeGreaterThan(0);
  expect(world.generated(), 'provider log before the confirm click').toHaveLength(0);

  await confirmJob(page);
  await expectReady(page);
  expect(world.generated(), 'the provider was asked exactly what the confirmation listed').toHaveLength(expected);

  // Nothing was charged, and the free video is gone from the header.
  await page.goto(`${BASE}/account`);
  await expect(page.locator('header:visible').first()).not.toContainText('free video');
  await expect(page.getByText('Free video').first()).toBeVisible();
  await page.goto(`${BASE}/videos`);
  await expect(page.getByText('Scent layering line-up').first()).toBeVisible();

  // The second Fast video is not free: the confirmation shows a price the 0 balance cannot pay, and nothing more is asked of the provider.
  await page.goto(`${BASE}/templates/layering-01/generate`);
  await fillGenerateForm(page, 'Fast');
  const second = await openConfirm(page);
  await expect(second.getByText('Credits for this job')).toBeVisible();
  await expect(second.getByText('Free video · 0 credits')).toHaveCount(0);
  await expect(second.getByText(/not enough credits|Buy credits/i).first()).toBeVisible();
  expect(world.generated()).toHaveLength(expected);
});
