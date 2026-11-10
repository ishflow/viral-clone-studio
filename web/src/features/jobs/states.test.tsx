import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStep } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ClosedView } from './ClosedView';
import { QueuedView } from './QueuedView';
import { waitsInLine } from './waiting';

const waiting = (key: JobStep['key']): JobStep => ({ key, status: 'waiting', done: 0, total: 1 });
const base: Job = {
  id: 'job-1', userId: 'u', templateId: 'tpl-layering', templateTitle: 'Fragrance layering recipe',
  input: { templateId: 'tpl-layering', quality: 'fast', variants: 1, language: 'en', products: [{ name: 'Oil', description: '', images: [] }] },
  credits: 2, status: 'queued', steps: (['adaptation', 'images', 'clips', 'music', 'edit', 'render'] as const).map(waiting), stoppedReason: null,
  startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [], freeVideo: false, creditsReturned: 0, queuePosition: 2, delayed: false, paused: false,
  stoppedAt: null, continueUntil: null, closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: false, imagesStored: true, deletedAt: null,
};
afterEach(cleanup);

describe('QueuedView', () => {
  it('says it is in the queue, the position, and that there is nothing to do; all six stages wait', () => {
    renderWithI18n(<QueuedView job={base} />);
    expect(screen.getByText('In queue', { selector: 'span' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Place in the queue' });
    expect(within(card).getByRole('heading', { level: 2, name: 'In queue' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Your job starts when the one before it is done.');
    expect(card).toHaveTextContent('Position 2');
    expect(card).toHaveTextContent('Nothing more to do; you can leave this page.');
    expect(within(screen.getByRole('list', { name: 'Stages' })).getAllByText('waiting')).toHaveLength(6);
  });

  describe('the engine has not begun the job (the site holds it as running)', () => {
    const waitingJob: Job = { ...base, status: 'running', queuePosition: null, engineQueue: { ahead: 2, waitMinutes: 14 } };

    it('says it is in the queue with the videos in front and the minutes, in the card of the site queue; no stage can be pressed', () => {
      renderWithI18n(<QueuedView job={waitingJob} />);
      expect(screen.getByText('In queue', { selector: 'span' })).toBeInTheDocument();
      const card = screen.getByRole('region', { name: 'Place in the queue' });
      expect(card).toHaveTextContent('2 videos ahead · starts in about 14 min');
      expect(card).not.toHaveTextContent('Position');
      expect(card).toHaveTextContent('Nothing more to do; you can leave this page.');
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(within(screen.getByRole('list', { name: 'Stages' })).getAllByText('waiting')).toHaveLength(6);
    });

    it('with nobody in front it says it starts shortly; one video in front is singular', () => {
      const { unmount } = renderWithI18n(<QueuedView job={{ ...waitingJob, engineQueue: { ahead: 0, waitMinutes: 0 } }} />);
      expect(screen.getByRole('region', { name: 'Place in the queue' })).toHaveTextContent('Starting shortly');
      unmount();
      renderWithI18n(<QueuedView job={{ ...waitingJob, engineQueue: { ahead: 1, waitMinutes: 7 } }} />);
      expect(screen.getByRole('region', { name: 'Place in the queue' })).toHaveTextContent('1 video ahead · starts in about 7 min');
    });

    it('is in Turkish too', () => {
      renderWithI18n(<QueuedView job={waitingJob} />, 'tr');
      expect(screen.getByRole('region', { name: 'Sıradaki yerin' })).toHaveTextContent('Önünde 2 video · yaklaşık 14 dk sonra başlar');
    });
  });

  it('knows which jobs wait for the engine: the site queue holds its own, a running job with a line waits, one without does not', () => {
    expect(waitsInLine(base)).toBe(true);
    expect(waitsInLine({ ...base, status: 'running', engineQueue: { ahead: 0, waitMinutes: 0 } })).toBe(true);
    expect(waitsInLine({ ...base, status: 'running', engineQueue: null })).toBe(false);
    expect(waitsInLine({ ...base, status: 'running' })).toBe(false);
    expect(waitsInLine({ ...base, status: 'stopped', engineQueue: { ahead: 1, waitMinutes: 1 } })).toBe(false);
  });

  it('on the phone the card comes before the stages', () => {
    renderWithI18n(<QueuedView job={base} />);
    expect(screen.getByRole('region', { name: 'Place in the queue' }).className).toContain('order-first');
  });

  it('is in Turkish too', () => {
    renderWithI18n(<QueuedView job={base} />, 'tr');
    expect(screen.getByRole('region', { name: 'Sıradaki yerin' })).toHaveTextContent('2. sıra');
  });
});

describe('ClosedView', () => {
  const closed: Job = { ...base, status: 'closed', creditsReturned: 2, closedReason: 'customer', closedAt: '2026-10-05T10:00:00Z', queuePosition: null };

  it('closed by the customer: the credits that came back, three rows, the saved parts are deleted, another template, no stage list', () => {
    renderWithI18n(<ClosedView job={closed} balance={19} />);
    expect(screen.getByText('Closed', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Job closed' })).toBeInTheDocument();
    expect(screen.getByText('2 credits were returned. Nothing else was charged.')).toBeInTheDocument();
    const row = (label: string) => screen.getByText(label, { exact: true }).parentElement!;
    expect(row('Charged when you confirmed')).toHaveTextContent('2 credits');
    expect(row('Returned when it stopped')).toHaveTextContent('2 credits');
    expect(row('Balance now')).toHaveTextContent('19 credits');
    expect(screen.getByText('The saved parts of this video were deleted.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Pick another template' });
    expect(link).toHaveAttribute('href', '/gallery');
    expect(link.className).not.toContain('bg-accent');
    expect(screen.queryByRole('list', { name: 'Stages' })).toBeNull();
  });

  it('closed after 30 days: its own sentence', () => {
    renderWithI18n(<ClosedView job={{ ...closed, closedReason: 'expired' }} balance={19} />);
    expect(screen.getByText('This job was closed after 30 days. Your 2 credits were returned when it stopped. Nothing else was charged.')).toBeInTheDocument();
  });

  it('a free job names the free video and shows no credit rows', () => {
    renderWithI18n(<ClosedView job={{ ...closed, freeVideo: true, credits: 0, creditsReturned: 0 }} balance={19} />);
    expect(screen.getByText('Your free video is back. Nothing else was charged.')).toBeInTheDocument();
    expect(screen.queryByText('Balance now')).toBeNull();
    cleanup();
    renderWithI18n(<ClosedView job={{ ...closed, freeVideo: true, credits: 0, creditsReturned: 0, closedReason: 'expired' }} balance={19} />);
    expect(screen.getByText('This job was closed after 30 days. Your free video came back when it stopped. Nothing else was charged.')).toBeInTheDocument();
  });
});
