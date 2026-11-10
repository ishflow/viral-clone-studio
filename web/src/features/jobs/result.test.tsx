import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobVariant } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), unstable_rethrow: () => undefined }));
const reportProblem = vi.fn();
const deleteJobVideo = vi.fn();
const regenerateVariant = vi.fn();
vi.mock('./result-actions', () => ({
  reportProblem: (...a: unknown[]) => reportProblem(...a),
  deleteJobVideo: (...a: unknown[]) => deleteJobVideo(...a),
  regenerateVariant: (...a: unknown[]) => regenerateVariant(...a),
}));

import { ResultView, type ResultExtras } from './ResultView';

const variant = (n: number, patch: Partial<JobVariant> = {}): JobVariant => ({ id: `job-1-v${n}`, image: `/samples/v${n}.jpg`, video: `/media/jobs/v${n}.mp4`, status: 'done', reason: null, ...patch });
const job = (variants: JobVariant[], patch: Partial<Job> = {}): Job => ({
  id: 'job-1', userId: 'u', templateId: 'tpl-layering', templateTitle: 'Fragrance layering recipe',
  input: { templateId: 'tpl-layering', quality: 'fast', variants: variants.length as 1 | 2 | 3, language: 'en', products: [{ name: 'Oil', description: '', images: ['x'] }] },
  credits: 6, status: 'done', steps: [], stoppedReason: null, startedAt: '2026-10-04T12:00:00Z', finishedAt: '2026-10-04T12:08:00Z', variants,
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null, ...patch,
});
const template = { id: 'tpl-layering', title: 'Fragrance layering recipe', image: '/samples/f.jpg', video: null, seconds: 8 };
const extras = (patch: Partial<ResultExtras> = {}): ResultExtras => ({ reportOpen: true, balance: 12, variantCosts: {}, ...patch });
const show = (j: Job, e: ResultExtras = extras(), t: typeof template & { openable?: boolean } = template) => renderWithI18n(<ResultView job={j} template={t} extras={e} />);

beforeEach(() => {
  refresh.mockReset();
  reportProblem.mockReset();
  deleteJobVideo.mockReset();
  regenerateVariant.mockReset();
});
afterEach(cleanup);

describe('Result: the notes and the exits (boards A-Sonuc, A-Sonuc-Varyant)', () => {
  it('says how long the video is kept and that it can be used in ads', () => {
    show(job([variant(1)]));
    expect(screen.getByText('Kept in My videos for 12 months. You can use this video in your ads.')).toBeInTheDocument();
  });
  it('Report a problem is there while the report window is open, and gone after it', () => {
    const { unmount } = show(job([variant(1)]));
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument();
    unmount();
    show(job([variant(1)]), extras({ reportOpen: false }));
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
  });
  it('the report: four reasons, an optional note, one choice needed; Send report sends the job, the reason, the note and a key; then Reported', async () => {
    reportProblem.mockResolvedValue({ status: 'sent' });
    show(job([variant(1)]));
    await userEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual([
      'The product looks different', 'Text is wrong or cut off', 'The video does not play', 'Something else',
    ]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose what is wrong.');
    expect(reportProblem).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Text is wrong or cut off' }));
    await userEvent.type(within(dialog).getByLabelText('Add a note (optional)'), 'cut at the top');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(reportProblem).toHaveBeenCalledTimes(1));
    expect(reportProblem).toHaveBeenCalledWith('job-1', 'text-wrong', 'cut at the top', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(await screen.findByText('Thanks. We look at it within 2 business days. If the video is wrong, we generate it again at no cost.')).toBeInTheDocument();
  });
  it('a closed report window is said in the dialog', async () => {
    reportProblem.mockResolvedValue({ status: 'closed' });
    show(job([variant(1)]));
    await userEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Something else' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(await within(dialog).findByText('Reports are closed for this video.')).toBeInTheDocument();
  });
  it('Delete video asks first; nothing is deleted before the confirmation', async () => {
    deleteJobVideo.mockResolvedValue({ status: 'error' });
    show(job([variant(1)]));
    await userEvent.click(screen.getByRole('button', { name: 'Delete video' }));
    expect(screen.getByRole('heading', { name: 'Delete this video?' })).toBeInTheDocument();
    expect(deleteJobVideo).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }));
    expect(deleteJobVideo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete video' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete video' }));
    expect(deleteJobVideo).toHaveBeenCalledWith('job-1');
    expect(await screen.findByText('Could not delete the video. Try again.')).toBeInTheDocument();
  });
  it('with several variants the question names them', async () => {
    show(job([variant(1), variant(2), variant(3)]));
    await userEvent.click(screen.getByRole('button', { name: 'Delete video' }));
    expect(screen.getByRole('heading', { name: 'Delete these 3 videos?' })).toBeInTheDocument();
  });
  it('"Generate a new variant" opens the form with this video\'s entries: the link carries the job id, with one variant, with several, and after the video expired', () => {
    const href = '/templates/tpl-layering/generate?from=job-1';
    const { unmount } = show(job([variant(1)]));
    expect(screen.getByRole('link', { name: 'Generate a new variant' })).toHaveAttribute('href', href);
    unmount();
    const many = show(job([variant(1), variant(2)]));
    expect(screen.getByRole('link', { name: 'Generate a new variant' })).toHaveAttribute('href', href);
    many.unmount();
    show(job([variant(1)], { videoStored: false }));
    expect(screen.getByRole('link', { name: 'Generate it again' })).toHaveAttribute('href', href);
  });
  it('is written in Turkish', async () => {
    renderWithI18n(<ResultView job={job([variant(1)])} template={template} extras={extras()} />, 'tr');
    expect(screen.getByText("Videolarım'da 12 ay saklanır. Bu videoyu reklamlarında kullanabilirsin.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sorun bildir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Videoyu sil' })).toBeInTheDocument();
  });
});

