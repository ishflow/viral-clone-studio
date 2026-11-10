import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { makeTemplate } from './fixtures';

const refresh = vi.fn();
vi.mock('next/image', () => ({ default: (p: { src?: string }) => <span data-poster data-src={p.src} /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), unstable_rethrow: (error: unknown) => { throw error; } }));
const addVideo = vi.fn();
const removeTemplate = vi.fn();
vi.mock('./actions', () => ({ addVideo: (...args: unknown[]) => addVideo(...args), removeTemplate: (...args: unknown[]) => removeTemplate(...args) }));
const uploadVideo = vi.fn();
vi.mock('./upload', async (original) => ({ ...(await original<typeof import('./upload')>()), uploadVideo: (...args: unknown[]) => uploadVideo(...args) }));
// jsdom plays no video: the length the browser reads from a file is the test's to give (null: the browser could not read it).
const readVideoSeconds = vi.fn();
vi.mock('./RangeFields', async (original) => ({ ...(await original<typeof import('./RangeFields')>()), readVideoSeconds: (...args: unknown[]) => readVideoSeconds(...args) }));

import { AddVideoView } from './AddVideoView';

beforeEach(() => {
  refresh.mockClear();
  addVideo.mockReset();
  removeTemplate.mockReset();
  uploadVideo.mockReset();
  readVideoSeconds.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

const mine = (patch = {}) => makeTemplate({ status: 'private', ownerId: 'usr-demo', title: 'Desk unboxing in five shots', ...patch });

describe('AddVideoView link form', () => {
  it('shows the field error the action returns for an invalid link', async () => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'linkInvalid' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(await screen.findByText('Only TikTok and YouTube video links work. Paste one of those, or upload the file.')).toBeInTheDocument();
    expect(screen.getByLabelText('or paste a link')).toHaveAttribute('aria-invalid', 'true');
  });
  it.each([
    ['duplicate', 'You already added this video.'],
    ['tooManyPreparing', 'Wait until your other videos are ready (up to 3 at a time).'],
    ['limit', 'You reached the limit of 20 videos. Delete one to add another.'],
  ])('shows the text of the %s refusal in the form', async (code, text) => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: code } });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByLabelText('or paste a link')).toHaveAttribute('aria-invalid', 'true');
  });
  it('says the link is being checked, and that nothing is charged for it, until the check answers', async () => {
    let answer!: (state: unknown) => void;
    addVideo.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderWithI18n(<AddVideoView templates={[]} />);
    expect(screen.queryByText('Checking the link. Nothing is charged for this check.')).toBeNull();
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Checking the link. Nothing is charged for this check.');
    await act(async () => answer({ status: 'error', errors: { link: 'linkInvalid' } }));
    expect(screen.queryByText('Checking the link. Nothing is charged for this check.')).toBeNull();
  });
  it('confirms a valid link', async () => {
    addVideo.mockResolvedValue({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(await screen.findByText(/Added\. It appears under/)).toBeInTheDocument();
  });
});

