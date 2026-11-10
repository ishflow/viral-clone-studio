import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobShot, JobStep } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RunningView } from './RunningView';

// The boxes of a running job show the first frame the site made of their shot, as soon as it is made.

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const STEPS = [step('adaptation', 'done', 1, 1), step('images', 'running', 2, 4), step('clips', 'waiting', 0, 3), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)];
const jobWith = (shots: JobShot[] | undefined, steps: JobStep[] = STEPS, variants: 1 | 2 | 3 = 1): Job => ({
  id: 'job-1', userId: 'u', templateId: 'tpl-1', templateTitle: 'Layering',
  input: { templateId: 'tpl-1', quality: 'fast', variants, language: 'en', products: [{ name: 'Oil', description: '', images: ['uploads/usr-demo/oil.jpg'] }] },
  credits: 2, status: 'running', steps, stoppedReason: null, startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [], shots,
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
});
const template = (shotFrames?: string[]) => ({ id: 'tpl-1', title: 'Layering', image: '/samples/poster.jpg', video: null, seconds: 8, shotFrames });
const render = (job: Job, shotFrames?: string[]) => renderWithI18n(<RunningView job={job} template={template(shotFrames)} minutesLeft={2} elapsedSeconds={30} />);
const boxes = (container: HTMLElement) => [...container.querySelectorAll('figure')];
const src = (box: Element) => box.querySelector('img')?.getAttribute('src') ?? null;
const shot = (n: number, image: string | null, clip = false, variant = 1): JobShot => ({ variant, n, image, clip });

afterEach(cleanup);

describe('the frame a box shows', () => {
  it('the first frame made for a shot is in its own box, sharp, and the others stay empty; a frame is never the customer\'s product photo', () => {
    const { container } = render(jobWith([shot(2, '/media/jobs/r/paid/v1/image-s2.png')]));
    expect(boxes(container).map(src)).toEqual([null, '/media/jobs/r/paid/v1/image-s2.png', null]);
    expect(container.querySelector('img')).not.toHaveClass('opacity-60');
    expect(container.querySelector('img[src*="uploads/"]')).toBeNull();
  });

  it('a shot that has its own frame shows it instead of the template\'s faded frame; the others keep the faded one', () => {
    const { container } = render(jobWith([shot(1, '/media/jobs/r/paid/v1/image-s1.png')]), ['/media/t/1.jpg', '/media/t/2.jpg', '/media/t/3.jpg']);
    expect(boxes(container).map(src)).toEqual(['/media/jobs/r/paid/v1/image-s1.png', '/media/t/2.jpg', '/media/t/3.jpg']);
    expect(boxes(container).map((box) => box.querySelector('img')?.classList.contains('opacity-60'))).toEqual([false, true, true]);
  });

  it('the boxes of the second variant take the frames of the second variant', () => {
    const steps = [step('images', 'running', 2, 8), step('clips', 'waiting', 0, 6)];
    const { container } = render(jobWith([shot(1, '/a.png', false, 1), shot(1, '/b.png', false, 2)], steps, 2));
    expect(boxes(container).map(src)).toEqual(['/a.png', null, null, '/b.png', null, null]);
  });

  it('a frame that cannot be loaded (the file is gone) turns the box back into its numbered frame: no broken picture', () => {
    const { container } = render(jobWith([shot(1, '/media/jobs/r/paid/v1/image-s1.png')]));
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(boxes(container)[0]!.querySelector('div[aria-hidden="true"]')).toHaveTextContent('1');
  });

  it('a frame that cannot be loaded gives its box back to the template\'s faded frame, when there is one', () => {
    const { container } = render(jobWith([shot(1, '/media/jobs/r/paid/v1/image-s1.png')]), ['/media/t/1.jpg', '/media/t/2.jpg', '/media/t/3.jpg']);
    fireEvent.error(container.querySelector('img')!);
    expect(src(boxes(container)[0]!)).toBe('/media/t/1.jpg');
  });
});

describe('what a box says', () => {
  const captions = (container: HTMLElement) => boxes(container).map((box) => box.querySelector('figcaption')?.textContent);

  it('each box says the stage of its own shot: the picture ready, the clip ready, or still being made', () => {
    const steps = [step('images', 'running', 2, 4), step('clips', 'running', 1, 3)];
    const { container } = render(jobWith([shot(1, '/a.png', true), shot(2, '/b.png', false)], steps));
    expect(captions(container)).toEqual(['Shot 1clip ready', 'Shot 2making the clip', 'Shot 3making the picture']);
  });

  it('with a frame in the boxes the note speaks of your picture; with the template\'s faded frames too it speaks of both', () => {
    const own = render(jobWith([shot(1, '/a.png')]));
    expect(own.container.textContent).toContain('The sharp picture is the first frame we made');
    expect(own.container.textContent).not.toContain('faded');
    cleanup();
    const both = render(jobWith([shot(1, '/a.png')]), ['/media/t/1.jpg', '/media/t/2.jpg', '/media/t/3.jpg']);
    expect(both.container.textContent).toContain('The sharp picture is the first frame we made');
    expect(both.container.textContent).toContain('the faded one is that shot in the original video');
  });

  it('with no frame of the job\'s own the note is the one of before', () => {
    const { container } = render(jobWith([]), ['/media/t/1.jpg', '/media/t/2.jpg', '/media/t/3.jpg']);
    expect(container.textContent).toContain('The faded picture is that shot in the original video');
    expect(container.textContent).not.toContain('sharp');
  });
});

describe('the Images stage', () => {
  it('names the pictures every shot shares, so that 12 images for 11 shots is no riddle', () => {
    const steps = [step('images', 'running', 2, 4), step('clips', 'waiting', 0, 3)];
    const { container } = render(jobWith([], steps));
    expect(container.textContent).toContain('The first frame of each shot, plus 1 picture they all share');
  });

  it('keeps the plain note when there is one image for each box', () => {
    const steps = [step('images', 'running', 2, 3), step('clips', 'waiting', 0, 3)];
    const { container } = render(jobWith([], steps));
    expect(container.textContent).toContain('The first frame of each shot');
    expect(container.textContent).not.toContain('they all share');
  });
});
