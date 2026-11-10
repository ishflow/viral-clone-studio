import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStep, ResumeQuote } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ resumeJob: vi.fn(), closeJob: vi.fn() }));
vi.mock('./result-actions', () => ({ reportProblem: vi.fn(), deleteJobVideo: vi.fn(), regenerateVariant: vi.fn() }));

import { QueuedView } from './QueuedView';
import { ResultView } from './ResultView';
import { RunningView } from './RunningView';
import { StoppedView } from './StoppedView';

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const product: Job = {
  id: 'job-1', userId: 'u', templateId: 'tpl-1', templateTitle: 'Layering',
  input: { templateId: 'tpl-1', quality: 'fast', variants: 1, language: 'en', products: [{ name: 'Oil', description: '', images: [] }] },
  credits: 2, status: 'running', steps: [step('clips', 'running', 1, 2)], stoppedReason: null, startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [],
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
};
const swap: Job = {
  ...product, templateTitle: 'Walk to the camera', input: { ...product.input, products: [] },
  swap: { people: [{ slot: 1, body: 'uploads/me.jpg', face: null }], review: 'approved' },
};
const quote: ResumeQuote = {
  resumable: true, cost: 2, charged: 2, returned: 2, free: false, coveredByFreeVideo: false, freeUsedElsewhere: false, balance: 12, enough: true,
  missing: { images: 0, clips: 1, clipSeconds: 6, music: 0, voice: 0 }, continueUntil: '2026-11-03T12:10:00Z',
};
const template = (seconds: number) => ({ id: 'tpl-1', title: 'x', image: '/samples/p.jpg', video: null, seconds });
const lead = () => screen.getByRole('heading', { level: 1 }).nextElementSibling;

afterEach(cleanup);

describe('the line under the title of a person swap', () => {
  it('says what the job is and how long its video is, while it runs', () => {
    renderWithI18n(<RunningView job={swap} template={template(25)} minutesLeft={2} elapsedSeconds={30} />);
    expect(lead()).toHaveTextContent(/^Person swap · 25 sec$/);
  });

  it('says it while it waits for a place and while it is stopped', () => {
    renderWithI18n(<QueuedView job={{ ...swap, status: 'queued' }} seconds={25} />);
    expect(lead()).toHaveTextContent(/^Person swap · 25 sec$/);
    cleanup();
    renderWithI18n(<StoppedView job={{ ...swap, status: 'stopped', stoppedReason: 'clips-failed' }} quote={quote} seconds={25} />);
    expect(lead()).toHaveTextContent(/^Person swap · 25 sec$/);
  });

  it('says only what it is when the length of the video is not known (the template is gone)', () => {
    renderWithI18n(<RunningView job={swap} template={template(0)} minutesLeft={2} elapsedSeconds={30} />);
    expect(lead()).toHaveTextContent(/^Person swap$/);
  });

  it('is in Turkish for a Turkish customer', () => {
    renderWithI18n(<RunningView job={swap} template={template(25)} minutesLeft={2} elapsedSeconds={30} />, 'tr');
    expect(lead()).toHaveTextContent(/^Kişi değiştirme · 25 sn$/);
  });

  it('is never "0 products", and a product video keeps its line as it was', () => {
    renderWithI18n(<RunningView job={swap} template={template(25)} minutesLeft={2} elapsedSeconds={30} />);
    expect(screen.queryByText(/0 products/)).toBeNull();
    cleanup();
    renderWithI18n(<RunningView job={product} template={template(8)} minutesLeft={2} elapsedSeconds={30} />);
    expect(lead()).toHaveTextContent('1 product · Fast · 1 variant');
    cleanup();
    renderWithI18n(<StoppedView job={{ ...product, status: 'stopped', stoppedReason: 'render-failed' }} quote={quote} />);
    expect(lead()).toHaveTextContent('1 product · Fast · 1 variant');
  });
});

describe('the finished video of a person swap', () => {
  const done: Job = {
    ...swap, status: 'done', finishedAt: '2026-10-04T12:08:00Z',
    variants: [{ id: 'job-1-v1', image: '/samples/v1.jpg', video: '/media/jobs/v1.mp4', status: 'done', reason: null }],
  };
  const extras = { reportOpen: true, balance: 12, variantCosts: {} };

  it('lists no products (it has none), only its quality', () => {
    renderWithI18n(<ResultView job={done} template={template(25)} extras={extras} />);
    expect(screen.queryByText('Products')).toBeNull();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('lists the products of a product video as it did', () => {
    renderWithI18n(<ResultView job={{ ...done, swap: undefined, input: product.input }} template={template(8)} extras={extras} />);
    expect(screen.getByText('Products')).toBeInTheDocument();
  });
});