describe('AddVideoView upload', () => {
  const chooseFile = (file: File) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  const clip = () => new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
  const kept = { uploadId: '3f2b8c1e-5a47-4d0e-9b7c-1a2b3c4d5e6f', name: 'clip.mp4', type: 'video/mp4', bytes: 10 };

  it('uploads the chosen file, shows the progress, then sends its id to the free check (no link field involved)', async () => {
    let finish!: (result: unknown) => void;
    uploadVideo.mockImplementation((_file: File, onProgress: (n: number) => void) => { onProgress(40); return new Promise((resolve) => { finish = resolve; }); });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(screen.getByRole('status')).toHaveTextContent('Uploading clip.mp4… 40%');
    expect(addVideo).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, file: kept }));
    const form = addVideo.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({ uploadId: kept.uploadId, fileName: 'clip.mp4', fileType: 'video/mp4', fileBytes: '10' });
    expect(await screen.findByText(/This video is not vertical/)).toBeInTheDocument();
  });

  it('shows the confirmation of a file with its name, and its second step sends the file fields, not a link', async () => {
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    const offer = { link: '', file: kept, key: 'k1', credits: 2, balance: 9, seconds: 31, shots: null, format: null };
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer }).mockResolvedValueOnce({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('clip.mp4')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare template' })); });
    const second = Object.fromEntries((addVideo.mock.calls[1]![1] as FormData).entries());
    expect(second).toMatchObject({ uploadId: kept.uploadId, fileName: 'clip.mp4', key: 'k1', confirmed: '2' });
    expect(second).not.toHaveProperty('link');
  });

  it('the green "Added" line goes away while a refusal of the next file or link is on the screen', async () => {
    addVideo.mockResolvedValue({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    expect(await screen.findByText(/Added\. It appears under/)).toBeInTheDocument();
    await act(async () => chooseFile(new File(['x'], 'photo.png', { type: 'image/png' })));
    expect(await screen.findByText(/This file type is not supported/)).toBeInTheDocument();
    expect(screen.queryByText(/Added\. It appears under/)).toBeNull();
  });

  it.each([
    ['type', 'This file type is not supported. Use mp4 or mov.'],
    ['uploadQuota', 'You added many videos today. Try again tomorrow.'],
    ['uploadFailed', 'The file could not be uploaded. Check your connection and try again.'],
    ['uploadTimeout', 'The upload took too long. Check your connection and try again.'],
    ['uploadServer', 'The file could not be saved on our side. Nothing was charged. Try again in a minute.'],
  ])('shows the upload refusal %s in the form and calls no action', async (code, text) => {
    uploadVideo.mockResolvedValue({ ok: false, code });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(await screen.findByText((content) => content.includes(text))).toBeInTheDocument();
    expect(addVideo).not.toHaveBeenCalled();
  });

  it('puts a file refusal in the file card, not on the link field, and a later link error is not masked by it', async () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(new File(['x'], 'photo.png', { type: 'image/png' })));
    const message = await screen.findByText(/This file type is not supported/);
    expect(message.closest('[data-upload-card]')).not.toBeNull();
    expect(screen.getByLabelText('or paste a link')).not.toHaveAttribute('aria-invalid');
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'linkInvalid' } });
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    expect(await screen.findByText('Only TikTok and YouTube video links work. Paste one of those, or upload the file.')).toBeInTheDocument();
    expect(screen.queryByText(/This file type is not supported/)).toBeNull();
    expect(screen.getByLabelText('or paste a link')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a check refusal of an uploaded file (too long) in the file card too, with the boxes to pick a part', async () => {
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'length' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    const message = await screen.findByText(/at most 5 minutes/);
    expect(message.closest('[data-upload-card]')).not.toBeNull();
    expect(screen.getByLabelText('or paste a link')).not.toHaveAttribute('aria-invalid');
    expect(within(message.closest<HTMLElement>('[data-upload-card]')!).getByLabelText('Start')).toBeInTheDocument();
  });

  it('refuses a file of the wrong type or over 100 MB in the browser without uploading', async () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(new File(['x'], 'photo.png', { type: 'image/png' })));
    expect(await screen.findByText(/This file type is not supported/)).toBeInTheDocument();
    const big = clip();
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
    await act(async () => chooseFile(big));
    expect(await screen.findByText(/larger than 100 MB/)).toBeInTheDocument();
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it('takes a dropped file the same way', async () => {
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'length' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => { fireEvent.drop(screen.getByText('Drop the file here').closest('div')!, { dataTransfer: { files: [clip()] } }); });
    expect(uploadVideo).toHaveBeenCalledTimes(1);
  });

  it('says only the first file was taken when several files are dropped, and not for one file', async () => {
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'length' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    const zone = () => screen.getByText('Drop the file here').closest('div')!;
    await act(async () => { fireEvent.drop(zone(), { dataTransfer: { files: [clip()] } }); });
    expect(screen.queryByText(/Only the first file was taken/)).toBeNull();
    await act(async () => { fireEvent.drop(zone(), { dataTransfer: { files: [clip(), clip()] } }); });
    expect(uploadVideo).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Only the first file was taken. Add the other videos one by one.')).toBeInTheDocument();
    await act(async () => chooseFile(clip()));
    expect(screen.queryByText(/Only the first file was taken/)).toBeNull();
  });
});

