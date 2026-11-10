import { describe, expect, it } from 'vitest';
import type { Job, JobMade, JobShot, JobStep } from '@/data/ports';
import { autoView, viewsOf } from './output';

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const shot = (n: number, image: string | null, clipUrl: string | null, variant = 1): JobShot => ({ variant, n, image, clip: clipUrl !== null, clipUrl });
const job = (shots: JobShot[] | undefined, made?: JobMade, steps: JobStep[] = [step('images', 'running', 1, 3), step('clips', 'waiting', 0, 3)]): Job => ({ steps, shots, made, input: { variants: 1 } }) as unknown as Job;

describe('which stages have something to look at', () => {
  it('nothing made: nothing to open', () => {
    expect(viewsOf(job([]))).toEqual({ images: false, clips: false, music: false });
    expect(viewsOf(job(undefined))).toEqual({ images: false, clips: false, music: false });
  });

  it('a made picture opens Images, a clip with a file opens Clips, a music file opens Music, each on its own', () => {
    expect(viewsOf(job([shot(1, '/a.png', null)]))).toEqual({ images: true, clips: false, music: false });
    expect(viewsOf(job([shot(1, null, '/a.mp4')]))).toEqual({ images: false, clips: true, music: false });
    expect(viewsOf(job([], { music: [{ variant: 1, url: '/m.mp3' }], shared: [] }))).toEqual({ images: false, clips: false, music: true });
  });

  it('a picture every shot shares opens Images too', () => {
    expect(viewsOf(job([], { music: [], shared: [{ variant: 1, url: '/w.png' }] })).images).toBe(true);
  });

  it('a clip that is made but has no file to open (its address is not given) opens nothing', () => {
    expect(viewsOf(job([{ variant: 1, n: 1, image: null, clip: true, clipUrl: null }])).clips).toBe(false);
    expect(viewsOf(job([{ variant: 1, n: 1, image: null, clip: true }])).clips).toBe(false);
  });
});

describe('the stage the panel shows when nobody pressed anything', () => {
  it('the pictures while they come, the clips once one is made', () => {
    expect(autoView(job([shot(1, '/a.png', null)]))).toBe('images');
    expect(autoView(job([shot(1, '/a.png', '/a.mp4')]))).toBe('clips');
  });

  it('the clips as soon as the stage counts one, though the job does not tell which shot it is', () => {
    expect(autoView(job(undefined, undefined, [step('images', 'done', 3, 3), step('clips', 'running', 1, 3)]))).toBe('clips');
  });

  it('the pictures when nothing is made yet', () => {
    expect(autoView(job([]))).toBe('images');
  });
});