describe('Result: some variants ready (board A-Sonuc-Varyant-Kismi)', () => {
  const partial = () => job([variant(1), variant(2), variant(3, { video: null, status: 'stopped', reason: 'clips-failed' })], { creditsReturned: 2 });

  it('says how many are ready, labels each variant, and only the ready ones can be picked', async () => {
    show(partial(), extras({ variantCosts: { 'job-1-v3': 2 } }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2 variants are ready.');
    const group = within(screen.getByRole('group', { name: 'Variants' }));
    expect(group.getByRole('button', { name: 'Variant 1' })).toHaveTextContent('Done');
    expect(group.getByRole('button', { name: 'Variant 3' })).toHaveTextContent('Stopped');
    expect(group.getByRole('button', { name: 'Variant 3' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download both' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Download variant 1' })).toHaveAttribute('href', '/media/jobs/v1.mp4');
  });
  it('the stopped variant says its credits are back and offers to generate only it again, for its price, after a confirmation', async () => {
    regenerateVariant.mockResolvedValue({ status: 'ok' });
    show(partial(), extras({ variantCosts: { 'job-1-v3': 2 } }));
    const box = screen.getByRole('region', { name: 'Variant 3' });
    expect(box).toHaveTextContent('This variant could not be generated. Its 2 credits are back in your balance.');
    await userEvent.click(within(box).getByRole('button', { name: /Generate the missing variant again/ }));
    expect(regenerateVariant).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Generate variant 3 again');
    expect(dialog).toHaveTextContent('Cost2 credits');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm and generate' }));
    await waitFor(() => expect(regenerateVariant).toHaveBeenCalledWith('job-1', 'job-1-v3', 2));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it('the regenerate window shows the balance after', async () => {
    show(partial(), extras({ variantCosts: { 'job-1-v3': 2 }, balance: 12 }));
    await userEvent.click(screen.getByRole('button', { name: /Generate the missing variant again/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Balance after10 credits');
  });
  it('the regenerate window has no balance-after line when the balance is short', async () => {
    show(partial(), extras({ variantCosts: { 'job-1-v3': 2 }, balance: 1 }));
    await userEvent.click(screen.getByRole('button', { name: /Generate the missing variant again/ }));
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Balance after');
  });
  it('a variant without a picture draws an empty box, never an img with an empty src', () => {
    const { container } = show(job([variant(1), variant(2, { image: '' })]));
    expect(container.querySelector('img[src=""]')).toBeNull();
    expect(container.querySelectorAll('button[aria-pressed] img')).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-pressed] div[aria-hidden="true"]')).toHaveLength(1);
  });
  it('not enough credits: the dialog says so and offers Buy credits, and nothing is sent', async () => {
    show(partial(), extras({ variantCosts: { 'job-1-v3': 2 }, balance: 1 }));
    await userEvent.click(screen.getByRole('button', { name: /Generate the missing variant again/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('You need 2 credits for this.');
    expect(within(dialog).getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing?returnTo=%2Fjobs%2Fjob-1');
    expect(within(dialog).queryByRole('button', { name: 'Confirm and generate' })).toBeNull();
  });
  it('the price changed: the dialog shows the new price and does not charge', async () => {
    regenerateVariant.mockResolvedValue({ status: 'price-changed', cost: 3, balance: 12 });
    show(partial(), extras({ variantCosts: { 'job-1-v3': 2 } }));
    await userEvent.click(screen.getByRole('button', { name: /Generate the missing variant again/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm and generate' }));
    expect(await screen.findByText('The price changed. Check the numbers and confirm again.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Cost3 credits');
  });
  it('after the images are gone the box says to start a new job and opens the template; no regenerate button', () => {
    show(job(partial().variants, { imagesStored: false }));
    const box = screen.getByRole('region', { name: 'Variant 3' });
    expect(box).toHaveTextContent('The product images for this job are no longer stored. Start a new job from the template.');
    expect(within(box).getByRole('link', { name: 'Open the template' })).toHaveAttribute('href', '/templates/tpl-layering');
    expect(within(box).queryByRole('button')).toBeNull();
  });
  it('a variant being generated again is labelled and the page keeps asking for news', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    try {
      show(job([variant(1), variant(2, { video: null, status: 'generating' })]));
      expect(screen.getByRole('button', { name: 'Variant 2' })).toHaveTextContent('Generating');
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(refresh).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('Result: states (board A-Sonuc-Durumlar)', () => {
  it('a video that cannot be played says so and offers the download instead', () => {
    const { container } = show(job([variant(1)]));
    fireEvent.error(container.querySelector('video')!);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This video cannot be played here. Download it instead.');
    expect(within(alert).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/media/jobs/v1.mp4');
  });
  describe('the download', () => {
    const saved = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    afterEach(() => {
      vi.unstubAllGlobals();
      saved.mockClear();
    });
    const answer = (status: number) => new Response(null, { status });

    it('checks the file first: Preparing your file… while it waits, both buttons off, then the browser saves it', async () => {
      let finish!: (r: Response) => void;
      const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
      vi.stubGlobal('fetch', fetchMock);
      show(job([variant(1), variant(2)]));
      await userEvent.click(screen.getByRole('link', { name: 'Download variant 1' }));
      expect(screen.getByRole('status')).toHaveTextContent('Preparing your file…');
      expect(screen.getByRole('link', { name: 'Download variant 1' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('button', { name: 'Download all 2' })).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledWith('/media/jobs/v1.mp4', expect.objectContaining({ headers: { range: 'bytes=0-0' } }));
      expect(saved).not.toHaveBeenCalled();
      await act(async () => finish(answer(206)));
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      expect(saved).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
    });
    it('hands the browser a name made of the template and the job, for every file', async () => {
      const names: string[] = [];
      saved.mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
      vi.stubGlobal('fetch', vi.fn(async () => answer(206)));
      show(job([variant(1), variant(2)]));
      await userEvent.click(screen.getByRole('button', { name: 'Download all 2' }));
      await waitFor(() => expect(names).toHaveLength(2));
      expect(names).toEqual(['viral-clone-fragrance-layering-recip-job-1.mp4', 'viral-clone-fragrance-layering-recip-job-1.mp4']);
      saved.mockImplementation(() => undefined);
    });
    it('a file that is not there: The download did not start. Try again. with Try again and Contact support; nothing is saved', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(404)));
      show(job([variant(1)]));
      await userEvent.click(screen.getByRole('link', { name: 'Download' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The download did not start. Try again.');
      expect(within(alert).getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact');
      expect(saved).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).toBeNull();
    });
    it('a request that throws is the same; Try again asks again and a good answer saves the file and clears the notice', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(answer(200));
      vi.stubGlobal('fetch', fetchMock);
      show(job([variant(1)]));
      await userEvent.click(screen.getByRole('link', { name: 'Download' }));
      await userEvent.click(await within(await screen.findByRole('alert')).findByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(saved).toHaveBeenCalledTimes(1);
    });
    it('Download all checks every file, then saves them; one missing file saves none', async () => {
      const fetchMock = vi.fn().mockResolvedValue(answer(200));
      vi.stubGlobal('fetch', fetchMock);
      show(job([variant(1), variant(2)]));
      await userEvent.click(screen.getByRole('button', { name: 'Download all 2' }));
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/media/jobs/v1.mp4', '/media/jobs/v2.mp4']);
      saved.mockClear();
      fetchMock.mockReset().mockResolvedValueOnce(answer(200)).mockResolvedValueOnce(answer(404));
      await userEvent.click(screen.getByRole('button', { name: 'Download all 2' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The download did not start. Try again.');
      expect(saved).not.toHaveBeenCalled();
    });
  });
  it('a video no longer stored says so, explains that a new job starts, and offers Generate it again; no player, no downloads', () => {
    show(job([variant(1, { video: null })], { videoStored: false }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This video is no longer stored.');
    expect(screen.getByText('Videos are kept for 12 months.')).toBeInTheDocument();
    expect(screen.getByText('This starts a new job: you add the product images again and confirm the price.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Generate it again' })).toHaveAttribute('href', '/templates/tpl-layering/generate?from=job-1');
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete video' })).toBeInTheDocument();
  });
});

describe('Result: the "Generate a new variant" link', () => {
  it('points at the template when the customer can open it', () => {
    show(job([variant(1)]));
    expect(screen.getByRole('link', { name: 'Generate a new variant' })).toHaveAttribute('href', '/templates/tpl-layering/generate?from=job-1');
  });

  it('is not shown for one variant when the template is closed to the customer (hidden or someone else\'s: its page is a 404)', () => {
    show(job([variant(1)]), extras(), { ...template, openable: false });
    expect(screen.queryByRole('link', { name: 'Generate a new variant' })).toBeNull();
  });

  it('is not shown for several variants either', () => {
    show(job([variant(1), variant(2)]), extras(), { ...template, openable: false });
    expect(screen.queryByRole('link', { name: 'Generate a new variant' })).toBeNull();
  });
});