describe('AddVideoView your templates', () => {
  it('shows preparing with the step list, ready with Clone it, failed with the translated reason', () => {
    renderWithI18n(
      <AddVideoView
        templates={[
          mine({ id: 'p', preparation: 'preparing' }),
          mine({ id: 'r', preparation: 'ready', title: 'Ready one' }),
          mine({ id: 'f', preparation: 'failed', preparationNote: 'split-screen', title: 'Split one', shots: [] }),
        ]}
      />,
    );
    const list = within(screen.getByRole('region', { name: 'Your templates' }));
    expect(list.getByText('Preparing')).toBeInTheDocument();
    expect(list.getByText('Checking fit')).toBeInTheDocument();
    expect(list.getByRole('link', { name: 'Clone it' })).toHaveAttribute('href', '/templates/r/generate');
    expect(list.getByText("Didn't fit")).toBeInTheDocument();
    expect(list.getByText(/uses a split screen/)).toBeInTheDocument();
  });
  it('a ready template of the list shows its own poster, and an empty frame when it has none', () => {
    const { container, rerender } = renderWithI18n(<AddVideoView templates={[mine({ id: 'r', preparation: 'ready', image: '/media/templates/r/poster.jpg' })]} />);
    const list = () => within(screen.getByRole('region', { name: 'Your templates' }));
    expect(container.querySelector('#yours [data-poster]')).toHaveAttribute('data-src', '/media/templates/r/poster.jpg');
    expect(container.querySelector('#yours [aria-hidden="true"].border-dashed')).toBeNull();
    rerender(
      <I18nProvider locale="en" messages={loadMessages('en')}>
        <AddVideoView templates={[mine({ id: 'r', preparation: 'ready', image: '' })]} />
      </I18nProvider>,
    );
    expect(container.querySelector('#yours [data-poster]')).toBeNull();
    expect(container.querySelector('#yours [aria-hidden="true"].border-dashed')).not.toBeNull();
    expect(list().getByRole('link', { name: 'Clone it' })).toBeInTheDocument();
  });
  it('falls back to a generic message for an unknown reason code', () => {
    renderWithI18n(<AddVideoView templates={[mine({ preparation: 'failed', preparationNote: 'weird' as never })]} />);
    expect(screen.getByText(/can't build a template from this video/)).toBeInTheDocument();
  });
  it('refreshes every 2 seconds while one is preparing, and stops when none is', () => {
    vi.useFakeTimers();
    const view = (templates: ReturnType<typeof mine>[]) => (
      <I18nProvider locale="en" messages={loadMessages('en')}>
        <AddVideoView templates={templates} />
      </I18nProvider>
    );
    const { rerender } = render(view([mine({ preparation: 'preparing' })]));
    vi.advanceTimersByTime(6100);
    expect(refresh).toHaveBeenCalledTimes(3);
    rerender(view([mine({ preparation: 'ready' })]));
    refresh.mockClear();
    vi.advanceTimersByTime(6100);
    expect(refresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('AddVideoView the anchor of the gallery link', () => {
  it('names its own templates region "yours" so /templates/new#yours lands on it', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    expect(screen.getByRole('region', { name: 'Your templates' })).toHaveAttribute('id', 'yours');
  });
});

describe('AddVideoView a card that did not fit', () => {
  const longTitle = 'https://www.youtube.com/watch?v=' + 'a'.repeat(120);
  it('a failed card has a remove button and its long title can wrap', async () => {
    removeTemplate.mockResolvedValue({ status: 'error', code: 'failed' });
    renderWithI18n(<AddVideoView templates={[mine({ id: 'f-1', preparation: 'failed', preparationNote: 'too-long', title: longTitle })]} />);
    const title = screen.getByRole('heading', { name: longTitle });
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('[overflow-wrap:anywhere]');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove from the list' })); });
    expect(removeTemplate).toHaveBeenCalledWith('f-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('The template could not be deleted. Try again.');
  });
  it('a ready or preparing card breaks a long title the same way, so the page does not scroll sideways', () => {
    renderWithI18n(<AddVideoView templates={[mine({ id: 'r-1', preparation: 'ready', title: longTitle }), mine({ id: 'p-1', preparation: 'preparing', title: longTitle })]} />);
    for (const title of screen.getAllByRole('heading', { name: longTitle })) {
      expect(title.className).toContain('min-w-0');
      expect(title.className).toContain('[overflow-wrap:anywhere]');
    }
  });
  it('a card that is preparing or ready has no remove button here', () => {
    renderWithI18n(<AddVideoView templates={[mine({ id: 'p', preparation: 'preparing' }), mine({ id: 'r', preparation: 'ready' })]} />);
    expect(screen.queryByRole('button', { name: 'Remove from the list' })).toBeNull();
  });
});

describe('AddVideoView the board texts and the confirmation before preparing', () => {
  const offer = { link: 'https://youtu.be/abc', key: 'k-1', credits: 1, balance: 12, seconds: 12, shots: 5, format: 'no-talking' as const };
  const submitLink = async () => {
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
  };

  it('says the file and link rules before anything is added, the price, and shows the link placeholder', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    expect(screen.getByText('mp4 or mov · up to 60 sec · up to 100 MB · vertical (9:16)')).toBeInTheDocument();
    expect(screen.getByText('Public TikTok or YouTube Shorts link')).toBeInTheDocument();
    expect(screen.getByText('Preparing a template costs 1 credit. You confirm before anything is charged.')).toBeInTheDocument();
    expect(screen.getByLabelText('or paste a link')).toHaveAttribute('placeholder', 'https://');
  });
  it.each([
    ['type', 'This file type is not supported. Use mp4 or mov.'],
    ['length', 'This video is longer than 60 seconds. Pick a part of it, up to 60 seconds; the video itself can be at most 5 minutes.'],
    ['private', 'This video is private. Make it public or upload the file.'],
    ['unsupportedSite', 'We can read TikTok and YouTube links. For other sites, upload the file.'],
  ])('a refused source (%s) says why and that nothing was charged', async (code, text) => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: code } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await submitLink();
    expect(await screen.findByText(`${text} Nothing was charged.`)).toBeInTheDocument();
  });
  it('the daily limit has its own sentence and no "nothing was charged" tail', async () => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'dailyLimit' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await submitLink();
    expect(await screen.findByText("You reached today's limit for your own videos. Try again tomorrow.")).toBeInTheDocument();
  });
  it('the offer is a window: price, length, format, balance now and after, the note; Prepare template sends the key and the credits, Cancel closes it and sends nothing more', async () => {
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer }).mockResolvedValue({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    await submitLink();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Prepare this template');
    expect(dialog).toHaveTextContent('Preparing this template costs 1 credit.');
    expect(dialog).toHaveTextContent('Length12 sec');
    expect(dialog).toHaveTextContent('Shots5');
    expect(dialog).toHaveTextContent('FormatNo talking');
    expect(dialog).toHaveTextContent('Balance now12 credits');
    expect(dialog).toHaveTextContent('Balance after11 credits');
    expect(dialog).toHaveTextContent('You are charged when you confirm. If the template cannot be prepared, the credit comes back.');
    expect(addVideo).toHaveBeenCalledTimes(1); // the free check only
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare template' }));
    });
    expect(addVideo).toHaveBeenCalledTimes(2);
    const sent = addVideo.mock.calls[1]![1] as FormData;
    expect([sent.get('link'), sent.get('key'), sent.get('confirmed')]).toEqual(['https://youtu.be/abc', 'k-1', '1']);
  });
  it('without a shot count from the check the window has no Shots row', async () => {
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer: { ...offer, shots: null } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await submitLink();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Length12 sec');
    expect(dialog).not.toHaveTextContent('Shots');
  });
  it('Cancel closes the offer without sending anything', async () => {
    addVideo.mockResolvedValue({ status: 'confirm', errors: {}, offer });
    renderWithI18n(<AddVideoView templates={[]} />);
    await submitLink();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(addVideo).toHaveBeenCalledTimes(1);
  });
  it('with too few credits the window says what is needed, offers Buy credits and no Prepare button', async () => {
    addVideo.mockResolvedValue({ status: 'confirm', errors: {}, offer: { ...offer, balance: 0 } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await submitLink();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('You need 1 credit. Nothing was charged.');
    expect(within(dialog).getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing?returnTo=%2Ftemplates%2Fnew');
    expect(within(dialog).queryByRole('button', { name: 'Prepare template' })).toBeNull();
    expect(dialog).not.toHaveTextContent('Balance after');
  });
  it('a template that did not fit says its credit was returned', () => {
    renderWithI18n(<AddVideoView templates={[mine({ id: 'f', preparation: 'failed', preparationNote: 'split-screen' })]} />);
    expect(screen.getByText(/Your credit was returned\./)).toBeInTheDocument();
  });
});

describe('AddVideoView a part of a link', () => {
  const start = () => screen.queryByLabelText('Start');
  const fill = (from: string, to: string) => {
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: from } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: to } });
  };
  const useAPart = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Use only a part of the video' }));
  const add = () => screen.getByRole('button', { name: 'Add' });

  it('has no boxes until the customer says they want only a part, and sends no part then', async () => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'linkInvalid' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    expect(start()).toBeNull();
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => { fireEvent.click(add()); });
    const sent = addVideo.mock.calls[0]![1] as FormData;
    expect(sent.has('rangeFrom')).toBe(false);
    expect(sent.has('rangeTo')).toBe(false);
  });
  it('reads in this order, on a phone as in the markup: link, the part checkbox, Start, End, and Add last', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    useAPart();
    const order = [screen.getByLabelText('or paste a link'), screen.getByRole('checkbox', { name: 'Use only a part of the video' }), screen.getByLabelText('Start'), screen.getByLabelText('End'), add()];
    order.slice(1).forEach((element, i) => expect(order[i]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING, `${i + 1}`).toBeTruthy());
  });
  it('opens the Start and End boxes with the checkbox, closes them again, and keeps Add closed until a part is picked', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    useAPart();
    expect(start()).not.toBeNull();
    expect(add()).toBeDisabled();
    fill('0:30', '1:20');
    expect(add()).toBeEnabled();
    useAPart();
    expect(start()).toBeNull();
    expect(add()).toBeEnabled();
  });
  it('shows the picked length live and closes Add for a part over 1 minute', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    useAPart();
    fill('0:30', '1:20');
    expect(screen.getByText('Selected: 50 sec')).toBeInTheDocument();
    fill('0:00', '1:30');
    expect(screen.getByRole('alert')).toHaveTextContent('The part can be at most 1 min.');
    expect(add()).toBeDisabled();
    fill('0:10', '1:10');
    expect(screen.getByText('Selected: 1 min')).toBeInTheDocument();
    expect(add()).toBeEnabled();
  });
  it('sends the part in seconds with the link, and the window of the offer shows it and sends it again with Prepare template', async () => {
    const offer = { link: 'https://youtu.be/abc', range: { from: 30, to: 80 }, key: 'k-9', credits: 1, balance: 12, seconds: null, shots: null, format: null };
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer }).mockResolvedValue({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    useAPart();
    fill('0:30', '1:20');
    await act(async () => { fireEvent.click(add()); });
    const first = addVideo.mock.calls[0]![1] as FormData;
    expect([first.get('rangeFrom'), first.get('rangeTo')]).toEqual(['30', '80']);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Part0:30 – 1:20 (50 sec)');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare template' })); });
    const second = addVideo.mock.calls[1]![1] as FormData;
    expect([second.get('link'), second.get('rangeFrom'), second.get('rangeTo'), second.get('key')]).toEqual(['https://youtu.be/abc', '30', '80', 'k-9']);
  });
  it('the window of a link with no part has no Part row and sends no part', async () => {
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer: { link: 'https://youtu.be/abc', key: 'k-1', credits: 1, balance: 12, seconds: 12, shots: null, format: null } }).mockResolvedValue({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    await act(async () => { fireEvent.click(add()); });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('Part');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare template' })); });
    expect((addVideo.mock.calls[1]![1] as FormData).has('rangeFrom')).toBe(false);
  });
  it('a refused part (range) says why under the link and that nothing was charged', async () => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'range' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    useAPart();
    fill('0:30', '1:20');
    await act(async () => { fireEvent.click(add()); });
    expect(await screen.findByText(/Pick a part of 3 to 60 seconds/)).toHaveTextContent('Nothing was charged.');
  });
  it('keeps the picked part when the link check answers with an error, so it can be fixed', async () => {
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'linkInvalid' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    useAPart();
    fill('0:30', '1:20');
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://example.com' } });
    await act(async () => { fireEvent.click(add()); });
    await screen.findByText(/Only TikTok and YouTube video links work/);
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('0:30');
  });
});

