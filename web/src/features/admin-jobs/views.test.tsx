import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const retryJob = vi.fn();
const returnCredits = vi.fn();
const settleUnknown = vi.fn();
vi.mock('./actions', () => ({
  retryJob: (...a: unknown[]) => retryJob(...a),
  returnCredits: (...a: unknown[]) => returnCredits(...a),
  settleUnknown: (...a: unknown[]) => settleUnknown(...a),
}));

import type { JobRow, JobsData } from './load';
import { JobsView } from './JobsView';

const steps = (stoppedAt: number | null): JobRow['steps'] =>
  (['adaptation', 'images', 'clips', 'music', 'edit', 'render'] as const).map((key, i) => ({
    key, total: 1, done: stoppedAt === i ? 0 : 1,
    status: stoppedAt === null ? 'done' : i < stoppedAt ? 'done' : i === stoppedAt ? 'stopped' : 'waiting',
  }));
const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: 'job-1', userId: 'usr-demo', email: 'demo@viralclone.app', templateTitle: 'Dupe comparison', startedAt: '2026-10-02T10:00:00Z', finishedAt: null,
  format: 'no-talking', quality: 'best', language: 'en', credits: 12, cost: null, status: 'done', stoppedReason: null, stoppedDetail: null, steps: steps(null),
  creditsReturned: 0, queuePosition: null, engineQueue: null, balance: 7, ...over,
});
const stopped = (over: Partial<JobRow> = {}) => row({ id: 'job-stop', status: 'stopped', stoppedReason: 'clips-failed', steps: steps(2), ...over });
const props = (rows: JobRow[], over: Partial<JobsData> = {}): JobsData => ({
  rows, total: rows.length, selected: null, status: 'all', q: '', period: '30d',
  tiles: { running: 1, done: 4, stopped: 2, averageSeconds: 95, cost: null }, ...over,
});

afterEach(cleanup);
beforeEach(() => {
  retryJob.mockReset();
  returnCredits.mockReset();
  settleUnknown.mockReset();
  settleUnknown.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: null });
  retryJob.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: null });
  returnCredits.mockResolvedValue({ status: 'done', at: '2026-10-05T10:00:00Z', detail: { credits: 12, balanceAfter: 19 } });
});

