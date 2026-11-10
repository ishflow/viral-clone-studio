import { describe, expect, it } from 'vitest';
import type { Job, JobShot, JobStep } from '@/data/ports';
import { shotOf, shotPhase, sharedImages } from './steps';

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const job = (steps: JobStep[], shots?: JobShot[], variants = 1): Job => ({ steps, shots, input: { variants } }) as unknown as Job;
const shot = (n: number, image: string | null, clip: boolean, variant = 1): JobShot => ({ variant, n, image, clip });
const IMAGES_RUNNING = [step('images', 'running', 1, 3), step('clips', 'waiting', 0, 3)];

describe('which shot a box is', () => {
  it('the boxes of the first variant are its shots 1…; those of the second variant start again at 1', () => {
    const made = job([step('images', 'running', 2, 4), step('clips', 'waiting', 0, 4)], [shot(1, '/a.png', false), shot(1, '/b.png', false, 2)], 2);
    expect([0, 1, 2, 3].map((index) => shotOf(made, index)?.image)).toEqual(['/a.png', undefined, '/b.png', undefined]);
  });

  it('a job that tells nothing of its shots has none', () => {
    expect(shotOf(job(IMAGES_RUNNING), 0)).toBeUndefined();
  });
});

describe('the stage of a shot, from its own data', () => {
  it('a shot with its picture made says so while the others still make theirs', () => {
    const made = job(IMAGES_RUNNING, [shot(2, '/b.png', false)]);
    expect([0, 1, 2].map((index) => shotPhase(made, index))).toEqual(['picture', 'pictureReady', 'picture']);
  });

  it('a clip that is made marks its own shot, not the first ones: the third shot is ready while the first is not', () => {
    const made = job([step('images', 'done', 4, 4), step('clips', 'running', 1, 3)], [shot(1, '/a.png', false), shot(3, '/c.png', true)]);
    expect([0, 1, 2].map((index) => shotPhase(made, index))).toEqual(['clip', 'clip', 'ready']);
  });

  it('a shot with nothing made waits while its stage has not begun, and is being made while it runs', () => {
    expect(shotPhase(job([step('images', 'waiting', 0, 3), step('clips', 'waiting', 0, 3)], []), 0)).toBe('waiting');
    expect(shotPhase(job(IMAGES_RUNNING, []), 0)).toBe('picture');
  });

  it('a shot whose picture is made waits for its clip when the clips have not begun; a shot with only its clip made is ready', () => {
    expect(shotPhase(job([step('images', 'done', 4, 4), step('clips', 'waiting', 0, 3)], [shot(1, '/a.png', false)]), 0)).toBe('pictureReady');
    expect(shotPhase(job([step('images', 'running', 1, 4), step('clips', 'running', 1, 3)], [shot(1, null, true)]), 0)).toBe('ready');
  });

  it('with no data of its own the stage comes from the counts, as before: the first clips that are done are ready', () => {
    const counted = job([step('images', 'done', 4, 4), step('clips', 'running', 1, 3)]);
    expect([0, 1, 2].map((index) => shotPhase(counted, index))).toEqual(['ready', 'clip', 'clip']);
  });
});

describe('pictures that every shot shares', () => {
  it('are the images the job makes beyond one per box', () => {
    expect(sharedImages([step('images', 'running', 3, 12), step('clips', 'waiting', 0, 11)])).toBe(1);
  });
  it('are none when there is one image per box, fewer images than boxes, or a stage is missing', () => {
    expect(sharedImages([step('images', 'running', 3, 11), step('clips', 'waiting', 0, 11)])).toBe(0);
    expect(sharedImages([step('images', 'running', 1, 2), step('clips', 'waiting', 0, 11)])).toBe(0);
    expect(sharedImages([])).toBe(0);
  });
});
