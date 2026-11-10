import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStep } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RunningView } from './RunningView';

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const steps: JobStep[] = [step('adaptation', 'done', 1, 1), step('images', 'done', 2, 2), step('clips', 'running', 1, 2), step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)];
const jobWith = (images: string[], jobSteps: JobStep[] = steps): Job => ({
  id: 'job-1', userId: 'u', templateId: 'tpl-1', templateTitle: 'Layering',
  input: { templateId: 'tpl-1', quality: 'fast', variants: 1, language: 'en', products: [{ name: 'Oil', description: '', images }] },
  credits: 2, status: 'running', steps: jobSteps, stoppedReason: null, startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [],
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
});
const template = (shotFrames?: string[]) => ({ id: 'tpl-1', title: 'Layering', image: '/samples/poster.jpg', video: null, seconds: 8, shotFrames });
const frames = (container: HTMLElement) => [...container.querySelectorAll('figure img')];
const render = (job: Job, shotFrames?: string[]) => renderWithI18n(<RunningView job={job} template={template(shotFrames)} minutesLeft={2} elapsedSeconds={30} />);
const captions = (container: HTMLElement) => [...container.querySelectorAll('figcaption')].map((c) => c.textContent);

afterEach(cleanup);

describe('RunningView shot boxes', () => {
  it('one box per shot, each one numbered, so a box reads as a shot and not as a product picture', () => {
    const { container } = render(jobWith(['uploads/usr-demo/oil.jpg']));
    expect(container.querySelectorAll('figure')).toHaveLength(2);
    expect(captions(container)).toEqual(['Shot 1clip ready', 'Shot 2making the clip']);
  });

  it("the customer's product photo is never a shot's picture, ready or not", () => {
    const { container } = render(jobWith(['uploads/usr-demo/oil.jpg', '/samples/oil.jpg']));
    expect(frames(container)).toHaveLength(0);
    expect(container.querySelectorAll('figure div[aria-hidden="true"].aspect-\\[9\\/16\\]')).toHaveLength(2);
    expect(container.querySelectorAll('img[src=""]')).toHaveLength(0);
  });

  it("an empty box carries its shot number; a box with the template's frame does not repeat it on the picture", () => {
    const empty = render(jobWith([]));
    expect(empty.container.querySelector('figure div[aria-hidden="true"]')).toHaveTextContent('1');
    cleanup();
    const framed = render(jobWith([]), ['/media/templates/tpl-1/shots/1.jpg', '/media/templates/tpl-1/shots/2.jpg']);
    expect(framed.container.querySelector('figure div[aria-hidden="true"]')).toBeNull();
  });

  it("each box shows its own shot's frame of the template video, faded, since it is not the customer's shot", () => {
    const { container } = render(jobWith([]), ['/media/templates/tpl-1/shots/1.jpg', '/media/templates/tpl-1/shots/2.jpg']);
    expect(frames(container).map((img) => img.getAttribute('src'))).toEqual(['/media/templates/tpl-1/shots/1.jpg', '/media/templates/tpl-1/shots/2.jpg']);
    expect(frames(container).every((img) => img.classList.contains('opacity-60'))).toBe(true);
    expect(screen.getByText(/The faded picture is that shot in the original video/)).toBeInTheDocument();
  });

  it('with no frame to show, the note does not talk about a faded picture', () => {
    render(jobWith([]));
    expect(screen.queryByText(/faded picture/)).toBeNull();
  });

  it("a shot without a frame of its own is an empty box, and a list of frames that does not match the shots is not used", () => {
    const gap = render(jobWith([]), ['/media/templates/tpl-1/shots/1.jpg', '']);
    expect(frames(gap.container).map((img) => img.getAttribute('src'))).toEqual(['/media/templates/tpl-1/shots/1.jpg']);
    expect(gap.container.querySelectorAll('figure div[aria-hidden="true"]')).toHaveLength(1);
    cleanup();
    const off = render(jobWith([]), ['/media/templates/tpl-1/shots/1.jpg']);
    expect(frames(off.container)).toHaveLength(0);
  });

  it('a box says the stage its shot is at, the same as the list on the left', () => {
    const at = (images: JobStep, clips: JobStep) => captions(render(jobWith([], [step('adaptation', 'done', 1, 1), images, clips, step('music', 'waiting', 0, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)])).container);
    expect(at(step('images', 'waiting', 0, 2), step('clips', 'waiting', 0, 2))).toEqual(['Shot 1waiting', 'Shot 2waiting']);
    expect(at(step('images', 'running', 1, 2), step('clips', 'waiting', 0, 2))).toEqual(['Shot 1making the picture', 'Shot 2making the picture']);
    expect(at(step('images', 'done', 2, 2), step('clips', 'waiting', 0, 2))).toEqual(['Shot 1picture ready', 'Shot 2picture ready']);
    expect(at(step('images', 'done', 2, 2), step('clips', 'running', 0, 2))).toEqual(['Shot 1making the clip', 'Shot 2making the clip']);
    expect(at(step('images', 'done', 2, 2), step('clips', 'running', 1, 2))).toEqual(['Shot 1clip ready', 'Shot 2making the clip']);
  });
});