describe('AddVideoView the form keeps what the customer ticked', () => {
  const partBox = () => screen.getByRole('checkbox', { name: 'Use only a part of the video' }) as HTMLInputElement;
  const offer = { link: 'https://youtu.be/abc', range: { from: 30, to: 80 }, key: 'k-9', credits: 1, balance: 12, seconds: null, shots: null, format: null };
  const tickPart = () => {
    fireEvent.change(screen.getByLabelText('or paste a link'), { target: { value: 'https://youtu.be/abc' } });
    fireEvent.click(partBox());
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '0:30' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '1:20' } });
  };

  it('the part box stays ticked after Add is pressed, with the confirmation window open and after a refused link', async () => {
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer }).mockResolvedValue({ status: 'error', errors: { link: 'linkNotFound' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    tickPart();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    const dialog = await screen.findByRole('dialog');
    expect(partBox().checked).toBe(true);
    expect(screen.getByLabelText('Start')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    await screen.findByText(/We could not open this link/);
    expect(partBox().checked).toBe(true);
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('0:30');
  });

  it('pressing the confirm button twice asks the server once and shows no already-added error', async () => {
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer }).mockResolvedValueOnce({ status: 'added', errors: {} }).mockResolvedValue({ status: 'error', errors: { link: 'duplicate' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    tickPart();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Prepare template' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(addVideo).toHaveBeenCalledTimes(2); // the free check and one confirmation
    expect(screen.queryByText('You already added this video.')).toBeNull();
    expect(await screen.findByText(/It appears under "Your templates"/)).toBeInTheDocument();
  });
});

describe('AddVideoView a part of an uploaded file', () => {
  const chooseFile = (file: File) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  const clip = () => new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
  const kept = { uploadId: '3f2b8c1e-5a47-4d0e-9b7c-1a2b3c4d5e6f', name: 'clip.mp4', type: 'video/mp4', bytes: 10 };
  const card = () => within(document.querySelector<HTMLElement>('[data-upload-card]')!);
  const fill = (from: string, to: string) => {
    fireEvent.change(card().getByLabelText('Start'), { target: { value: from } });
    fireEvent.change(card().getByLabelText('End'), { target: { value: to } });
  };

  it('names the way a longer video works, next to the file rules', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    expect(card().getByText('Longer than 60 seconds? Up to 5 minutes works if you pick a part of up to 60 seconds.')).toBeInTheDocument();
  });
  it('a file of up to 60 seconds goes straight up, with no boxes and no part', async () => {
    readVideoSeconds.mockResolvedValue(45);
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(card().queryByLabelText('Start')).toBeNull();
    expect((addVideo.mock.calls[0]![1] as FormData).has('rangeFrom')).toBe(false);
  });
  it('a file the browser cannot read the length of goes up as before', async () => {
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(uploadVideo).toHaveBeenCalledTimes(1);
  });
  it('a file over 60 seconds opens the boxes in the file card and uploads nothing until a part is picked', async () => {
    readVideoSeconds.mockResolvedValue(150);
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(card().getByText('clip.mp4 is 2 min 30 sec long. Pick the part to use.')).toBeInTheDocument();
    const go = card().getByRole('button', { name: 'Use this part' });
    expect(go).toBeDisabled();
    fill('0:00', '1:30');
    expect(card().getByRole('alert')).toHaveTextContent('The part can be at most 1 min.');
    expect(go).toBeDisabled();
    fill('2:00', '3:00');
    expect(card().getByRole('alert')).toHaveTextContent('The part must lie inside the video (it is 2 min 30 sec long).');
    expect(go).toBeDisabled();
  });
  it('uploads the file with the picked part once Use this part is pressed, and sends the part to the free check', async () => {
    readVideoSeconds.mockResolvedValue(150);
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    fill('0:30', '1:20');
    await act(async () => { fireEvent.click(card().getByRole('button', { name: 'Use this part' })); });
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries((addVideo.mock.calls[0]![1] as FormData).entries())).toEqual({ uploadId: kept.uploadId, fileName: 'clip.mp4', fileType: 'video/mp4', fileBytes: '10', rangeFrom: '30', rangeTo: '80' });
    expect(card().queryByLabelText('Start')).toBeNull();
  });
  it('the window of an uploaded file shows its part and sends it again with the file fields', async () => {
    readVideoSeconds.mockResolvedValue(150);
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    const offer = { link: '', file: kept, range: { from: 30, to: 80 }, key: 'k2', credits: 1, balance: 9, seconds: 150, shots: null, format: null };
    addVideo.mockResolvedValueOnce({ status: 'confirm', errors: {}, offer }).mockResolvedValueOnce({ status: 'added', errors: {} });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    fill('0:30', '1:20');
    await act(async () => { fireEvent.click(card().getByRole('button', { name: 'Use this part' })); });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Part0:30 – 1:20 (50 sec)');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare template' })); });
    const second = Object.fromEntries((addVideo.mock.calls[1]![1] as FormData).entries());
    expect(second).toMatchObject({ uploadId: kept.uploadId, key: 'k2', confirmed: '1', rangeFrom: '30', rangeTo: '80' });
    expect(second).not.toHaveProperty('link');
  });
  it('a file longer than five minutes says so and offers no part to pick, and uploads nothing', async () => {
    readVideoSeconds.mockResolvedValue(301);
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(await screen.findByText('This video is longer than 5 minutes. Use a video of up to 5 minutes. Nothing was charged.')).toBeInTheDocument();
    expect(screen.queryByText(/Pick a part/)).toBeNull();
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(card().queryByLabelText('Start')).toBeNull();
  });
  it('choosing another file closes the boxes of the first', async () => {
    readVideoSeconds.mockResolvedValueOnce(150).mockResolvedValueOnce(45);
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValue({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(card().getByLabelText('Start')).toBeInTheDocument();
    await act(async () => chooseFile(clip()));
    expect(card().queryByLabelText('Start')).toBeNull();
    expect(uploadVideo).toHaveBeenCalledTimes(1);
  });
  it('when the browser could not read the length and the check says "longer than 60 seconds", the boxes open and the stored file is used again, not uploaded twice', async () => {
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValueOnce({ status: 'error', errors: { link: 'length' } }).mockResolvedValueOnce({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    expect(await card().findByLabelText('Start')).toBeInTheDocument();
    fill('0:30', '1:20');
    await act(async () => { fireEvent.click(card().getByRole('button', { name: 'Use this part' })); });
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries((addVideo.mock.calls[1]![1] as FormData).entries())).toMatchObject({ uploadId: kept.uploadId, rangeFrom: '30', rangeTo: '80' });
  });
  it('a part the check refuses for the file (range) opens the boxes again, with the stored file', async () => {
    readVideoSeconds.mockResolvedValue(150);
    uploadVideo.mockResolvedValue({ ok: true, file: kept });
    addVideo.mockResolvedValueOnce({ status: 'error', errors: { link: 'range' } }).mockResolvedValueOnce({ status: 'error', errors: { link: 'ratio' } });
    renderWithI18n(<AddVideoView templates={[]} />);
    await act(async () => chooseFile(clip()));
    fill('0:30', '1:20');
    await act(async () => { fireEvent.click(card().getByRole('button', { name: 'Use this part' })); });
    expect(await card().findByLabelText('Start')).toHaveValue('');
    fill('1:00', '2:00');
    await act(async () => { fireEvent.click(card().getByRole('button', { name: 'Use this part' })); });
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries((addVideo.mock.calls[1]![1] as FormData).entries())).toMatchObject({ uploadId: kept.uploadId, rangeFrom: '60', rangeTo: '120' });
  });
});

