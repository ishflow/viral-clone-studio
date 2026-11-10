// Flow 4: the site restarts while a job runs (the job and the balance stand, no double charge); then the worker restarts mid-job
// (the job finishes, the provider log has no repeated request).
import { expect, test } from '@playwright/test';
import { BASE, World, customerWithCredits, expectReady, headerCredits, noNotice, startBestJob, until } from './world';

let world: World;
test.beforeAll(async () => { world = await World.start(); });
test.afterAll(async () => { await world?.stop(); });

test('the site restarts mid-job, then the worker restarts mid-job: both jobs finish, charged once each, no repeated provider request', async ({ page, context, browser }) => {
  await noNotice(context);
  await customerWithCredits(world, page, browser, 100, 'restart');
  await page.goto(`${BASE}/account`);
  const start = await headerCredits(page);

  // --- the site restarts ---
  const first = await startBestJob(page);
  expect(await headerCredits(page)).toBe(start - first.cost);
  await until('the provider has been asked at least once', 60_000, () => world.generated().length >= 1);
  await world.restartSite();
  await page.goto(`${BASE}${first.jobPath}`);
  await expect(page).toHaveURL(`${BASE}${first.jobPath}`);
  await expectReady(page);
  const linesOfFirst = world.generated();
  const perJob = linesOfFirst.length;
  expect(new Set(linesOfFirst.map((l) => l.ticket)).size, 'no ticket asked twice').toBe(perJob);
  await page.goto(`${BASE}/account`);
  expect(await headerCredits(page), 'charged once').toBe(start - first.cost);

  // --- the worker restarts ---
  const second = await startBestJob(page);
  await until('the second job reached the provider', 60_000, () => world.generated().length >= perJob + 2);
  await world.killWorker('SIGTERM');
  const frozen = world.generated().length;
  await page.waitForTimeout(3000);
  expect(world.generated().length, 'nothing is generated while the worker is down').toBe(frozen);
  world.startWorker();
  await page.goto(`${BASE}${second.jobPath}`);
  await expectReady(page, 180_000);
  const all = world.generated();
  expect(all, 'the same number of requests for the second job as for the first').toHaveLength(perJob * 2);
  expect(new Set(all.map((l) => l.ticket)).size, 'no ticket asked twice across the worker restart').toBe(all.length);
  await page.goto(`${BASE}/account`);
  expect(await headerCredits(page), 'charged once per job').toBe(start - first.cost - second.cost);
});
