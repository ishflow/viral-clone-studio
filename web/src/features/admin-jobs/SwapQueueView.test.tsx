import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from '@/shared/lib/format';
import { renderWithI18n } from '@/shared/ui/test-utils';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const answerSwap = vi.fn();
vi.mock('./review-actions', () => ({ answerSwap: (...a: unknown[]) => answerSwap(...a) }));

import type { SwapQueueRow } from './review-load';
import { SwapQueueView } from './SwapQueueView';

const row = (over: Partial<SwapQueueRow> = {}): SwapQueueRow => ({
  id: 'job-1', userId: 'usr-demo', email: 'demo@viralclone.app', templateTitle: 'Morning routine', since: '2026-10-06T09:00:00.000Z', decideBy: '2026-10-08T09:00:00.000Z',
  minutesLeft: 45 * 60 + 5, credits: 6, frame: '/media/templates/tpl-swap/poster.jpg', hints: ['the woman in the red dress'],
  photos: [
    { slot: 1, kind: 'body', state: 'shown', name: 'body.jpg', src: '/admin/jobs/review/job-1/1/body' },
    { slot: 1, kind: 'face', state: 'shown', name: 'face.jpg', src: '/admin/jobs/review/job-1/1/face' },
    { slot: 1, kind: 'side', state: 'shown', name: 'side.jpg', src: '/admin/jobs/review/job-1/1/side' },
  ],
  ...over,
});
const second = row({ id: 'job-2', email: 'new@viralclone.app', templateTitle: 'Gym walk', minutesLeft: 12, photos: [{ slot: 1, kind: 'body', state: 'shown', name: 'me.jpg', src: null }] });
const item = (email: string) => screen.getByRole('listitem', { name: new RegExp(email) });
const DONE = { status: 'done', at: '2026-10-07T10:00:00.000Z', detail: null };

afterEach(cleanup);
beforeEach(() => {
  refresh.mockReset();
  answerSwap.mockReset();
  answerSwap.mockResolvedValue(DONE);
});

