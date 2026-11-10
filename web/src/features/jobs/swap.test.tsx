import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobStep } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), unstable_rethrow: () => {} }));
const closeJob = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ closeJob }));
const reportProblem = vi.hoisted(() => vi.fn());
vi.mock('./result-actions', () => ({ reportProblem }));

import { ClosedView } from './ClosedView';
import { QueuedView } from './QueuedView';
import { ReportDialog } from './ReportDialog';
import { StageList } from './StageList';

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const swapJob = (over: Partial<Job> = {}): Job => ({
  id: 'job-1', userId: 'u', templateId: 'tpl-swap', templateTitle: 'Walk to the camera',
  input: { templateId: 'tpl-swap', quality: 'fast', variants: 1, language: 'en', products: [] },
  credits: 3, status: 'queued', steps: [step('clips', 'waiting', 0, 2), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)], stoppedReason: null,
  startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [], freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false,
  stoppedAt: null, continueUntil: null, closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: false, imagesStored: true, deletedAt: null,
  swap: { people: [{ slot: 1, body: 'uploads/me.jpg', face: null }], review: 'waiting' },
  ...over,
});
const rejected = (closedReason: Job['closedReason']) =>
  swapJob({ status: 'closed', closedReason, creditsReturned: 3, closedAt: '2026-10-05T12:00:00Z', swap: { people: [], review: 'rejected' } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the stages of a person swap', () => {
  it('are its own three, named for what happens to the video; the stages it does not have are not shown', () => {
    // The engine writes the stages a person swap skips as done with nothing in them.
    const steps = [step('adaptation', 'done', 0, 0), step('images', 'done', 0, 0), step('music', 'done', 0, 0), step('clips', 'running', 1, 2), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)];
    renderWithI18n(<StageList steps={steps} swap />);
    const rows = within(screen.getByRole('list', { name: 'Stages' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Person swap');
    expect(rows[0]).toHaveTextContent('running · 1 / 2');
    expect(rows[1]).toHaveTextContent('Join');
    expect(rows[2]).toHaveTextContent('Sound and label');
    expect(screen.queryByText('Clips')).toBeNull();
  });

  it('are the six of a product video for every other job', () => {
    renderWithI18n(<StageList steps={[step('clips', 'running', 1, 2), step('edit', 'waiting', 0, 1)]} />);
    expect(screen.getByText('Clips')).toBeInTheDocument();
    expect(screen.queryByText('Person swap')).toBeNull();
  });
});

describe('a person swap that waits for the look at its photo', () => {
  it('says an admin has to approve it, within 48 hours at the latest, and that the credits come back otherwise; it has no place in a line', () => {
    renderWithI18n(<QueuedView job={swapJob()} />);
    const card = screen.getByRole('region', { name: 'Approval' });
    expect(within(card).getByRole('heading', { level: 2, name: "Waiting for an admin's approval" })).toBeInTheDocument();
    expect(card).toHaveTextContent('at most 48 hours');
    expect(card).toHaveTextContent('every credit comes back');
    expect(screen.queryByText(/Position/)).toBeNull();
    expect(screen.queryByText('Your job starts when the one before it is done.')).toBeNull();
    expect(screen.queryByText(/0 products/)).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Stages' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('can be cancelled by its owner: the job is closed and the page reads it again', async () => {
    closeJob.mockResolvedValue({ status: 'ok' });
    renderWithI18n(<QueuedView job={swapJob()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel and get the credits back' }));
    expect(closeJob).toHaveBeenCalledWith('job-1');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('says so when the cancel did not work', async () => {
    closeJob.mockResolvedValue({ status: 'error' });
    renderWithI18n(<QueuedView job={swapJob()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel and get the credits back' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The job could not be cancelled. Try again.');
  });

  it('is in Turkish for a Turkish customer', () => {
    renderWithI18n(<QueuedView job={swapJob()} />, 'tr');
    expect(screen.getByRole('region', { name: 'Onay' })).toHaveTextContent('Yönetici onayı bekleniyor');
    expect(screen.getByRole('region', { name: 'Onay' })).toHaveTextContent('en geç 48 saat');
    expect(screen.getByRole('button', { name: 'İptal et ve krediyi geri al' })).toBeInTheDocument();
  });

  it('has no cancel and no approval card once it is approved and waits for a place like any job', () => {
    renderWithI18n(<QueuedView job={swapJob({ queuePosition: 1, swap: { people: [], review: 'approved' } })} />);
    expect(screen.queryByRole('button', { name: 'Cancel and get the credits back' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Place in the queue' })).toHaveTextContent('Position 1');
  });
});

describe('a person swap that never started', () => {
  it('refused by the admin: says "not approved" and that the credits came back, never "closed"', () => {
    renderWithI18n(<ClosedView job={rejected(null)} balance={19} />);
    expect(screen.getByText('Not approved', { selector: 'span' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Not approved' });
    expect(card).toHaveTextContent('This photo was not approved, so no video was made. Your 3 credits were returned.');
    expect(card).toHaveTextContent('Your photos were deleted.');
    expect(within(card).getByRole('link', { name: 'Try another photo' })).toHaveAttribute('href', '/swap');
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByText('Job closed')).toBeNull();
  });

  it('while person swap is switched off: says the same, and links to no page of person swap', () => {
    renderWithI18n(<ClosedView job={rejected(null)} balance={19} swapOpen={false} />);
    const card = screen.getByRole('region', { name: 'Not approved' });
    expect(card).toHaveTextContent('This photo was not approved, so no video was made. Your 3 credits were returned.');
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('in Turkish: "onaylanmadı, kredin iade edildi"', () => {
    renderWithI18n(<ClosedView job={rejected(null)} balance={19} />, 'tr');
    expect(screen.getByRole('region', { name: 'Onaylanmadı' })).toHaveTextContent('3 kredin iade edildi');
    expect(screen.queryByText('Kapatıldı')).toBeNull();
  });

  it('given up by its owner: says it was cancelled and that the credits came back', () => {
    renderWithI18n(<ClosedView job={rejected('customer')} balance={19} />);
    expect(screen.getByRole('region', { name: 'Cancelled' })).toHaveTextContent('You cancelled before the video was made. Your 3 credits were returned.');
  });

  it('left for 48 hours: says nobody looked in time and that the credits came back', () => {
    renderWithI18n(<ClosedView job={rejected('expired')} balance={19} />);
    expect(screen.getByRole('region', { name: 'Not approved in time' })).toHaveTextContent('Nobody looked at the photo within 48 hours, so the job ended. Your 3 credits were returned.');
  });

  it('a product job that was closed still says what it said', () => {
    renderWithI18n(<ClosedView job={swapJob({ status: 'closed', closedReason: 'customer', creditsReturned: 3, swap: undefined })} balance={19} />);
    expect(screen.getByRole('region', { name: 'Job closed' })).toHaveTextContent('3 credits were returned. Nothing else was charged.');
  });
});

describe('reporting a person-swap video', () => {
  it('offers "this is not me" and sends it as a report that names it', async () => {
    reportProblem.mockResolvedValue({ status: 'sent' });
    renderWithI18n(<ReportDialog jobId="job-1" swap onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'This is not me, or it was made without permission' }));
    await userEvent.type(screen.getByRole('textbox'), 'take it down');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(reportProblem).toHaveBeenCalledWith('job-1', 'not-me', 'take it down', expect.any(String));
  });

  it('does not offer it for a product video', () => {
    renderWithI18n(<ReportDialog jobId="job-1" onClose={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });
});
