// Flow 5b: the price changes while the resume window is open. A free Fast video stops (clip 3 fails, VC_FAKE_FAIL_CLIP=3), the free video
// comes back, the resume window opens ("Free"); in a second tab the customer makes another free video; confirming the first window now
// shows "The cost changed", spends nothing, charges nothing and asks the provider for nothing.
import { expect, test } from '@playwright/test';
import { BASE, World, confirmJob, expectReady, fillGenerateForm, newCustomer, noNotice, openConfirm } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start({ failClip: 3 }); });
test.afterAll(async () => { await world?.stop(); });

test('the cost changed while the resume window was open: nothing is spent, charged or asked of the provider', async ({ page, context }) => {
  await noNotice(context);
  await newCustomer(world, page, 'pricechg');
  await page.goto(`${BASE}/templates/layering-01/generate`);
  await fillGenerateForm(page, 'Fast');
  await openConfirm(page);
  await confirmJob(page);
  await expect(page.getByRole('heading', { name: /clips? (is|are) missing/ })).toBeVisible({ timeout: 120_000 });
  const stoppedPath = new URL(page.url()).pathname;
  await page.reload();   // the header was drawn before the stop was settled
  await expect(page.locator('header:visible').first()).toContainText('1 free video');   // the stop gave the free video back

  // Window 1: the resume is free (covered by the free video).
  await page.getByRole('button', { name: /Try again/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/free/i);

  // Tab 2: the free video is used for another video, which finishes.
  const other = await context.newPage();
  await other.goto(`${BASE}/templates/layering-01/generate`);
  await fillGenerateForm(other, 'Fast');
  const second = await openConfirm(other);
  await expect(second.getByText('Free video · 0 credits')).toBeVisible();
  await confirmJob(other);
  await expectReady(other);
  const logBefore = world.generated().length;
  await other.close();

  // Window 1 again: the confirmation is refused with the cost of now.
  await dialog.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(page.getByText(/The cost changed while this window was open/)).toBeVisible();
  expect(page.url()).toContain(stoppedPath);
  await expect(page.getByRole('heading', { name: /clips? (is|are) missing/ })).toBeVisible();   // still stopped
  expect(world.generated(), 'nothing was asked of the provider').toHaveLength(logBefore);
  await page.reload();   // the header shows the balance of now: the free video went to the other video, no credit was spent
  await expect(page.locator('header:visible').first()).not.toContainText('free video');
  await expect(page.locator('header:visible').first()).toContainText(/0 credits/);
});
