import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/core/i18n/messages';
import type { Job, JobStep, ResumeQuote, StopReason } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const resumeJob = vi.fn();
const closeJob = vi.fn();
vi.mock('./actions', () => ({ resumeJob: (...a: unknown[]) => resumeJob(...a), closeJob: (...a: unknown[]) => closeJob(...a) }));

import { StoppedView } from './StoppedView';

// Every code of the union, checked by the compiler: a new `StopReason` without an entry here does not typecheck.
const STOP_REASONS = Object.keys({
  'adaptation-failed': 1, 'images-failed': 1, 'clips-failed': 1, 'audio-failed': 1, 'render-failed': 1,
  'submission-unknown': 1, 'estimate-exceeded': 1, 'llm-invalid': 1, 'template-missing': 1, 'engine-error': 1, 'content-rule': 1,
} satisfies Record<StopReason, 1>) as StopReason[];

const step = (key: JobStep['key'], status: JobStep['status'], done: number, total: number): JobStep => ({ key, status, done, total });
const job: Job = {
  id: 'job-1', userId: 'u', templateId: 'tpl-layering', templateTitle: 'Fragrance layering recipe',
  input: { templateId: 'tpl-layering', quality: 'fast', variants: 1, language: 'en', products: [{ name: 'Oil', description: '', images: [] }] },
  credits: 2, status: 'stopped', stoppedReason: 'render-failed', startedAt: '2026-10-04T12:00:00Z', finishedAt: null, variants: [],
  freeVideo: false, creditsReturned: 2, queuePosition: null, delayed: false, paused: false, stoppedAt: '2026-10-04T12:10:00Z',
  continueUntil: '2026-11-03T12:10:00Z', closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: '2026-11-03T12:10:00Z',
  videoStored: false, imagesStored: true, deletedAt: null,
  steps: [step('adaptation', 'done', 1, 1), step('images', 'done', 5, 5), step('clips', 'done', 5, 5), step('music', 'done', 1, 1), step('edit', 'done', 1, 1), step('render', 'stopped', 0, 1)],
};
const clipsStopped: Job = {
  ...job, stoppedReason: 'clips-failed',
  steps: [step('adaptation', 'done', 1, 1), step('images', 'done', 5, 5), step('clips', 'stopped', 3, 5), step('music', 'done', 1, 1), step('edit', 'waiting', 0, 1), step('render', 'waiting', 0, 1)],
};
const quote = (over: Partial<ResumeQuote> = {}): ResumeQuote => ({
  resumable: true, cost: 2, charged: 2, returned: 2, free: false, coveredByFreeVideo: false, freeUsedElsewhere: false, balance: 12, enough: true,
  missing: { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 }, continueUntil: '2026-11-03T12:10:00Z', ...over,
});
const free = (over: Partial<ResumeQuote> = {}) => quote({ cost: 0, charged: 0, returned: 0, free: true, coveredByFreeVideo: true, ...over });

beforeEach(() => {
  resumeJob.mockReset();
  closeJob.mockReset();
});
afterEach(cleanup);

const dialog = (name: string) => screen.getByRole('dialog', { name });
const rowOf = (scope: HTMLElement, label: string) => within(scope).getByText(label, { exact: true }).parentElement!;

