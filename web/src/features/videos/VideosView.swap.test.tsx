import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, Template } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { toRow, type VideoRow } from './rows';

vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span data-testid="img" role="img" aria-label={p.alt} /> }));
vi.mock('./actions', () => ({ deleteVideo: vi.fn() }));

import { VideosView } from './VideosView';

afterEach(cleanup);

const swapRow: VideoRow = {
  id: 'j1', templateId: 'tpl-swap', title: 'Walk to the camera', image: '/samples/a.jpg', productNames: [], quality: 'fast', variants: 1, seconds: 25, swap: true,
  status: 'done', step: null, minutesLeft: 3, returned: 0, free: false, queuePosition: null, engineQueue: null, stored: true, delivered: 1, reason: null,
  startedAt: '2026-10-06T09:30:00.000Z',
};
const view = (rows: VideoRow[], locale: 'en' | 'tr' = 'en') => renderWithI18n(<VideosView rows={rows} filter="all" total={rows.length} freeAvailable />, locale);

describe('a person-swap video in My videos', () => {
  it('shows its own name, that it is a person swap with its length, and that it is kept 30 days; no products, no variants', () => {
    view([swapRow]);
    const list = within(screen.getByRole('list'));
    expect(list.getByRole('heading', { level: 2 })).toHaveTextContent('Walk to the camera');
    expect(list.getByText('Person swap · 25 sec')).toBeInTheDocument();
    expect(list.getByText('mp4 · 720p · kept 30 days')).toBeInTheDocument();
    expect(list.queryByText(/products?:/)).toBeNull();
    expect(list.queryByText(/variant/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/jobs/j1');
  });

  it('in Turkish', () => {
    view([swapRow], 'tr');
    expect(screen.getByText('Kişi değiştirme · 25 sn')).toBeInTheDocument();
    expect(screen.getByText('mp4 · 720p · 30 gün saklanır')).toBeInTheDocument();
  });

  it('after the 30 days: says so, not "12 months", and the new job is a person swap, not a product video', () => {
    view([{ ...swapRow, stored: false }]);
    expect(screen.getByText('No longer stored')).toBeInTheDocument();
    expect(screen.getByText('Person swap videos are kept for 30 days.')).toBeInTheDocument();
    expect(screen.getByText('This starts a new job: you add your photos again and confirm the price.')).toBeInTheDocument();
    expect(screen.queryByText(/12 months/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Generate it again' })).toHaveAttribute('href', '/swap/tpl-swap');
  });

  it('running: the stage in its own words; stopped: the credits that came back, no count of clips', () => {
    view([{ ...swapRow, status: 'running', step: { key: 'clips', done: 1, total: 2 } }, { ...swapRow, id: 'j2', status: 'stopped', returned: 3, step: { key: 'clips', done: 1, total: 2 } }]);
    expect(screen.getByText('Person swap 1 / 2 · about 3 min left')).toBeInTheDocument();
    expect(screen.getByText('Credits returned')).toBeInTheDocument();
    expect(screen.queryByText(/clips saved/)).toBeNull();
  });

  it('a product video is shown as it was', () => {
    view([{ ...swapRow, swap: undefined, productNames: ['Oil'], seconds: null }]);
    expect(screen.getByText('1 product: Oil')).toBeInTheDocument();
    expect(screen.getByText('Fast · 1 variant')).toBeInTheDocument();
    expect(screen.getByText('mp4 · 720p')).toBeInTheDocument();
  });
});

describe('the row of a person-swap job', () => {
  const swapJob = {
    id: 'j1', userId: 'u', templateId: 'tpl-swap', templateTitle: 'Walk to the camera', credits: 3, status: 'done', steps: [], stoppedReason: null,
    startedAt: '2026-10-06T09:30:00Z', finishedAt: null, variants: [], freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false,
    stoppedAt: null, continueUntil: null, closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
    input: { templateId: 'tpl-swap', products: [], quality: 'fast', variants: 1, language: 'en' },
    swap: { people: [], review: null },
  } as Job;

  it('is a person swap and carries the length of the video of its template, whatever the format of the template', () => {
    const row = toRow(swapJob, { id: 'tpl-swap', image: '/x.jpg', format: 'no-talking', seconds: 25 } as Template);
    expect(row.swap).toBe(true);
    expect(row.seconds).toBe(25);
  });

  it('is not one for any other job, and its length stays as it was (talking videos only)', () => {
    const row = toRow({ ...swapJob, swap: undefined }, { id: 'tpl-swap', image: '/x.jpg', format: 'no-talking', seconds: 25 } as Template);
    expect(row.swap).toBe(false);
    expect(row.seconds).toBeNull();
  });

  it('says that person swap is switched off when it is, for a person swap only', () => {
    const template = { id: 'tpl-swap', image: '/x.jpg', format: 'no-talking', seconds: 25 } as Template;
    expect(toRow(swapJob, template, false).swapClosed).toBe(true);
    expect(toRow(swapJob, template, true)).not.toHaveProperty('swapClosed');
    expect(toRow(swapJob, template)).not.toHaveProperty('swapClosed');
    expect(toRow({ ...swapJob, swap: undefined }, template, false)).not.toHaveProperty('swapClosed');
  });
});

describe('a person-swap video in My videos while person swap is switched off', () => {
  it('after the 30 days: still says that it is no longer stored, and links to no page of person swap', () => {
    view([{ ...swapRow, stored: false, swapClosed: true }]);
    expect(screen.getByText('No longer stored')).toBeInTheDocument();
    expect(screen.getByText('Person swap videos are kept for 30 days.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Generate it again' })).toBeNull();
    expect(screen.queryByText(/This starts a new job/)).toBeNull();
    expect(screen.queryAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/swap'))).toEqual([]);
  });

  it('a video that is still kept opens as before', () => {
    view([{ ...swapRow, swapClosed: true }]);
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/jobs/j1');
  });
});