describe('the line', () => {
  it('says who waits, with which video, since when and how long is left, in the order it was given', () => {
    renderWithI18n(<SwapQueueView rows={[row(), second]} lookOn />);
    const items = within(screen.getByRole('list', { name: 'Jobs that wait for the look' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('heading', { name: 'Morning routine' })).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'demo@viralclone.app' })).toHaveAttribute('href', '/admin/users/usr-demo');
    expect(within(items[0]!).getByText(`Waiting since ${formatDate('2026-10-06T09:00:00.000Z', 'en')}`)).toBeInTheDocument();
    expect(within(items[0]!).getByText('Refused by itself in 45 h 5 min')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Credits charged: 6')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('heading', { name: 'Gym walk' })).toBeInTheDocument();
    expect(within(items[1]!).getByText('Refused by itself in 12 min')).toBeInTheDocument();
  });

  it('puts the photographs beside the frame of the video, each from the admin route as it is, and names the person to replace', () => {
    renderWithI18n(<SwapQueueView rows={[row()]} lookOn />);
    // The path and nothing else: no image optimizer in between, which would fetch the photograph without the admin's session and keep a copy.
    const asked = (name: string) => {
      const url = new URL(within(item('demo@')).getByRole('img', { name }).getAttribute('src')!, 'http://localhost:3000');
      return url.pathname + url.search;
    };
    expect(asked('Full-body photo of demo@viralclone.app')).toBe('/admin/jobs/review/job-1/1/body');
    expect(asked('Face photo of demo@viralclone.app')).toBe('/admin/jobs/review/job-1/1/face');
    expect(asked('Side photo of demo@viralclone.app')).toBe('/admin/jobs/review/job-1/1/side');
    expect(asked('Frame of the video Morning routine')).toBe('/media/templates/tpl-swap/poster.jpg');
    expect(within(item('demo@')).getByText('Person in the video: the woman in the red dress')).toBeInTheDocument();
  });

  it('a photograph with no file (fake mode) is a placeholder with its file name, not a picture', () => {
    renderWithI18n(<SwapQueueView rows={[second]} lookOn />);
    expect(within(item('new@')).queryByRole('img', { name: /Full-body photo/ })).toBeNull();
    expect(within(item('new@')).getByText('No file in test mode')).toBeInTheDocument();
    expect(within(item('new@')).getByText('me.jpg')).toBeInTheDocument();
  });

  it.each([
    ['decided', 'Already decided: the photo is not shown any more.'],
    ['deleted', 'Deleted.'],
  ] as const)('a photograph that is %s says so and asks the route for nothing', (state, text) => {
    renderWithI18n(<SwapQueueView rows={[row({ photos: [{ slot: 1, kind: 'body', state, name: null, src: null }] })]} lookOn />);
    expect(within(item('demo@')).getByText(text)).toBeInTheDocument();
    expect(within(item('demo@')).queryByRole('img', { name: /photo/ })).toBeNull();
  });

  it('a photograph the route no longer gives (answered meanwhile) says it can no longer be shown', () => {
    renderWithI18n(<SwapQueueView rows={[row()]} lookOn />);
    fireEvent.error(within(item('demo@')).getByRole('img', { name: 'Full-body photo of demo@viralclone.app' }));
    expect(within(item('demo@')).getByText('This photo can no longer be shown.')).toBeInTheDocument();
    expect(within(item('demo@')).queryByRole('img', { name: /Full-body photo/ })).toBeNull();
  });

  it.each([
    [true, 'A person-swap job appears here as soon as a customer starts one.'],
    [false, 'The look at photos is switched off in Settings: person-swap jobs start without it.'],
  ])('with nothing waiting it says so, and whether the look is on (%s)', (lookOn, text) => {
    renderWithI18n(<SwapQueueView rows={[]} lookOn={lookOn} />);
    expect(screen.getByRole('heading', { name: 'No photos wait for a look' })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

describe('the answer', () => {
  it('approve is one click: it is sent once for that job, said, and the line is read again', async () => {
    renderWithI18n(<SwapQueueView rows={[row(), second]} lookOn />);
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Approve' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(answerSwap.mock.calls).toEqual([[{ jobId: 'job-1', verdict: 'approved' }]]);
    expect(await screen.findByText('Approved: the job of demo@viralclone.app takes its place in the line.')).toHaveAttribute('role', 'status');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reject asks first and says what it does; keeping the job waiting sends nothing', async () => {
    renderWithI18n(<SwapQueueView rows={[row()]} lookOn />);
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject these photos?' });
    expect(within(dialog).getByText(/All its credits go back, the photos are deleted now and the customer gets an email\./)).toBeInTheDocument();
    expect(within(dialog).getByText('demo@viralclone.app · Morning routine')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(answerSwap).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a confirmed reject is sent once for that job, said, and the line is read again', async () => {
    renderWithI18n(<SwapQueueView rows={[row(), second]} lookOn />);
    await userEvent.click(within(item('new@')).getByRole('button', { name: 'Reject' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject' }));
    expect(answerSwap.mock.calls).toEqual([[{ jobId: 'job-2', verdict: 'rejected' }]]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Rejected: the credits of new@viralclone.app are back and the photos are deleted.')).toHaveAttribute('role', 'status');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an answer that came second is told so, as the data layer said it: nothing is claimed, and the job cannot be answered again', async () => {
    answerSwap.mockResolvedValue({ status: 'already', at: '2026-10-07T09:30:00.000Z' });
    renderWithI18n(<SwapQueueView rows={[row(), second]} lookOn />);
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Approve' }));
    expect(await within(item('demo@')).findByText(`This job already had its answer on ${formatDate('2026-10-07T09:30:00.000Z', 'en')}. Nothing was changed.`)).toBeInTheDocument();
    expect(screen.queryByText(/^Approved:/)).toBeNull();
    expect(within(item('demo@')).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(item('demo@')).queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(within(item('new@')).getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Update the list' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an answer that did not go through says nothing changed and can be given again', async () => {
    answerSwap.mockResolvedValueOnce({ status: 'failed' });
    renderWithI18n(<SwapQueueView rows={[row()]} lookOn />);
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Approve' }));
    expect(await within(item('demo@')).findByRole('alert')).toHaveTextContent('The answer did not go through. Nothing was changed.');
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Approve' }));
    expect(answerSwap).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/^Approved:/)).toHaveAttribute('role', 'status');
    expect(within(item('demo@')).queryByRole('alert')).toBeNull();
  });

  it('while one answer is on its way no other can be sent', async () => {
    let settle: (value: unknown) => void = () => {};
    answerSwap.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
    renderWithI18n(<SwapQueueView rows={[row(), second]} lookOn />);
    await userEvent.click(within(item('demo@')).getByRole('button', { name: 'Approve' }));
    for (const button of screen.getAllByRole('button', { name: /Approve|Reject/ })) expect(button).toBeDisabled();
    settle(DONE);
    expect(await screen.findByText(/^Approved:/)).toHaveAttribute('role', 'status');
    expect(answerSwap).toHaveBeenCalledTimes(1);
  });
});