describe('AddVideoView the form is kept in the tab', () => {
  const KEY = 'vc:draft:add-video:usr-demo';
  const linkBox = () => screen.getByLabelText('or paste a link');
  beforeEach(() => window.sessionStorage.clear());

  it('a typed link and its part come back when the page is opened again, and are gone once the video was added', async () => {
    addVideo.mockResolvedValue({ status: 'added', errors: {} });
    const first = renderWithI18n(<AddVideoView templates={[]} draftKey={KEY} />);
    fireEvent.change(linkBox(), { target: { value: 'https://youtu.be/abc' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use only a part of the video' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '0:30' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '1:20' } });
    first.unmount();

    const second = renderWithI18n(<AddVideoView templates={[]} draftKey={KEY} />);
    await waitFor(() => expect(linkBox()).toHaveValue('https://youtu.be/abc'));
    expect(screen.getByRole('checkbox', { name: 'Use only a part of the video' })).toBeChecked();
    expect(screen.getByLabelText('Start')).toHaveValue('0:30');
    expect(screen.getByLabelText('End')).toHaveValue('1:20');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    expect(await screen.findByText(/Added\. It appears under/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    second.unmount();
    renderWithI18n(<AddVideoView templates={[]} draftKey={KEY} />);
    expect(linkBox()).toHaveValue('');
  });
  it('a kept value of the wrong shape or an over-long link is ignored, and the form starts empty', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ link: 'x'.repeat(3000), linkPart: 'yes', linkRange: { from: 5, to: null } }));
    renderWithI18n(<AddVideoView templates={[]} draftKey={KEY} />);
    await act(async () => {});
    expect(linkBox()).toHaveValue('');
    expect(screen.queryByLabelText('Start')).toBeNull();
  });
  it('a form without a draft key keeps nothing', () => {
    renderWithI18n(<AddVideoView templates={[]} />);
    fireEvent.change(linkBox(), { target: { value: 'https://youtu.be/abc' } });
    expect(window.sessionStorage.length).toBe(0);
  });
});