describe('stop reasons', () => {
  it.each(['en', 'tr'] as const)('every StopReason code renders a title of its own in %s, never the generic one', (locale) => {
    const messages = loadMessages(locale);
    const generic = messages['jobs.reason.generic.title'];
    for (const code of STOP_REASONS) {
      // clips-failed counts the missing clips: this job misses none, so it reads "one clip".
      const expected = messages[code === 'clips-failed' ? `jobs.reason.${code}.title.n1` : `jobs.reason.${code}.title`];
      expect(expected, `${locale}: ${code}`).toBeTruthy();
      renderWithI18n(<StoppedView job={{ ...job, stoppedReason: code }} quote={quote()} />, locale);
      const title = screen.getByRole('heading', { level: 2 }).textContent;
      expect(title, `${locale}: ${code}`).toBe(expected);
      expect(title, `${locale}: ${code}`).not.toBe(generic);
      cleanup();
    }
  });

  it('a code other than clips-failed has the generic body; an unknown code gets the generic title', () => {
    renderWithI18n(<StoppedView job={job} quote={quote()} />);
    expect(screen.getByText(/What was finished is saved/)).toBeInTheDocument();
    cleanup();
    renderWithI18n(<StoppedView job={{ ...job, stoppedReason: 'weird' as never }} quote={quote()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'The job stopped' })).toBeInTheDocument();
  });

  it.each(['provider-credits', 'provider-cap', 'provider-setup'] as const)('%s: the body says it is on our side and temporary, in both languages', (detail) => {
    renderWithI18n(<StoppedView job={{ ...job, stoppedReason: 'engine-error', stoppedDetail: detail }} quote={quote()} />);
    expect(screen.getByText(/We cannot generate right now\. Your finished parts are saved\. Try again later; you are not charged until you do\./)).toBeInTheDocument();
    expect(screen.queryByText(/What was finished is saved/)).toBeNull();
    cleanup();
    renderWithI18n(<StoppedView job={{ ...job, stoppedReason: 'engine-error', stoppedDetail: detail }} quote={quote()} />, 'tr');
    expect(screen.getByText(/Şu anda üretim yapamıyoruz\. Biten parçalar kaydedildi\./)).toBeInTheDocument();
  });

  it('another detail (or none) keeps the generic body', () => {
    renderWithI18n(<StoppedView job={{ ...job, stoppedReason: 'engine-error', stoppedDetail: 'upload-failed' }} quote={quote()} />);
    expect(screen.getByText(/What was finished is saved/)).toBeInTheDocument();
  });

  it.each(STOP_REASONS)('%s: which buttons the page shows (content-rule and submission-unknown have no way to continue, ever)', (code) => {
    // The data layer says "not resumable" for a content-rule stop and for a request we are checking ourselves; the page must not
    // depend on it: a quote that says `resumable` for such a code still shows no option.
    const noWay = code === 'content-rule' || code === 'submission-unknown';
    for (const q of [noWay ? quote({ resumable: false }) : quote(), quote({ resumable: true })]) {
      renderWithI18n(<StoppedView job={{ ...job, stoppedReason: code }} quote={q} />);
      if (noWay) {
        expect(screen.queryByRole('button', { name: /Continue with the backup model/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Stop the job here/ })).toBeNull();
        expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact?topic=video&job=job-1');
        if (code === 'content-rule') expect(screen.getByText(/Your 2 credits are back in your balance\. This job cannot be continued\./)).toBeInTheDocument();
        expect(screen.queryByText(/You can continue until/)).toBeNull();
      } else {
        expect(screen.getByRole('button', { name: /Continue with the backup model/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: /Try again/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: /Stop the job here/ })).toBeEnabled();
        expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull();
      }
      cleanup();
    }
  });

  it('Contact support carries the job', () => {
    renderWithI18n(<StoppedView job={{ ...clipsStopped, stoppedReason: 'content-rule' }} quote={quote({ resumable: false })} />);
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact?topic=video&job=job-1');
  });

  it('submission-unknown shows no retry or backup button, and says we are checking', () => {
    const stuck: Job = { ...clipsStopped, stoppedReason: 'submission-unknown' };
    const checking = 'We are checking this request with the video service ourselves. You do not need to do anything, and nothing more is charged. We will continue the job or write to you.';
    renderWithI18n(<StoppedView job={stuck} quote={quote({ resumable: false, cost: 0 })} />);
    const section = screen.getByRole('region', { name: 'What happened and your options' });
    expect(within(section).getByRole('heading', { level: 2, name: 'A request to the video service got no clear answer' })).toBeInTheDocument();
    expect(within(section).getByText(`The 2 credits for this video are back in your balance. ${checking}`)).toBeInTheDocument();
    expect(within(section).queryAllByRole('button')).toEqual([]);
    expect(within(section).getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact?topic=video&job=job-1');
    expect(section).not.toHaveTextContent('What was finished is saved');   // "saved, continue" is the wrong promise while we are checking
    expect(section).not.toHaveTextContent('You can continue until');
    expect(within(section).queryByText('To continue')).toBeNull();
    cleanup();

    // A free job, as the data layer quotes one that cannot be continued: no credits came back, so the sentence stands alone.
    renderWithI18n(<StoppedView job={{ ...stuck, freeVideo: true, credits: 0, creditsReturned: 0 }} quote={free({ resumable: false, coveredByFreeVideo: false })} />);
    expect(screen.getByText(checking)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toEqual([]);
    cleanup();

    renderWithI18n(<StoppedView job={stuck} quote={quote({ resumable: false, cost: 0 })} />, 'tr');
    const bolum = screen.getByRole('region');
    expect(bolum).toHaveTextContent('Bu videonun 2 kredisi bakiyene geri döndü. Bu isteği video servisiyle biz kontrol ediyoruz. Bir şey yapmana gerek yok, başka kredi kesilmez. İşi biz sürdüreceğiz ya da sana yazacağız.');
    expect(within(bolum).queryAllByRole('button')).toEqual([]);
  });
});

describe('StoppedView', () => {
  it('says what came back and what is saved, the three credit rows, the last day, and the line under each option', () => {
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Two clips are missing' })).toBeInTheDocument();
    expect(screen.getByText('The 2 credits for this video are back in your balance. The 5 finished images, 3 clips and the music are saved.')).toBeInTheDocument();
    expect(screen.getByText('You can continue until Nov 3, 2026.')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'What happened and your options' });
    expect(rowOf(section, 'Charged when you confirmed')).toHaveTextContent('2 credits');
    expect(rowOf(section, 'Returned when it stopped')).toHaveTextContent('2 credits');
    expect(rowOf(section, 'To continue')).toHaveTextContent('2 credits');
    expect(screen.getByRole('button', { name: /Continue with the backup model/ })).toHaveTextContent('Same price. The look may differ slightly.');
    expect(screen.getByRole('button', { name: /Try again/ })).toHaveTextContent('Same price. The same model generates the 2 missing clips again.');
    expect(screen.getByRole('button', { name: /Stop the job here/ })).toHaveTextContent('Nothing more is charged. The 2 credits stay in your balance and the saved parts are deleted.');
    expect(screen.getByText('stopped · 3 / 5')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(section.textContent).not.toContain('credit difference');
  });

  it('a free job: "Your free video is back" instead of credit rows', () => {
    renderWithI18n(<StoppedView job={{ ...clipsStopped, freeVideo: true, creditsReturned: 0, credits: 0 }} quote={free()} />);
    expect(screen.getByText('Your free video is back. The finished parts are saved.')).toBeInTheDocument();
    expect(screen.getByText('You can continue until Nov 3, 2026.')).toBeInTheDocument();
    expect(screen.queryByText('Charged when you confirmed')).toBeNull();
    expect(screen.getByRole('button', { name: /Stop the job here/ })).toHaveTextContent('Nothing more is charged. The saved parts are deleted.');
    expect(screen.queryByText(/2 credits/)).toBeNull();
  });

  it('falls back to a generic text for a reason it does not know', () => {
    renderWithI18n(<StoppedView job={{ ...job, stoppedReason: 'weird' as never }} quote={quote()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'The job stopped' })).toBeInTheDocument();
  });

  it('neither option charges on the click: each opens the confirmation with its own title and sentence, the rows, and the balance after', async () => {
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Continue with the backup model/ }));
    const d = dialog('Continue with the backup model');
    expect(d).toHaveTextContent('Same price. The look may differ slightly.');
    expect(rowOf(d, 'Missing')).toHaveTextContent('2 clips');
    expect(rowOf(d, 'Credits returned when it stopped')).toHaveTextContent('2 credits');
    expect(rowOf(d, 'Continuing costs')).toHaveTextContent('2 credits');
    expect(rowOf(d, 'Balance after')).toHaveTextContent('10 credits');
    expect(d).toHaveTextContent('You never pay more than the price you first confirmed.');
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    const again = dialog('Try again');
    expect(again).toHaveTextContent('The same model generates the 2 missing clips again.');
    expect(rowOf(again, 'Continuing costs')).toHaveTextContent('2 credits');
    expect(resumeJob).not.toHaveBeenCalled();
    expect(closeJob).not.toHaveBeenCalled();
  });

  it('Confirm sends the cost the dialog shows, once', async () => {
    resumeJob.mockResolvedValue({ status: 'ok' });
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await userEvent.click(within(dialog('Try again')).getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(resumeJob).toHaveBeenCalledWith('job-1', 2));
    expect(resumeJob).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the cost changed: the dialog says so, shows the new cost and balance after, and the next Confirm sends the new cost', async () => {
    resumeJob.mockResolvedValueOnce({ status: 'price-changed', cost: 5, balance: 17 }).mockResolvedValueOnce({ status: 'ok' });
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Continue with the backup model/ }));
    const d = dialog('Continue with the backup model');
    await userEvent.click(within(d).getByRole('button', { name: 'Confirm and continue' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('The cost changed while this window was open. Nothing was spent.');
    expect(rowOf(d, 'Continuing costs')).toHaveTextContent('5 credits');
    expect(rowOf(d, 'Balance after')).toHaveTextContent('12 credits');
    await userEvent.click(within(d).getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(resumeJob).toHaveBeenLastCalledWith('job-1', 5));
  });

  it('free video still there: 0 credits, no balance row, and the note that it uses the free video', async () => {
    resumeJob.mockResolvedValue({ status: 'ok' });
    renderWithI18n(<StoppedView job={{ ...clipsStopped, freeVideo: true, creditsReturned: 0 }} quote={free()} />);
    await userEvent.click(screen.getByRole('button', { name: /Continue with the backup model/ }));
    const d = dialog('Continue with the backup model');
    expect(rowOf(d, 'Returned when it stopped')).toHaveTextContent('Your free video');
    expect(rowOf(d, 'Continuing costs')).toHaveTextContent('Free video · 0 credits');
    expect(within(d).queryByText('Balance after')).toBeNull();
    expect(d).toHaveTextContent('This uses your one free video.');
    await userEvent.click(within(d).getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(resumeJob).toHaveBeenCalledWith('job-1', 0));
  });

  it('free video used on another job: the warning with the price, then the paid rows', async () => {
    renderWithI18n(<StoppedView job={{ ...clipsStopped, freeVideo: true, creditsReturned: 0 }} quote={quote({ free: true, returned: 0, charged: 0, freeUsedElsewhere: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    const d = dialog('Try again');
    expect(within(d).getByRole('alert')).toHaveTextContent('Your free video was used on another job. Continuing this one costs 2 credits.');
    expect(rowOf(d, 'Continuing costs')).toHaveTextContent('2 credits');
    expect(rowOf(d, 'Balance after')).toHaveTextContent('10 credits');
    expect(within(d).getByRole('button', { name: 'Confirm and continue' })).toBeEnabled();
  });

  it('not enough credits: the sentence with both numbers, Buy credits back to this job, Cancel, the last day, no Confirm', async () => {
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote({ cost: 9, balance: 6, enough: false })} />);
    await userEvent.click(screen.getByRole('button', { name: /Continue with the backup model/ }));
    const d = dialog('Continue with the backup model');
    expect(within(d).getByRole('alert')).toHaveTextContent('You need 9 credits to continue and have 6 credits.');
    expect(within(d).queryByRole('button', { name: 'Confirm and continue' })).toBeNull();
    expect(within(d).getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing?returnTo=%2Fjobs%2Fjob-1');
    expect(within(d).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(d).toHaveTextContent('The saved parts wait for you until Nov 3, 2026.');
    expect(resumeJob).not.toHaveBeenCalled();
  });

  it('the balance dropped before Confirm reached the server: the dialog turns into the not-enough one', async () => {
    resumeJob.mockResolvedValue({ status: 'insufficient', cost: 2, balance: 1 });
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    const d = dialog('Try again');
    await userEvent.click(within(d).getByRole('button', { name: 'Confirm and continue' }));
    expect(await within(d).findByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing?returnTo=%2Fjobs%2Fjob-1');
    expect(within(d).getByRole('alert')).toHaveTextContent('You need 2 credits to continue and have 1 credit.');
    expect(within(d).queryByRole('button', { name: 'Confirm and continue' })).toBeNull();
  });

  it('something else went wrong: says that nothing was spent and keeps the dialog', async () => {
    resumeJob.mockResolvedValue({ status: 'error' });
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    const d = dialog('Try again');
    await userEvent.click(within(d).getByRole('button', { name: 'Confirm and continue' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Something went wrong. Nothing was spent. Try again.');
  });
});

describe('Stop the job here', () => {
  it('names what is deleted: images and clips when there are finished ones, the plain warning when there are none, in both languages', async () => {
    const none: Job = { ...job, steps: [step('adaptation', 'done', 1, 1), step('images', 'stopped', 0, 5)] };
    renderWithI18n(<StoppedView job={none} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Stop the job here/ }));
    expect(dialog('Close this job?')).toHaveTextContent('The parts already made for this job are deleted and cannot be brought back. You can start');
    cleanup();
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />, 'tr');
    await userEvent.click(screen.getByRole('button', { name: /İşi burada durdur/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Bu iş için hazırlanan parçalar silinir ve geri getirilemez: 5 hazır görsel, 3 klip.');
  });

  it('asks first: nothing is sent when the window opens or on "Keep it"; "Close the job" sends once', async () => {
    closeJob.mockResolvedValue({ status: 'ok' });
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Stop the job here/ }));
    const d = dialog('Close this job?');
    expect(d).toHaveTextContent('The parts already made for this job are deleted and cannot be brought back: 5 finished images, 3 clips. You can start a new job from the template; you see the price before you confirm.');
    expect(closeJob).not.toHaveBeenCalled();
    await userEvent.click(within(d).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(closeJob).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Stop the job here/ }));
    await userEvent.click(within(dialog('Close this job?')).getByRole('button', { name: 'Close the job' }));
    await waitFor(() => expect(closeJob).toHaveBeenCalledWith('job-1'));
    expect(closeJob).toHaveBeenCalledTimes(1);
  });

  it('the safe choice is the wide bordered one, the dangerous one narrow with the warn border, no lime', async () => {
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Stop the job here/ }));
    const keep = within(dialog('Close this job?')).getByRole('button', { name: 'Keep it' });
    const close = within(dialog('Close this job?')).getByRole('button', { name: 'Close the job' });
    expect(keep.className).toContain('border-edge-strong');
    expect(keep.className).toContain('flex-[2_1_240px]');
    expect(close.className).toContain('border-warn');
    expect(close.className).toContain('flex-[1_1_160px]');
    expect(`${keep.className} ${close.className}`).not.toContain('bg-accent');
  });

  it('a failure keeps the window open and says nothing changed', async () => {
    closeJob.mockResolvedValue({ status: 'error' });
    renderWithI18n(<StoppedView job={clipsStopped} quote={quote()} />);
    await userEvent.click(screen.getByRole('button', { name: /Stop the job here/ }));
    await userEvent.click(within(dialog('Close this job?')).getByRole('button', { name: 'Close the job' }));
    expect(await within(dialog('Close this job?')).findByRole('alert')).toHaveTextContent('Could not close the job. Nothing was changed. Try again.');
  });
});

