import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Card } from '../contracts.ts';
import { cardOf } from '../template/card.ts';
import { keepFrames, takeFrames, withFrames } from './frames.ts';
import { golden, world } from './testing.ts';

const beats = (): Card => cardOf(golden('layering-01'), { image: null, video: null });
const stills = (w: ReturnType<typeof world>) => w.media.calls.filter((call) => call.kind === 'still');

it('takes the middle of every shot of a beats reference, and the first shot is the cover of the customer\'s own template', async () => {
  const w = world(), card = beats();
  const frames = await takeFrames(w, 'own', card, '/source.mp4', 8, true);
  expect(frames.cover).toBe('templates/own/poster.jpg');
  expect(frames.shots).toEqual(Object.fromEntries(card.shots.map((shot) => [shot.n, `templates/own/shots/${shot.n}.jpg`])));
  const first = card.shots[0]!;
  expect(stills(w).map((call) => call.second)).toEqual([(first.from + first.to) / 2, ...card.shots.map((shot) => (shot.from + shot.to) / 2)]);
  for (const file of [frames.cover!, ...Object.values(frames.shots)]) expect(existsSync(join(w.dataDir, file))).toBe(true);
});

it('a catalog template gets its shot frames but no cover: its poster is the sample\'s, the gate of publishing', async () => {
  const w = world(), card = beats();
  const frames = await takeFrames(w, 'catalog', card, '/source.mp4', 8, false);
  expect(frames.cover).toBeNull();
  expect(Object.keys(frames.shots)).toHaveLength(card.shots.length);
  expect(existsSync(join(w.dataDir, 'templates/catalog/poster.jpg'))).toBe(false);
});

it('a talking reference: the shots are timed in the new video, so each frame is taken at the same share of the reference', async () => {
  const w = world(), card = { ...beats(), format: 'talking' as const, seconds: 10, shots: [{ ...beats().shots[0]!, from: 0, to: 2 }, { ...beats().shots[1]!, from: 2, to: 10 }] };
  const frames = await takeFrames(w, 'talk', card, '/source.mp4', 5, true);
  expect(frames).toEqual({ cover: 'templates/talk/poster.jpg', shots: { 1: 'templates/talk/shots/1.jpg', 2: 'templates/talk/shots/2.jpg' } });
  expect(stills(w).map((call) => call.second)).toEqual([0.5, 0.5, 3]);
});

it('never asks for a second past the end of the reference', async () => {
  const w = world(), card = beats();
  await takeFrames(w, 'short', card, '/source.mp4', 1, true);
  expect(Math.max(...stills(w).map((call) => call.second))).toBeLessThanOrEqual(0.9);
});

it('a frame that cannot be taken is left out, the others stay, nothing throws', async () => {
  const w = world(), card = beats();
  const real = w.media.still.bind(w.media);
  w.media.still = async (file, second, to) => { if (to.endsWith('shots/2.jpg')) throw new Error('no frame'); return real(file, second, to); };
  const frames = await takeFrames(w, 'part', card, '/source.mp4', 8, true);
  expect(frames.shots[2]).toBeUndefined();
  expect(frames.shots[1]).toBe('templates/part/shots/1.jpg');
});

it('does not take a frame again that is on disk already', async () => {
  const w = world(), card = beats();
  await takeFrames(w, 'twice', card, '/source.mp4', 8, true);
  const before = stills(w).length;
  const again = await takeFrames(w, 'twice', card, '/source.mp4', 8, true);
  expect(stills(w)).toHaveLength(before);
  expect(again.cover).toBe('templates/twice/poster.jpg');
});

it('with `retake`, takes again a frame that is on disk but that the card does not point to, and still not one the card has', async () => {
  const w = world(), card = beats();
  await takeFrames(w, 'moved', card, '/source.mp4', 8, true);
  const before = stills(w).length;
  const withImage = { ...card, image: 'templates/moved/poster.jpg', shots: card.shots.map((shot) => (shot.n === 1 ? { ...shot, image: 'templates/moved/shots/1.jpg' } : shot)) };
  await takeFrames(w, 'moved', withImage, '/source.mp4', 8, true, true);
  expect(stills(w).slice(before).map((call) => call.to).sort()).toEqual([2, 3, 4, 5].map((n) => join(w.dataDir, `templates/moved/shots/${n}.jpg`)));
});

it('writes the frames into the card: the image only when there is a cover, every shot that has a frame', () => {
  const card = beats();
  const done = withFrames(card, { cover: 'templates/x/poster.jpg', shots: { 1: 'templates/x/shots/1.jpg' } });
  expect(done.image).toBe('templates/x/poster.jpg');
  expect(done.shots[0]!.image).toBe('templates/x/shots/1.jpg');
  expect(done.shots[1]).not.toHaveProperty('image');
  expect(withFrames(card, { cover: null, shots: {} }).image).toBeNull();
});

it('keeps the frame of a shot only while the shot is where it was', () => {
  const before = beats().shots.map((shot) => ({ ...shot, image: `templates/x/shots/${shot.n}.jpg` }));
  const after = beats();
  after.shots[1] = { ...after.shots[1]!, to: after.shots[1]!.to + 1 };
  const kept = keepFrames(after, before).shots.map((shot) => shot.image ?? null);
  expect(kept).toEqual([before[0]!.image, null, before[2]!.image, before[3]!.image, before[4]!.image]);
});
