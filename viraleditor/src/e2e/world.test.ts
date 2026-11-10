import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readSettings } from '../db/settings.ts';
import * as templates from '../db/templates.ts';
import { cleanUp, makeWorld, produceInput, queue, release, runOf } from './world.ts';

afterEach(cleanUp);

it('the world of the end-to-end tests: layering-01 ready, scan sources off, a real picture, a held run that release queues', async () => {
  const w = await makeWorld();
  expect(templates.get(w.db, 'layering-01')?.state).toBe('ready');
  expect(readSettings(w.db).sources).toEqual({ topads: false, shorts: false });
  expect(readFileSync(join(w.dir, w.fill.products[0]!.images[0]!)).subarray(1, 4).toString()).toBe('PNG');
  const id = queue(w, true);
  expect(runOf(w, id).state).toBe('held');
  expect(runOf(w, id).approved).toEqual(produceInput(w).approved);
  release(w);
  expect(runOf(w, id).state).toBe('queued');
});
