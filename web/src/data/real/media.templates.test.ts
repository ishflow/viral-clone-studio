// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { makeDataDir, putTemplate } from './testing';
import { mediaFile } from './media';

// Who sees the pictures the engine keeps in a template's folder: the poster, the reference's frame and a frame of each shot (the full
// who-by-state table of the source frames is in source-frames.test.ts).

let world: ReturnType<typeof makeDataDir>;
const viewer = (id: string) => getStore().users.find((u) => u.id === id) ?? null;
const files = ['poster.jpg', 'reference.jpg', 'reference.mp4', 'shots/1.jpg'];

beforeEach(() => {
  world = makeDataDir(); vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', world.dir);
  resetStore(); addDemoCustomers();
  for (const id of ['catalog', 'mine']) {
    mkdirSync(join(world.dir, 'templates', id, 'shots'), { recursive: true });
    for (const name of [...files, 'shots/a.jpg', 'shots/1.png', 'shots/1.mp4']) writeFileSync(join(world.dir, 'templates', id, name), 'picture');
  }
  putTemplate(world.db, { id: 'catalog', state: 'published' });
  putTemplate(world.db, { id: 'mine', state: 'ready', owner: 'usr-demo' });
});
afterEach(() => { world.db.close(); vi.unstubAllEnvs(); resetStore(); });

it('the poster of a published catalog template goes to everyone; the source video, its first picture and the frame of a shot to the admins only', () => {
  expect(mediaFile(['templates', 'catalog', 'poster.jpg'], null)).not.toBeNull();
  for (const name of ['reference.jpg', 'reference.mp4']) {
    expect(mediaFile(['templates', 'catalog', name], null)).toBeNull();
    expect(mediaFile(['templates', 'catalog', name], viewer('usr-demo'))).toBeNull();
    expect(mediaFile(['templates', 'catalog', name], viewer('usr-admin'))).not.toBeNull();
  }
  expect(mediaFile(['templates', 'catalog', 'shots', '1.jpg'], null)).toBeNull();
  expect(mediaFile(['templates', 'catalog', 'shots', '1.jpg'], viewer('usr-demo'))).toBeNull();
  expect(mediaFile(['templates', 'catalog', 'shots', '1.jpg'], viewer('usr-admin'))).not.toBeNull();
});

it('the frame of a shot of a customer\'s own template goes to its owner and the admins, nobody else', () => {
  for (const name of files) {
    expect(mediaFile(['templates', 'mine', ...name.split('/')], viewer('usr-demo'))).not.toBeNull();
    expect(mediaFile(['templates', 'mine', ...name.split('/')], viewer('usr-admin'))).not.toBeNull();
    expect(mediaFile(['templates', 'mine', ...name.split('/')], null)).toBeNull();
  }
});

it('only a numbered .jpg in shots/ is a frame: no other name, no other folder', () => {
  for (const name of ['shots/a.jpg', 'shots/1.png', 'shots/1.mp4', 'shots/1/2.jpg', 'other/1.jpg']) expect(mediaFile(['templates', 'catalog', ...name.split('/')], null)).toBeNull();
});