describe('JobsView table', () => {
  it('shows the numbers, the cost as the board placeholder and the user as a link to their page', () => {
    renderWithI18n(<JobsView {...props([row()])} />);
    const table = screen.getByRole('table', { name: 'Jobs' });
    const line = within(table).getByRole('row', { name: /Dupe comparison/ });
    expect(within(line).getByText('—')).toBeInTheDocument();
    expect(within(line).getByText('No talking · Best · English')).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: 'demo@viralclone.app' })).toHaveAttribute('href', '/admin/users/usr-demo');
    expect(within(line).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/jobs?job=job-1#job-detail');
    expect(screen.getByText('2 min')).toBeInTheDocument();
  });

  it('format, quality and language share one Video column instead of three', () => {
    renderWithI18n(<JobsView {...props([row()])} />);
    const table = screen.getByRole('table', { name: 'Jobs' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Video');
    expect(headers).not.toContain('Format');
    expect(headers).not.toContain('Quality');
    expect(headers).not.toContain('Language');
    expect(within(within(table).getByRole('row', { name: /Dupe comparison/ })).getByText('No talking · Best · English')).toBeInTheDocument();
  });

  it('a stopped job shows the translated reason, Open and Retry job with the note that the customer is not charged; Refund credits is gone from the row', () => {
    renderWithI18n(<JobsView {...props([stopped({ creditsReturned: 12 })])} />);
    const line = within(screen.getByRole('table', { name: 'Jobs' })).getByRole('row', { name: /Dupe comparison/ });
    expect(within(line).getByText('Stopped')).toBeInTheDocument();
    expect(within(line).getByText('Some clips could not be made')).toBeInTheDocument();
    expect(within(line).getByRole('button', { name: 'Retry job' })).toBeInTheDocument();
    expect(within(line).getByText('The customer is not charged.')).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(within(line).queryByRole('button', { name: 'Refund credits' })).toBeNull();
    expect(within(line).queryByRole('button', { name: 'Return credits' })).toBeNull();
  });

  it('a column shows the credits returned on a stopped or closed job; an In queue row shows its position; Closed is a status', () => {
    renderWithI18n(<JobsView {...props([stopped({ creditsReturned: 12 }), row({ id: 'q', templateTitle: 'Queued one', status: 'queued', queuePosition: 2 }), row({ id: 'c', templateTitle: 'Closed one', status: 'closed', creditsReturned: 5 })])} />);
    const table = screen.getByRole('table', { name: 'Jobs' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Credits returned');
    const queued = within(table).getByRole('row', { name: /Queued one/ });
    expect(within(queued).getByText('In queue')).toBeInTheDocument();
    expect(within(queued).getByText('Position 2')).toBeInTheDocument();
    expect(within(within(table).getByRole('row', { name: /Closed one/ })).getByText('Closed')).toBeInTheDocument();
  });

  it('a job behind the engine is In queue with the videos in front and the minutes, in the same words as the site queue', () => {
    renderWithI18n(<JobsView {...props([
      row({ id: 'w2', templateTitle: 'Waits two', status: 'queued', engineQueue: { ahead: 2, waitMinutes: 14 } }),
      row({ id: 'w0', templateTitle: 'Waits none', status: 'queued', engineQueue: { ahead: 0, waitMinutes: 0 } }),
    ])} />);
    const table = screen.getByRole('table', { name: 'Jobs' });
    const two = within(table).getByRole('row', { name: /Waits two/ });
    expect(within(two).getByText('In queue')).toBeInTheDocument();
    expect(within(two).getByText('2 videos ahead · starts in about 14 min')).toBeInTheDocument();
    expect(within(two).queryByText('Running')).toBeNull();
    expect(within(within(table).getByRole('row', { name: /Waits none/ })).getByText('Starting shortly')).toBeInTheDocument();
  });

  it('an unknown reason code falls back to a generic line', () => {
    renderWithI18n(<JobsView {...props([stopped({ stoppedReason: 'weird' as never })])} />);
    expect(screen.getAllByText('The job stopped').length).toBeGreaterThan(0);
  });

  it('a job stopped by the content rule says so in the table cell and the detail panel, not the generic line', () => {
    const job = stopped({ stoppedReason: 'content-rule' });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    const line = within(screen.getByRole('table', { name: 'Jobs' })).getByRole('row', { name: /Dupe comparison/ });
    expect(within(line).getByText('Broke a content rule')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Stopped job' })).getByText(/break our content rules/)).toBeInTheDocument();
    expect(screen.queryByText('The job stopped')).toBeNull();
  });

  it('a job stopped by the content rule has no Retry job, in the table or the detail panel: the server refuses it, and its note about the retry is gone too', () => {
    const job = stopped({ stoppedReason: 'content-rule' });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    expect(screen.queryByRole('button', { name: 'Retry job' })).toBeNull();
    expect(screen.queryByText('The customer is not charged.')).toBeNull();
    expect(screen.queryByText(/A retry runs only the missing part/)).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Open' }).length).toBeGreaterThan(0);
  });

  it('a stopped job of any other reason keeps Retry job in the table and in the detail panel', () => {
    const job = stopped({ stoppedReason: 'submission-unknown' });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    expect(screen.getAllByRole('button', { name: 'Retry job' })).toHaveLength(2);
  });

  it('in Turkish the content rule has its own reason and the video language reads İngilizce, not English', () => {
    const job = stopped({ stoppedReason: 'content-rule', language: 'en' });
    renderWithI18n(<JobsView {...props([job])} />, 'tr');
    const line = within(screen.getByRole('table')).getByRole('row', { name: /Dupe comparison/ });
    expect(within(line).getByText('İçerik kuralını aştı')).toBeInTheDocument();
    expect(within(line).getByText(/İngilizce/)).toBeInTheDocument();
    expect(within(line).queryByText(/English/)).toBeNull();
    expect(screen.queryByText('İş durdu')).toBeNull();
  });

  it('a stopped job names the stop detail in a short label in the table cell: out of credits at the provider', () => {
    renderWithI18n(<JobsView {...props([stopped({ stoppedReason: 'engine-error', stoppedDetail: 'provider-credits' })])} />);
    const line = within(screen.getByRole('table', { name: 'Jobs' })).getByRole('row', { name: /Dupe comparison/ });
    expect(within(line).getByText('Provider out of credits')).toBeInTheDocument();
    expect(within(line).queryByText(/Top up the provider account/)).toBeNull();
    expect(screen.queryByText('The job stopped')).toBeNull();
  });

  it('the detail panel keeps the full text of the stop detail', () => {
    const job = stopped({ stoppedReason: 'engine-error', stoppedDetail: 'provider-credits' });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    const panel = screen.getByRole('region', { name: 'Stopped job' });
    expect(within(panel).getByText(/The video provider has no credits left\. Top up the provider account/)).toBeInTheDocument();
  });

  it.each([
    ['en', /key.*spending limit/i],
    ['tr', /anahtar.*harcama sınır/i],
  ] as const)('provider-setup names both causes and both cap variables (%s)', (locale, cause) => {
    const job = stopped({ stoppedReason: 'engine-error', stoppedDetail: 'provider-setup' });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />, locale);
    const panel = screen.getByRole('region', { name: locale === 'en' ? 'Stopped job' : 'Duran iş' });
    expect(panel).toHaveTextContent(cause);
    expect(panel).toHaveTextContent('VC_PROVIDER_DAILY_CAP');
    expect(panel).toHaveTextContent('VC_PROVIDER_JOB_CAP');
    const short = within(screen.getByRole('table')).getByRole('row', { name: /Dupe comparison/ });
    expect(short).toHaveTextContent(locale === 'en' ? /Provider key or spending limit/ : /Sağlayıcı anahtarı ya da harcama sınırı/);
  });

  it('a detail with no text of its own falls back to the reason text', () => {
    renderWithI18n(<JobsView {...props([stopped({ stoppedReason: 'clips-failed', stoppedDetail: 'fill-invalid' })])} />);
    expect(screen.getAllByText('Some clips could not be made').length).toBeGreaterThan(0);
  });

  it('a running job names its current step; the free video is not a credit count', () => {
    const running = row({ id: 'job-run', status: 'running', credits: 0, steps: [
      { key: 'adaptation', status: 'done', done: 1, total: 1 }, { key: 'images', status: 'done', done: 3, total: 3 }, { key: 'clips', status: 'running', done: 1, total: 3 },
      { key: 'music', status: 'waiting', done: 0, total: 1 }, { key: 'edit', status: 'waiting', done: 0, total: 1 }, { key: 'render', status: 'waiting', done: 0, total: 1 } ] });
    renderWithI18n(<JobsView {...props([running])} />);
    expect(screen.getByText('Step 3 of 6 · Clips')).toBeInTheDocument();
    expect(screen.getByText('Free video')).toBeInTheDocument();
  });

  it('status and period filters are links that keep the search; the current one is marked', () => {
    renderWithI18n(<JobsView {...props([row()], { status: 'stopped', q: 'ann', period: '7d' })} />);
    const status = screen.getByRole('group', { name: 'Status' });
    expect(within(status).getByRole('link', { name: 'Stopped' })).toHaveAttribute('aria-current', 'page');
    expect(within(status).getAllByRole('link').map((l) => l.textContent)).toEqual(['All', 'In queue', 'Running', 'Stopped', 'Closed', 'Done']);
    expect(within(status).getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/admin/jobs?status=done&period=7d&q=ann');
    expect(within(status).getByRole('link', { name: 'In queue' })).toHaveAttribute('href', '/admin/jobs?status=queued&period=7d&q=ann');
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    expect(within(period).getByRole('link', { name: '30 days' })).toHaveAttribute('href', '/admin/jobs?status=stopped&q=ann');
  });

  it('shows the empty state with a way back when nothing matches', () => {
    renderWithI18n(<JobsView {...props([], { total: 5, q: 'zzz' })} />);
    expect(screen.getByText('No jobs match your search or filter.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear search and filter' })).toHaveAttribute('href', '/admin/jobs');
  });
});

describe('actions', () => {
  it('Retry job asks first with the job and what is missing: nothing is sent until the dialog is confirmed with a reason', async () => {
    renderWithI18n(<JobsView {...props([stopped({ steps: steps(2).map((s) => (s.key === 'clips' ? { ...s, done: 3, total: 5 } : s)) })])} />);
    const line = within(screen.getByRole('table', { name: 'Jobs' })).getByRole('row', { name: /Dupe comparison/ });
    await userEvent.click(within(line).getByRole('button', { name: 'Retry job' }));
    const dialog = screen.getByRole('dialog', { name: 'Retry this job?' });
    expect(within(dialog).getByText('Job').nextSibling).toHaveTextContent('Dupe comparison');
    expect(within(dialog).getByText('Missing').nextSibling).toHaveTextContent('2 clips');
    expect(within(dialog).getByText('The customer is not charged.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Balance after')).toBeNull(); // no cost line: nothing is charged
    expect(retryJob).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry job' }));
    expect(retryJob).not.toHaveBeenCalled(); // reason missing
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Provider was down');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry job' }));
    await waitFor(() => expect(retryJob).toHaveBeenCalledTimes(1));
    expect(retryJob).toHaveBeenCalledWith({ jobId: 'job-stop', reason: 'Provider was down' });
    expect(await screen.findByText('The job runs again from the stopped step.')).toBeInTheDocument();
  });

  it('Cancel and Escape send nothing', async () => {
    renderWithI18n(<JobsView {...props([stopped()])} />);
    const line = within(screen.getByRole('table', { name: 'Jobs' })).getByRole('row', { name: /Dupe comparison/ });
    await userEvent.click(within(line).getByRole('button', { name: 'Retry job' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(line).getByRole('button', { name: 'Retry job' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(retryJob).not.toHaveBeenCalled();
  });

  it('while it works the two buttons are off and Escape does not close the dialog', async () => {
    let finish: (value: unknown) => void = () => undefined;
    retryJob.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithI18n(<JobsView {...props([stopped()])} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry job' })[0]!);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry job' }));
    expect(await within(dialog).findByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => finish({ status: 'done', at: '2026-10-05T10:00:00Z', detail: null }));
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('Return credits (detail of a finished job that got none back) shows charged / to return / balance after, asks for a reason and sends once', async () => {
    const job = row({ id: 'job-done', creditsReturned: 0 });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    const detail = screen.getByRole('region', { name: 'Job' });
    await userEvent.click(within(detail).getByRole('button', { name: 'Return credits' }));
    const dialog = screen.getByRole('dialog', { name: 'Return credits?' });
    expect(within(dialog).getByText('Credits charged').nextSibling).toHaveTextContent('12');
    expect(within(dialog).getByText('Credits to return').nextSibling).toHaveTextContent('12');
    expect(within(dialog).getByText('Balance after').nextSibling).toHaveTextContent('19');
    expect(within(dialog).getByText('The credits are returned to the balance. No money is refunded.')).toBeInTheDocument();
    expect(returnCredits).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Unusable video');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Return credits' }));
    await waitFor(() => expect(returnCredits).toHaveBeenCalledTimes(1));
    expect(returnCredits.mock.calls[0]![0]).toMatchObject({ jobId: 'job-done', reason: 'Unusable video' });
    const done = await screen.findByRole('dialog', { name: 'Done' });
    expect(within(done).getByText('Credits returned').nextSibling).toHaveTextContent('12');
  });

  it('no Return credits once the credits are all back', () => {
    const job = stopped({ creditsReturned: 12 });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    expect(screen.queryByRole('button', { name: 'Return credits' })).toBeNull();
  });
});

describe('detail card', () => {
  it('stopped job: each step shows its own status, the reason, the saved parts, the credits and one lime primary', () => {
    const job = stopped({ steps: steps(2).map((s) => (s.key === 'clips' ? { ...s, done: 2, total: 5 } : s)) });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    const detail = screen.getByRole('region', { name: 'Stopped job' });
    const list = within(detail).getByRole('list', { name: 'Steps' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[2]).toHaveTextContent('Clips');
    expect(items[2]).toHaveTextContent('Stopped here');
    expect(items[0]).toHaveTextContent('Done');
    expect(items[4]).toHaveTextContent('Waiting');
    expect(detail).toHaveTextContent('Step 3 of 6 · Clips');
    expect(detail).toHaveTextContent('Some clips could not be made');
    expect(detail).toHaveTextContent('Adaptation, images, 2 of 5 clips');
    expect(detail).toHaveTextContent('12');
    expect(detail).toHaveTextContent('Credits returned');
    expect(within(detail).getByRole('button', { name: 'Retry job' }).className).toContain('bg-accent');
    expect(within(detail).getByRole('button', { name: 'Return credits' }).className).not.toContain('bg-accent');
    expect(detail).toHaveTextContent('The customer is not charged. The finished parts stay saved. A retry runs only the missing part.');
    expect(within(detail).getByRole('link', { name: 'Open user' })).toHaveAttribute('href', '/admin/users/usr-demo');
  });

  it('a step is not marked done just because it comes before the stopped one: its own status counts', () => {
    const odd = row({ steps: steps(null).map((s) => (s.key === 'images' ? { ...s, status: 'waiting' as const } : s)) });
    renderWithI18n(<JobsView {...props([odd], { selected: odd })} />);
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('Waiting');
    expect(items[0]).toHaveTextContent('Done');
  });

  it('the detail of a job that waits in line says it waits (with the videos in front when the engine tells them), never Finished; a finished job still says Finished', () => {
    const waiting = (over: Partial<JobRow>) => row({ id: 'job-wait', status: 'queued', steps: steps(null).map((s) => ({ ...s, status: 'waiting' as const, done: 0 })), ...over });
    const detailOf = (job: JobRow) => {
      renderWithI18n(<JobsView {...props([job], { selected: job })} />);
      return screen.getByRole('region', { name: 'Job' });
    };
    const ahead = detailOf(waiting({ engineQueue: { ahead: 2, waitMinutes: 14 } }));
    expect(ahead).toHaveTextContent('Current step2 videos ahead · starts in about 14 min');
    expect(ahead).not.toHaveTextContent('Finished');
    cleanup();
    const place = detailOf(waiting({ queuePosition: 2 }));
    expect(place).toHaveTextContent('Current stepPosition 2');
    expect(place).not.toHaveTextContent('Finished');
    cleanup();
    const bare = detailOf(waiting({}));
    expect(bare).toHaveTextContent('Current stepIn queue');
    expect(bare).not.toHaveTextContent('Finished');
    cleanup();
    expect(detailOf(row({ id: 'job-ok' }))).toHaveTextContent('Current stepFinished');
  });

  it('a job that is not stopped has no Retry', () => {
    const job = row({ id: 'job-ok' });
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    const detail = screen.getByRole('region', { name: 'Job' });
    expect(within(detail).queryByRole('button', { name: 'Retry job' })).toBeNull();
  });
});

describe('settle an unknown request (R3)', () => {
  const stuck = () => stopped({ stoppedReason: 'submission-unknown', steps: steps(1) });

  it('the action is only in the detail of a job stopped with submission-unknown: not in the row, not for another stop, not for a job that is not stopped', () => {
    const job = stuck();
    const { unmount } = renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    expect(within(screen.getByRole('region', { name: 'Stopped job' })).getByRole('button', { name: 'Request never reached the provider' })).toBeInTheDocument();
    expect(within(within(screen.getByRole('table', { name: 'Jobs' })).getByRole('row', { name: /Dupe comparison/ })).queryByRole('button', { name: 'Request never reached the provider' })).toBeNull();
    expect(screen.getAllByText(/got no clear answer/).length).toBeGreaterThan(0);
    unmount();
    const other = stopped();
    renderWithI18n(<JobsView {...props([other], { selected: other })} />);
    expect(screen.queryByRole('button', { name: 'Request never reached the provider' })).toBeNull();
    cleanup();
    const ok = row({ id: 'ok', stoppedReason: 'submission-unknown' });
    renderWithI18n(<JobsView {...props([ok], { selected: ok })} />);
    expect(screen.queryByRole('button', { name: 'Request never reached the provider' })).toBeNull();
  });

  it('the confirmation warns that a mistake pays the part twice; nothing is sent until a reason is given and it is confirmed', async () => {
    const job = stuck();
    renderWithI18n(<JobsView {...props([job], { selected: job })} />);
    await userEvent.click(within(screen.getByRole('region', { name: 'Stopped job' })).getByRole('button', { name: 'Request never reached the provider' }));
    const dialog = screen.getByRole('dialog', { name: 'Settle this request?' });
    expect(within(dialog).getByText("Confirm that you do not see this request in the provider's task list. If you are wrong, the same part is paid for twice.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request never reached the provider' }));
    expect(settleUnknown).not.toHaveBeenCalled();                      // reason missing
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Not in the Magnific task list');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request never reached the provider' }));
    await waitFor(() => expect(settleUnknown).toHaveBeenCalledTimes(1));
    expect(settleUnknown).toHaveBeenCalledWith({ jobId: 'job-stop', reason: 'Not in the Magnific task list' });
    expect(await screen.findByText(/Now retry the job/)).toBeInTheDocument();
  });

  it('in Turkish the confirmation is the agreed text', async () => {
    const job = stuck();
    renderWithI18n(<JobsView {...props([job], { selected: job })} />, 'tr');
    await userEvent.click(within(screen.getByRole('region', { name: 'Duran iş' })).getByRole('button', { name: 'İstek sağlayıcıya ulaşmadı' }));
    expect(screen.getByText('Sağlayıcının görev listesinde bu isteği görmediğinizi doğrulayın; yanlışsa aynı parça iki kez ödenir.')).toBeInTheDocument();
  });
});

describe('the way to the photo review', () => {
  it.each([[0], [3]])('is a link on the jobs page that says how many jobs wait (%i)', (waiting) => {
    renderWithI18n(<JobsView {...props([row()])} reviewWaiting={waiting} />);
    expect(screen.getByRole('link', { name: `Photo review (${waiting})` })).toHaveAttribute('href', '/admin/jobs/review');
  });
});
