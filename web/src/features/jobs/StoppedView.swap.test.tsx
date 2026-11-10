import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStep, ResumeQuote, StopDetail } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ resumeJob: vi.fn(), closeJob: vi.fn() }));

import userEvent from '@testing-library/user-event';
import * as actions from './actions';
import { StoppedView } from './StoppedView';

const resumeJob = vi.mocked(actions.resumeJob);

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const stopped = (detail: StopDetail | null): Job => ({
  id: 'job-1', userId: 'u', templateId: 'tpl-swap', templateTitle: 'Walk to the camera',
  input: { templateId: 'tpl-swap', quality: 'fast', variants: 1, language: 'en', products: [] },
  credits: 3, status: 'stopped', stoppedReason: 'clips-failed', stoppedDetail: detail, startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [],
  freeVideo: false, creditsReturned: 3, queuePosition: null, delayed: false, paused: false, stoppedAt: '2026-10-04T12:10:00Z',
  continueUntil: '2026-10-11T12:10:00Z', closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null,
  videoStored: false, imagesStored: true, deletedAt: null,
  steps: [step('clips', 'stopped', 1, 2), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)],
  swap: { people: [{ slot: 1, body: 'uploads/me.jpg', face: null }], review: 'approved' },
});
// What the data layer says of both: the owner cannot continue them, and everything came back when they stopped.
const notResumable: ResumeQuote = {
  resumable: false, cost: 0, charged: 3, returned: 3, free: false, coveredByFreeVideo: false, freeUsedElsewhere: false, balance: 12, enough: true,
  missing: { images: 0, clips: 1, clipSeconds: 6, music: 0, voice: 0 }, continueUntil: null,
};

afterEach(cleanup);

describe.each(['photo-refused', 'person-missing'] as const)('a person swap stopped with %s', (detail) => {
  it('says what happened in its own words, never the count of clips of a product video', () => {
    renderWithI18n(<StoppedView job={stopped(detail)} quote={notResumable} />);
    const card = screen.getByRole('region', { name: 'What happened and your options' });
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent(detail === 'photo-refused' ? 'Your photo was not accepted' : 'The person was not found');
    expect(card).not.toHaveTextContent(/clip/i);
    expect(card).not.toHaveTextContent('What was finished is saved');
    expect(card).toHaveTextContent('The 3 credits for this video are back in your balance.');
  });

  it('offers no continue, no retry and no stop: only a new job and the support', () => {
    renderWithI18n(<StoppedView job={stopped(detail)} quote={notResumable} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Try with another photo' })).toHaveAttribute('href', '/swap/tpl-swap');
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact?topic=video&job=job-1');
  });

  it('while person swap is switched off: says it is switched off like any other stopped person swap, never to start a new one with another photo, and links only to the support', () => {
    renderWithI18n(<StoppedView job={stopped(detail)} quote={notResumable} swapOpen={false} />);
    const card = screen.getByRole('region', { name: 'What happened and your options' });
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Person swap is switched off right now');
    expect(card).toHaveTextContent('This job cannot be continued while person swap is switched off, and nothing more is charged for it.');
    expect(card).not.toHaveTextContent(/another photo/i);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/contact?topic=video&job=job-1']);
  });

  it('is in Turkish while it is switched off, too: the same switched-off sentence', () => {
    renderWithI18n(<StoppedView job={stopped(detail)} quote={notResumable} swapOpen={false} />, 'tr');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Kişi değiştirme şu an kapalı');
    expect(screen.queryByText(/başka bir fotoğrafla/i)).toBeNull();
  });

  it('is in Turkish for a Turkish customer', () => {
    renderWithI18n(<StoppedView job={stopped(detail)} quote={notResumable} />, 'tr');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(detail === 'photo-refused' ? 'Fotoğrafın kabul edilmedi' : 'Kişi bulunamadı');
    expect(screen.getByRole('link', { name: 'Başka bir fotoğrafla dene' })).toBeInTheDocument();
    expect(screen.getByText(/3 kredisi bakiyene geri döndü/)).toBeInTheDocument();
  });
});

describe('a person swap stopped for another reason', () => {
  it('keeps the page of any job: the clips count and the options of the data layer', () => {
    renderWithI18n(<StoppedView job={stopped(null)} quote={{ ...notResumable, resumable: true, cost: 3, continueUntil: '2026-10-11T12:10:00Z' }} />);
    expect(screen.getByRole('button', { name: /Continue with the backup model/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Try with another photo' })).toBeNull();
  });
});

describe('a stopped person swap while person swap is switched off', () => {
  it('says that it is switched off and that nothing is charged; no continue, no retry, no stop, only the support', () => {
    renderWithI18n(<StoppedView job={stopped(null)} quote={notResumable} swapOpen={false} />);
    const card = screen.getByRole('region', { name: 'What happened and your options' });
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Person swap is switched off right now');
    expect(card).toHaveTextContent('The 3 credits for this video are back in your balance. This job cannot be continued while person swap is switched off, and nothing more is charged for it.');
    expect(card).not.toHaveTextContent(/clip/i);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/contact?topic=video&job=job-1']);
  });

  it('is in Turkish for a Turkish customer', () => {
    renderWithI18n(<StoppedView job={stopped(null)} quote={notResumable} swapOpen={false} />, 'tr');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Kişi değiştirme şu an kapalı');
    expect(screen.getByText(/Kişi değiştirme kapalıyken bu işe devam edilemez; bu iş için başka kredi kesilmez\./)).toBeInTheDocument();
  });

  it('switched off after the page was read: the confirmation closes, nothing is told as an error', async () => {
    resumeJob.mockResolvedValue({ status: 'error', swapClosed: true });
    renderWithI18n(<StoppedView job={stopped(null)} quote={{ ...notResumable, resumable: true, cost: 3, continueUntil: '2026-10-11T12:10:00Z' }} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm and continue' }));
    expect(resumeJob).toHaveBeenCalledWith('job-1', 3);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Something went wrong. Nothing was spent. Try again.')).toBeNull();
  });
});
